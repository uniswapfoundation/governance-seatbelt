import { access, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  type Address,
  type Hex,
  type PublicClient,
  concatHex,
  getAddress,
  keccak256,
  pad,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem';
import { parseAbi } from 'viem';
import type { StorageEncodingResponse } from '../../types';
import { detectProxy } from '../contracts/proxy';
import { getClientForChain } from './client';
import type { StateOverridesPayload } from './tenderly-api';

interface StorageEntry {
  label: string;
  slot: string;
  offset: number;
  type: string;
}
interface StorageType {
  label: string;
  encoding: string;
  numberOfBytes: string;
  key?: string;
  value?: string;
  base?: string;
  members?: StorageEntry[];
}
interface Layout {
  storage: StorageEntry[];
  types: Record<string, StorageType>;
}
interface Compiler {
  compile(input: string): string;
  version(): string;
}
const require = createRequire(import.meta.url);
const solc = require('solc') as { setupMethods(module: unknown): Compiler };
const compilers = new Map<string, Promise<Compiler>>();
const layouts = new Map<string, Layout>();

async function loadCompiler(version: string): Promise<Compiler> {
  const directory = path.join(process.cwd(), 'cache', 'solc');
  const file = path.join(directory, `${version}.cjs`);
  try {
    await access(file);
  } catch {
    const response = await fetch(`https://binaries.soliditylang.org/bin/soljson-${version}.js`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error('Verified compiler unavailable');
    await mkdir(directory, { recursive: true });
    await writeFile(file, await response.text());
  }
  const compiler = solc.setupMethods(require(file));
  if (!compiler.version().startsWith(version.slice(1)))
    throw new Error('Verified compiler version mismatch');
  return compiler;
}

async function getStorageLayout(
  address: Address,
  chainId: number,
  blockNumber: bigint,
): Promise<Layout> {
  const client = getClientForChain(chainId);
  const proxy = await detectProxy(address, client as PublicClient, blockNumber);
  if (proxy.kind !== 'none' && !proxy.implementation)
    throw new Error('Proxy implementation unavailable');
  let sourceAddress = proxy.kind === 'none' ? address : proxy.implementation!;
  if (proxy.kind === 'none') {
    try {
      const implementation = await client.readContract({
        address,
        abi: parseAbi(['function implementation() view returns (address)']),
        functionName: 'implementation',
        blockNumber,
      });
      if (implementation !== zeroAddress) sourceAddress = implementation;
    } catch {
      /* A direct contract need not expose implementation(). */
    }
  }
  const key = `${chainId}:${sourceAddress.toLowerCase()}`;
  const cached = layouts.get(key);
  if (cached) return cached;
  const url = new URL('https://api.etherscan.io/v2/api');
  url.search = new URLSearchParams({
    chainid: String(chainId),
    module: 'contract',
    action: 'getsourcecode',
    address: sourceAddress,
    apikey: process.env.ETHERSCAN_API_KEY ?? '',
  }).toString();
  let entry: {
    SourceCode: string;
    CompilerVersion: string;
    ContractName: string;
    OptimizationUsed: string;
    Runs: string;
  };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    if (!response.ok || body.status !== '1' || !body.result?.[0]?.SourceCode) throw new Error();
    entry = body.result[0];
  } catch {
    throw new Error(`Verified storage source unavailable for ${sourceAddress} on chain ${chainId}`);
  }
  const version = entry.CompilerVersion;
  if (!/^v\d+\.\d+\.\d+\+commit\.[a-f0-9]+$/.test(version))
    throw new Error('Unsupported verified compiler version');
  if (!compilers.has(version)) {
    compilers.set(version, loadCompiler(version));
  }
  let source = entry.SourceCode;
  if (source.startsWith('{{')) source = source.slice(1, -1);
  const input = source.startsWith('{')
    ? JSON.parse(source)
    : {
        language: 'Solidity',
        sources: { 'source.sol': { content: source } },
        settings: {
          optimizer: { enabled: entry.OptimizationUsed === '1', runs: Number(entry.Runs) },
        },
      };
  input.settings = { ...input.settings, outputSelection: { '*': { '*': ['storageLayout'] } } };
  const output = JSON.parse((await compilers.get(version)!).compile(JSON.stringify(input)));
  if (output.errors?.some((error: { severity: string }) => error.severity === 'error'))
    throw new Error('Verified storage source did not compile');
  const candidates = Object.values(output.contracts ?? {}) as Record<
    string,
    { storageLayout: Layout }
  >[];
  const layout = candidates
    .map((contracts) => contracts[entry.ContractName]?.storageLayout)
    .find(Boolean);
  if (!layout?.storage.length) throw new Error('Verified compiler did not supply a storage layout');
  layouts.set(key, layout);
  return layout;
}

/** Encode only fields present in verified Solidity storage layouts. Unsupported types fail closed. */
export async function encodeRpcState(
  payload: StateOverridesPayload,
  blockNumber?: number,
): Promise<StorageEncodingResponse> {
  const chainId = Number(payload.networkID);
  const client = getClientForChain(chainId);
  const block = blockNumber === undefined ? await client.getBlockNumber() : BigInt(blockNumber);
  const result: StorageEncodingResponse = { stateOverrides: {} };
  const word = (value: bigint) => toHex(value, { size: 32 });
  for (const [rawAddress, overrides] of Object.entries(payload.stateOverrides)) {
    const address = getAddress(rawAddress);
    const layout = await getStorageLayout(address, chainId, block);
    const storage: Record<string, string> = {};
    for (const [path, value] of Object.entries(overrides.value)) {
      const tokens = [...path.matchAll(/([a-zA-Z_$][\w$]*)|\[([^\]]+)\]/g)].map(
        (match) => match[1] ?? match[2],
      );
      const root = layout.storage.find((entry) => entry.label === tokens[0]);
      if (!root) throw new Error(`Verified storage field unavailable: ${path}`);
      let slot = BigInt(root.slot);
      let offset = root.offset;
      let type = layout.types[root.type];
      for (const token of tokens.slice(1)) {
        if (type.encoding === 'mapping' && type.value) {
          const keyType = layout.types[type.key!];
          if (!/^(u?int\d*|address|bytes32)$/.test(keyType.label))
            throw new Error('Unsupported mapping key type');
          slot = BigInt(keccak256(concatHex([word(BigInt(token)), word(slot)])));
          offset = 0;
          type = layout.types[type.value];
        } else if (type.encoding === 'dynamic_array' && type.base) {
          if (token === 'length') {
            type = { label: 'uint256', encoding: 'inplace', numberOfBytes: '32' };
            continue;
          }
          const element = layout.types[type.base];
          const size = BigInt(element.numberOfBytes);
          const index = BigInt(token);
          if (size <= 32n) {
            const perSlot = 32n / size;
            slot = BigInt(keccak256(word(slot))) + index / perSlot;
            offset = Number((index % perSlot) * size);
          } else {
            slot = BigInt(keccak256(word(slot))) + index * ((size + 31n) / 32n);
            offset = 0;
          }
          type = element;
        } else {
          const member = type.members?.find((entry) => entry.label === token);
          if (!member) throw new Error(`Unsupported verified storage path: ${path}`);
          slot += BigInt(member.slot);
          offset = member.offset;
          type = layout.types[member.type];
        }
      }
      if (type.encoding === 'bytes') {
        const bytes = type.label === 'string' ? stringToHex(value) : (value as Hex);
        if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(bytes)) throw new Error('Invalid bytes storage value');
        const length = (bytes.length - 2) / 2;
        if (length < 32)
          storage[word(slot)] = concatHex([
            pad(bytes, { size: 31, dir: 'right' }),
            toHex(length * 2, { size: 1 }),
          ]);
        else {
          storage[word(slot)] = word(BigInt(length * 2 + 1));
          const start = BigInt(keccak256(word(slot)));
          for (let i = 0; i < length; i += 32)
            storage[word(start + BigInt(i / 32))] = pad(
              `0x${bytes.slice(2 + i * 2, 2 + (i + 32) * 2)}`,
              { size: 32, dir: 'right' },
            );
        }
      } else {
        if (type.encoding !== 'inplace' || !/^(u?int\d*|address|bool|bytes\d+)$/.test(type.label))
          throw new Error(`Unsupported storage type: ${type.label}`);
        const number =
          type.label === 'bool'
            ? value === 'true'
              ? 1n
              : value === 'false'
                ? 0n
                : BigInt(value)
            : BigInt(value);
        const bits = BigInt(Number(type.numberOfBytes) * 8);
        if (number < 0n || number >= 1n << bits)
          throw new Error('Storage value outside verified field width');
        const key = word(slot);
        if (bits === 256n && offset === 0) {
          storage[key] = word(number);
          continue;
        }
        const previous = BigInt(
          storage[key] ??
            (await client.getStorageAt({ address, slot: key, blockNumber: block })) ??
            '0x0',
        );
        const shift = BigInt(offset * 8);
        const mask = ((1n << bits) - 1n) << shift;
        storage[key] = word((previous & ~mask) | (number << shift));
      }
    }
    result.stateOverrides[address.toLowerCase()] = { value: storage };
  }
  return result;
}
