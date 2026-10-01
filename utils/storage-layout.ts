import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Hex, decodeAbiParameters, encodeAbiParameters, getAddress, keccak256 } from 'viem';
import type { RawElement, SimulationStateChange } from '../types';
import { BlockExplorerFactory } from './clients/block-explorers/factory';
import type { SoliditySource } from './clients/block-explorers/source';
import { z } from './validation/zod';

const fieldSchema = z.object({
  label: z.string(),
  slot: z.string().regex(/^\d+$/),
  offset: z.number().int().min(0).max(31),
  type: z.string(),
});
const layoutSchema = z.object({
  storage: z.array(fieldSchema),
  types: z.record(
    z.string(),
    z.object({
      encoding: z.string(),
      label: z.string(),
      numberOfBytes: z.string(),
    }),
  ),
});
const verifiedLayoutSchema = z.object({
  layout: layoutSchema,
  mappings: z.array(
    z.object({
      selector: z.string().regex(/^[0-9a-f]{8}$/),
      inputTypes: z.array(z.string().regex(/^(uint\d+|bytes32|address)$/)),
      keyIndex: z.number().int().min(0),
      valueIndex: z.number().int().min(0),
      baseSlot: z.string().regex(/^\d+$/),
      name: z.string(),
      field: fieldSchema,
      type: z.object({
        encoding: z.literal('inplace'),
        label: z.string(),
        numberOfBytes: z.string(),
      }),
    }),
  ),
  source: z.string(),
  compilerVersion: z.string(),
});
type VerifiedLayout = z.infer<typeof verifiedLayoutSchema>;
const layouts = new Map<string, Promise<VerifiedLayout | null>>();
const compilers = new Map<string, Promise<string>>();

async function downloadCompiler(version: string): Promise<string> {
  const require = createRequire(import.meta.url);
  if (require('solc/package.json').version === version.replace(/^v/, '').split('+')[0]) {
    return require.resolve('solc/soljson.js');
  }
  const base = 'https://binaries.soliditylang.org/bin/';
  const response = await fetch(`${base}list.json`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Compiler index unavailable');
  const index = z
    .object({
      builds: z.array(z.object({ path: z.string(), longVersion: z.string(), sha256: z.string() })),
    })
    .parse(await response.json());
  const build = index.builds.find((b) => b.longVersion === version.replace(/^v/, ''));
  if (!build || !/^soljson-v[\w.+-]+\.js$/.test(build.path))
    throw new Error('Compiler unavailable');
  const path = resolve('cache/compilers', `${build.path}.cjs`);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    const download = await fetch(`${base}${build.path}`, { signal: AbortSignal.timeout(20000) });
    if (!download.ok) throw new Error('Compiler download unavailable');
    bytes = Buffer.from(await download.arrayBuffer());
  }
  if (`0x${createHash('sha256').update(bytes).digest('hex')}` !== build.sha256)
    throw new Error('Compiler checksum mismatch');
  await mkdir(resolve('cache/compilers'), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

async function compile(source: SoliditySource, runtime: Hex): Promise<unknown> {
  let pending = compilers.get(source.compilerVersion);
  if (!pending) {
    pending = downloadCompiler(source.compilerVersion);
    compilers.set(source.compilerVersion, pending);
  }
  const compiler = await pending;
  const input = {
    ...source.input,
    settings: {
      ...source.input.settings,
      outputSelection: {
        '*': {
          '': ['ast'],
          '*': [
            'storageLayout',
            'evm.deployedBytecode.object',
            'evm.deployedBytecode.immutableReferences',
            'evm.deployedBytecode.linkReferences',
          ],
        },
      },
    },
  };
  return new Promise((resolveOutput, reject) => {
    const child = execFile(
      process.execPath,
      [
        fileURLToPath(new URL('./storage-layout-compiler.cjs', import.meta.url)),
        compiler,
        source.compilerVersion.replace(/^v/, ''),
      ],
      { timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('Storage layout compilation failed'));
        try {
          resolveOutput(JSON.parse(stdout));
        } catch {
          reject(new Error('Invalid compiler output'));
        }
      },
    );
    child.stdin?.on('error', () => reject(new Error('Compiler input failed')));
    child.stdin?.end(
      JSON.stringify({
        input,
        runtime,
        contractName: source.contractName,
        fileName: source.fileName,
      }),
    );
  });
}

/** Only use layouts whose code matches at the simulation block, apart from declared immutables. */
export async function getVerifiedStorageLayout(
  address: string,
  chainId: number,
  runtime: Hex,
): Promise<VerifiedLayout | null> {
  const hash = keccak256(runtime);
  const key = `${chainId}:${getAddress(address)}:${hash}`;
  const cached = layouts.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const path = resolve('cache/storage-layouts', `${chainId}-${getAddress(address)}-${hash}.json`);
    try {
      return verifiedLayoutSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      /* cache miss */
    }
    for (const provider of BlockExplorerFactory.getExplorers(chainId)) {
      try {
        const source = await provider.fetchContractSource?.(address, chainId);
        if (!source) continue;
        const compiled = await compile(source, runtime);
        if (!compiled) continue;
        const result = verifiedLayoutSchema.parse({
          ...(compiled as object),
          source: provider.getName(),
          compilerVersion: source.compilerVersion,
        });
        await mkdir(resolve('cache/storage-layouts'), { recursive: true });
        await writeFile(path, JSON.stringify(result));
        return result;
      } catch {
        console.warn(
          `Storage layout unavailable via ${provider.getName()} for ${address} on chain ${chainId}`,
        );
      }
    }
    return null;
  })();
  layouts.set(key, pending);
  return pending;
}

/** Decode elementary fields only when every changed bit belongs to a known field. */
export function decodeStorageWrite(
  write: RawElement,
  contract: string,
  verified: VerifiedLayout,
): SimulationStateChange[] {
  if (![write.key, write.original, write.dirty].every((v) => /^0x[0-9a-fA-F]{1,64}$/.test(v)))
    return [];
  const changes: SimulationStateChange[] = [];
  let decodedMask = 0n;
  for (const field of verified.layout.storage) {
    if (BigInt(field.slot) !== BigInt(write.key)) continue;
    const type = verified.layout.types[field.type];
    const size = Number(type?.numberOfBytes);
    if (
      !type ||
      type.encoding !== 'inplace' ||
      !Number.isInteger(size) ||
      size < 1 ||
      field.offset + size > 32
    )
      continue;
    const mask = (1n << BigInt(size * 8)) - 1n;
    const decode = (raw: string): string | null => {
      const value = (BigInt(raw) >> BigInt(field.offset * 8)) & mask;
      if (type.label === 'address' || type.label === 'address payable')
        return getAddress(`0x${value.toString(16).padStart(40, '0')}`);
      if (type.label === 'bool') return value <= 1n ? String(value === 1n) : null;
      if (/^uint\d*$/.test(type.label) || type.label.startsWith('enum ')) return value.toString();
      if (/^int\d*$/.test(type.label)) return BigInt.asIntN(size * 8, value).toString();
      if (/^bytes\d+$/.test(type.label)) return `0x${value.toString(16).padStart(size * 2, '0')}`;
      return null;
    };
    const oldValue = decode(write.original);
    const newValue = decode(write.dirty);
    if (oldValue === null || newValue === null || oldValue === newValue) continue;
    decodedMask |= mask << BigInt(field.offset * 8);
    changes.push({
      contract,
      contractAddress: write.address,
      key: write.key,
      label: field.label,
      oldValue,
      newValue,
      storageDetails: {
        oldValue: write.original,
        newValue: write.dirty,
        source: verified.source,
        compilerVersion: verified.compilerVersion,
      },
    });
  }
  return ((BigInt(write.original) ^ BigInt(write.dirty)) & ~decodedMask) === 0n ? changes : [];
}

/** Bind compiler-derived mapping fields to executed calldata and the actual slot/value written. */
export function decodeMappingWrite(
  write: RawElement,
  contract: string,
  verified: VerifiedLayout,
  inputs: string[],
): SimulationStateChange[] {
  const fields: z.infer<typeof fieldSchema>[] = [];
  const types: VerifiedLayout['layout']['types'] = {};
  for (const input of inputs) {
    for (const assignment of verified.mappings) {
      if (input.slice(2, 10) !== assignment.selector) continue;
      try {
        const args = decodeAbiParameters(
          assignment.inputTypes.map((type) => ({ type })),
          `0x${input.slice(10)}`,
        );
        const key = args[assignment.keyIndex];
        const value = BigInt(args[assignment.valueIndex] as string | bigint);
        const hashed = keccak256(
          encodeAbiParameters(
            [{ type: assignment.inputTypes[assignment.keyIndex] }, { type: 'uint256' }],
            [key, BigInt(assignment.baseSlot)],
          ),
        );
        const slot = BigInt(hashed) + BigInt(assignment.field.slot);
        const mask = (1n << BigInt(Number(assignment.type.numberOfBytes) * 8)) - 1n;
        if (
          slot !== BigInt(write.key) ||
          value < 0n ||
          value > mask ||
          ((BigInt(write.dirty) >> BigInt(assignment.field.offset * 8)) & mask) !== value
        )
          continue;
        const label = `${assignment.name}[${key}]${assignment.field.label ? `.${assignment.field.label}` : ''}`;
        if (fields.some((field) => field.label === label)) continue;
        fields.push({ ...assignment.field, slot: slot.toString(), type: label, label });
        types[label] = assignment.type;
      } catch {
        // Invalid or unsupported calldata cannot establish a label.
      }
    }
  }
  return decodeStorageWrite(write, contract, { ...verified, layout: { storage: fields, types } });
}
