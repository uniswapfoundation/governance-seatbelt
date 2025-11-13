import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Abi, getAddress } from 'viem';

// Cache directory path - use a non-gitignored location
const CACHE_DIR = join(process.cwd(), 'cache');
const ABI_CACHE_DIR = join(CACHE_DIR, 'abis');
const VERIFICATION_CACHE_DIR = join(CACHE_DIR, 'verification');

// Ensure cache directories exist
if (!existsSync(ABI_CACHE_DIR)) {
  mkdirSync(ABI_CACHE_DIR, { recursive: true });
}
if (!existsSync(VERIFICATION_CACHE_DIR)) {
  mkdirSync(VERIFICATION_CACHE_DIR, { recursive: true });
}

// In-memory cache
const abiCache: Record<string, Abi> = {};
const verificationCache: Record<string, boolean> = {};

// biome-ignore lint/complexity/noStaticOnlyClass: Cache manager with static methods
export class CacheManager {
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
    return verificationCache[cacheKey];
  }

  static setVerificationInMemory(chainId: number, address: string, verified: boolean): void {
    const cacheKey = CacheManager.getAbiCacheKey(chainId, address);
    verificationCache[cacheKey] = verified;
  }

  static getVerificationFromFile(chainId: number, address: string): boolean | null {
    const cachePath = CacheManager.getVerificationCacheFilePath(chainId, address);
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
        return cached.verified;
      } catch {
        return null;
      }
    }
    return null;
  }

  static setVerificationInFile(chainId: number, address: string, verified: boolean): void {
    const cachePath = CacheManager.getVerificationCacheFilePath(chainId, address);
    writeFileSync(cachePath, JSON.stringify({ verified, timestamp: Date.now() }));
  }

  private static getAbiCacheFilePath(chainId: number, address: string): string {
    return join(ABI_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
  }

  private static getVerificationCacheFilePath(chainId: number, address: string): string {
    return join(VERIFICATION_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
  }
}
