import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Hex, getAddress, keccak256 } from 'viem';
import type { RawElement, SimulationStateChange } from '../types';
import { BlockExplorerFactory } from './clients/block-explorers/factory';
import type { SoliditySource } from './clients/block-explorers/source';
import { z } from './validation/zod';

const layoutSchema = z.object({
  storage: z.array(
    z.object({
      label: z.string(),
      slot: z.string().regex(/^\d+$/),
      offset: z.number().int().min(0).max(31),
      type: z.string(),
    }),
  ),
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

async function compile(source: SoliditySource): Promise<unknown> {
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
          '*': [
            'storageLayout',
            'evm.deployedBytecode.object',
            'evm.deployedBytecode.immutableReferences',
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
    child.stdin?.end(JSON.stringify(input));
  });
}

/** Constructor-set immutables do not occupy storage; every other runtime byte must match. */
function matchesRuntime(
  compiled: string,
  runtime: string,
  immutableReferences: Record<string, { start: number; length: number }[]>,
): boolean {
  if (compiled.length !== runtime.length) return false;
  const ranges = Object.values(immutableReferences)
    .flat()
    .sort((a, b) => a.start - b.start);
  let end = 0;
  for (const range of ranges) {
    const start = range.start * 2;
    const nextEnd = (range.start + range.length) * 2;
    if (
      start < end ||
      nextEnd > compiled.length ||
      compiled.slice(end, start) !== runtime.slice(end, start)
    )
      return false;
    end = nextEnd;
  }
  return compiled.slice(end) === runtime.slice(end);
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
    const contractSchema = z.object({
      storageLayout: layoutSchema,
      evm: z.object({
        deployedBytecode: z.object({
          object: z.string(),
          immutableReferences: z
            .record(
              z.string(),
              z.array(
                z.object({ start: z.number().int().min(0), length: z.number().int().min(1) }),
              ),
            )
            .default({}),
        }),
      }),
    });
    for (const provider of BlockExplorerFactory.getExplorers(chainId)) {
      try {
        const source = await provider.fetchContractSource?.(address, chainId);
        if (!source) continue;
        const output = z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .parse(await compile(source));
        const candidates = source.fileName
          ? [output[source.fileName]?.[source.contractName]]
          : Object.values(output).map((file) => file[source.contractName]);
        for (const candidate of candidates) {
          const parsed = contractSchema.safeParse(candidate);
          if (
            !parsed.success ||
            !matchesRuntime(
              parsed.data.evm.deployedBytecode.object.toLowerCase(),
              runtime.slice(2).toLowerCase(),
              parsed.data.evm.deployedBytecode.immutableReferences,
            )
          )
            continue;
          const result = {
            layout: parsed.data.storageLayout,
            source: provider.getName(),
            compilerVersion: source.compilerVersion,
          };
          await mkdir(resolve('cache/storage-layouts'), { recursive: true });
          await writeFile(path, JSON.stringify(result));
          return result;
        }
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

/** Decode only elementary fields; mappings, arrays and structs retain raw writes. */
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
