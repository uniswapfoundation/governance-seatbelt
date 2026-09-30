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
import { compileStorageSource, layoutSchema } from '../storage-layout';
import { z } from '../validation/zod';
import { BlockExplorerFactory } from './block-explorers/factory';
import { getClientForChain } from './client';
import type { StateOverridesPayload } from './tenderly-api';

type Layout = z.infer<typeof layoutSchema>;
const layouts = new Map<string, Layout>();

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
  const key = `${chainId}:${sourceAddress}`;
  const cached = layouts.get(key);
  if (cached) return cached;
  for (const provider of BlockExplorerFactory.getExplorers(chainId)) {
    const source = await provider.fetchContractSource?.(sourceAddress, chainId);
    if (!source) continue;
    const output = z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .parse(await compileStorageSource(source));
    const candidates = source.fileName
      ? [output[source.fileName]?.[source.contractName]]
      : Object.values(output).map((file) => file[source.contractName]);
    for (const candidate of candidates) {
      const parsed = z.object({ storageLayout: layoutSchema }).safeParse(candidate);
      if (!parsed.success || !parsed.data.storageLayout.storage.length) continue;
      layouts.set(key, parsed.data.storageLayout);
      return parsed.data.storageLayout;
    }
  }
  throw new Error('Verified-source storage layout unavailable');
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
