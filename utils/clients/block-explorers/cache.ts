import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Abi, getAddress } from 'viem';

// Cache directory path - use a non-gitignored location
const CACHE_DIR = join(process.cwd(), 'cache');
const ABI_CACHE_DIR = join(CACHE_DIR, 'abis');
const VERIFICATION_CACHE_DIR = join(CACHE_DIR, 'verification');
const CONTRACT_NAME_CACHE_DIR = join(CACHE_DIR, 'contract-names');

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_TTL_MS = 30 * DAY_MS;
const UNVERIFIED_TTL_MS = 1 * DAY_MS;
const CONTRACT_NAME_TTL_MS = 30 * DAY_MS;

// Ensure cache directories exist
if (!existsSync(ABI_CACHE_DIR)) {
  mkdirSync(ABI_CACHE_DIR, { recursive: true });
}
if (!existsSync(VERIFICATION_CACHE_DIR)) {
  mkdirSync(VERIFICATION_CACHE_DIR, { recursive: true });
}
if (!existsSync(CONTRACT_NAME_CACHE_DIR)) {
  mkdirSync(CONTRACT_NAME_CACHE_DIR, { recursive: true });
}

// In-memory cache
const abiCache: Record<string, Abi> = {};

export type VerificationSource = 'sourcify' | 'block-explorer' | 'none';

export interface VerificationCacheEntry {
  schemaVersion: 2;
  verified: boolean;
  source: VerificationSource;
  timestamp: number;
  sourcifyMatch?: string;
  blockExplorer?: {
    name: string;
    verified: boolean;
  };
}

const verificationCache: Record<string, VerificationCacheEntry> = {};

export interface ContractNameCacheEntry {
  schemaVersion: 1;
  name: string;
  timestamp: number;
  source: 'block-explorer';
}

const contractNameCache: Record<string, ContractNameCacheEntry> = {};

// biome-ignore lint/complexity/noStaticOnlyClass: Cache manager with static methods
export class CacheManager {
  static clearMemory(): void {
    for (const key of Object.keys(abiCache)) delete abiCache[key];
    for (const key of Object.keys(verificationCache)) delete verificationCache[key];
    for (const key of Object.keys(contractNameCache)) delete contractNameCache[key];
  }

  static getAbiCacheKey(chainId: number, address: string): string {
    return `${chainId}:${getAddress(address)}`;
  }

  static getAbiFromMemory(chainId: number, address: string): Abi | undefined {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    return abiCache[cacheKey];
  }

  static setAbiInMemory(chainId: number, address: string, abi: Abi): void {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    abiCache[cacheKey] = abi;
  }

  static getAbiFromFile(chainId: number, address: string): Abi | null {
    const cachePath = CacheManager.getAbiCacheFilePath(chainId, address);
    if (existsSync(cachePath)) {
      try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  static setAbiInFile(chainId: number, address: string, abi: Abi): void {
    const cachePath = CacheManager.getAbiCacheFilePath(chainId, address);
    writeFileSync(cachePath, JSON.stringify(abi, null, 2));
  }

  static getVerificationFromMemory(chainId: number, address: string): boolean | undefined {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    const entry = verificationCache[cacheKey];
    if (!entry) return undefined;

    const ttlMs = entry.verified ? VERIFIED_TTL_MS : UNVERIFIED_TTL_MS;
    if (Date.now() - entry.timestamp > ttlMs) {
      delete verificationCache[cacheKey];
      return undefined;
    }

    return entry.verified;
  }

  static getVerificationEntryFromMemory(
    chainId: number,
    address: string,
  ): VerificationCacheEntry | undefined {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    const entry = verificationCache[cacheKey];
    if (!entry) return undefined;

    const ttlMs = entry.verified ? VERIFIED_TTL_MS : UNVERIFIED_TTL_MS;
    if (Date.now() - entry.timestamp > ttlMs) {
      delete verificationCache[cacheKey];
      return undefined;
    }

    return entry;
  }

  static setVerificationEntryInMemory(
    chainId: number,
    address: string,
    entry: VerificationCacheEntry,
  ): void {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    verificationCache[cacheKey] = entry;
  }

  static setVerificationInMemory(
    chainId: number,
    address: string,
    verified: boolean,
    options?: Omit<VerificationCacheEntry, 'schemaVersion' | 'verified' | 'timestamp'>,
  ): void {
    CacheManager.setVerificationEntryInMemory(chainId, address, {
      schemaVersion: 2,
      verified,
      source: options?.source ?? 'block-explorer',
      sourcifyMatch: options?.sourcifyMatch,
      blockExplorer: options?.blockExplorer,
      timestamp: Date.now(),
    });
  }

  static getVerificationFromFile(chainId: number, address: string): boolean | null {
    const entry = CacheManager.getVerificationEntryFromFile(chainId, address);
    return entry ? entry.verified : null;
  }

  static getVerificationEntryFromFile(
    chainId: number,
    address: string,
  ): VerificationCacheEntry | null {
    const cachePath = CacheManager.getVerificationCacheFilePath(chainId, address);
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as unknown;

        if (!cached || typeof cached !== 'object') {
          CacheManager.deleteCacheFile(cachePath);
          return null;
        }

        const cachedObj = cached as Record<string, unknown>;

        if (cachedObj.schemaVersion === 2) {
          const verified = cachedObj.verified;
          const timestamp = cachedObj.timestamp;
          const source = cachedObj.source;

          if (typeof verified !== 'boolean') {
            CacheManager.deleteCacheFile(cachePath);
            return null;
          }
          if (typeof timestamp !== 'number') {
            CacheManager.deleteCacheFile(cachePath);
            return null;
          }
          if (source !== 'sourcify' && source !== 'block-explorer' && source !== 'none') {
            CacheManager.deleteCacheFile(cachePath);
            return null;
          }

          const sourcifyMatch =
            typeof cachedObj.sourcifyMatch === 'string' ? cachedObj.sourcifyMatch : undefined;

          let blockExplorer: VerificationCacheEntry['blockExplorer'];
          const be = cachedObj.blockExplorer;
          if (be && typeof be === 'object') {
            const beObj = be as Record<string, unknown>;
            if (typeof beObj.name === 'string' && typeof beObj.verified === 'boolean') {
              blockExplorer = { name: beObj.name, verified: beObj.verified };
            }
          }

          const entry: VerificationCacheEntry = {
            schemaVersion: 2,
            verified,
            source,
            timestamp,
            sourcifyMatch,
            blockExplorer,
          };

          const ttlMs = verified ? VERIFIED_TTL_MS : UNVERIFIED_TTL_MS;
          if (Date.now() - timestamp > ttlMs) {
            CacheManager.deleteCacheFile(cachePath);
            return null;
          }

          return entry;
        }

        // Legacy schema: { verified: boolean, timestamp: number }
        // Treat legacy "verified: false" as stale so new verification sources (e.g. Sourcify) can re-check.
        if (typeof cachedObj.verified === 'boolean') {
          if (cachedObj.verified === true) {
            const timestamp =
              typeof cachedObj.timestamp === 'number' ? cachedObj.timestamp : Date.now();

            if (Date.now() - timestamp > VERIFIED_TTL_MS) {
              CacheManager.deleteCacheFile(cachePath);
              return null;
            }

            return {
              schemaVersion: 2,
              verified: true,
              source: 'block-explorer',
              timestamp,
            };
          }

          CacheManager.deleteCacheFile(cachePath);
          return null;
        }

        CacheManager.deleteCacheFile(cachePath);
      } catch {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }
    }
    return null;
  }

  static setVerificationInFile(
    chainId: number,
    address: string,
    verified: boolean,
    options?: Omit<VerificationCacheEntry, 'schemaVersion' | 'verified' | 'timestamp'>,
  ): void {
    const cachePath = CacheManager.getVerificationCacheFilePath(chainId, address);
    const entry: VerificationCacheEntry = {
      schemaVersion: 2,
      verified,
      source: options?.source ?? 'block-explorer',
      sourcifyMatch: options?.sourcifyMatch,
      blockExplorer: options?.blockExplorer,
      timestamp: Date.now(),
    };
    writeFileSync(cachePath, JSON.stringify(entry));
  }

  private static getAbiCacheFilePath(chainId: number, address: string): string {
    return join(ABI_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
  }

  private static getVerificationCacheFilePath(chainId: number, address: string): string {
    return join(VERIFICATION_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
  }

  static getContractNameFromMemory(chainId: number, address: string): string | undefined {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    const entry = contractNameCache[cacheKey];
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > CONTRACT_NAME_TTL_MS) {
      delete contractNameCache[cacheKey];
      return undefined;
    }

    return entry.name;
  }

  static getContractNameFromFile(chainId: number, address: string): string | null {
    const entry = CacheManager.getContractNameEntryFromFile(chainId, address);
    return entry ? entry.name : null;
  }

  static setContractNameInMemory(chainId: number, address: string, name: string): void {
    const normalized = name.trim();
    if (normalized.length === 0) return;

    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    contractNameCache[cacheKey] = {
      schemaVersion: 1,
      name: normalized,
      timestamp: Date.now(),
      source: 'block-explorer',
    };
  }

  static setContractNameInFile(chainId: number, address: string, name: string): void {
    const normalized = name.trim();
    if (normalized.length === 0) return;

    const cachePath = CacheManager.getContractNameCacheFilePath(chainId, address);
    const entry: ContractNameCacheEntry = {
      schemaVersion: 1,
      name: normalized,
      timestamp: Date.now(),
      source: 'block-explorer',
    };
    writeFileSync(cachePath, JSON.stringify(entry));
  }

  private static getContractNameEntryFromFile(
    chainId: number,
    address: string,
  ): ContractNameCacheEntry | null {
    const cachePath = CacheManager.getContractNameCacheFilePath(chainId, address);
    if (!existsSync(cachePath)) return null;

    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as unknown;
      if (!cached || typeof cached !== 'object') {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }

      const cachedObj = cached as Record<string, unknown>;
      if (cachedObj.schemaVersion !== 1) {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }

      const name = cachedObj.name;
      const timestamp = cachedObj.timestamp;
      const source = cachedObj.source;

      if (typeof name !== 'string' || name.trim().length === 0) {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }
      if (typeof timestamp !== 'number') {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }
      if (source !== 'block-explorer') {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }

      if (Date.now() - timestamp > CONTRACT_NAME_TTL_MS) {
        CacheManager.deleteCacheFile(cachePath);
        return null;
      }

      return {
        schemaVersion: 1,
        name: name.trim(),
        timestamp,
        source: 'block-explorer',
      };
    } catch {
      CacheManager.deleteCacheFile(cachePath);
      return null;
    }
  }

  private static getContractNameCacheFilePath(chainId: number, address: string): string {
    return join(CONTRACT_NAME_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
  }

  private static deleteCacheFile(path: string): void {
    try {
      rmSync(path, { force: true });
    } catch {
      // ignore
    }
  }
}
