import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import { CacheManager } from '../utils/clients/block-explorers/cache';

describe('Cache TTL eviction', () => {
  const chainId = 1;
  const address = '0x0000000000000000000000000000000000000001';
  const normalizedAddress = getAddress(address);

  const verificationPath = join(
    process.cwd(),
    'cache',
    'verification',
    `${chainId}-${normalizedAddress}.json`,
  );
  const contractNamePath = join(
    process.cwd(),
    'cache',
    'contract-names',
    `${chainId}-${normalizedAddress}.json`,
  );

  afterEach(() => {
    CacheManager.clearMemory();
    rmSync(verificationPath, { force: true });
    rmSync(contractNamePath, { force: true });
  });

  it('treats stale unverified verification entries as cache misses and deletes them', () => {
    mkdirSync(join(process.cwd(), 'cache', 'verification'), { recursive: true });
    writeFileSync(
      verificationPath,
      JSON.stringify({
        schemaVersion: 2,
        verified: false,
        source: 'block-explorer',
        timestamp: 0,
      }),
    );

    expect(existsSync(verificationPath)).toBe(true);
    expect(CacheManager.getVerificationEntryFromFile(chainId, address)).toBeNull();
    expect(existsSync(verificationPath)).toBe(false);
  });

  it('keeps fresh verified verification entries', () => {
    mkdirSync(join(process.cwd(), 'cache', 'verification'), { recursive: true });
    writeFileSync(
      verificationPath,
      JSON.stringify({
        schemaVersion: 2,
        verified: true,
        source: 'block-explorer',
        timestamp: Date.now(),
      }),
    );

    expect(existsSync(verificationPath)).toBe(true);
    const entry = CacheManager.getVerificationEntryFromFile(chainId, address);
    expect(entry).not.toBeNull();
    expect(entry?.verified).toBe(true);
    expect(existsSync(verificationPath)).toBe(true);
  });

  it('treats stale contract-name entries as cache misses and deletes them', () => {
    mkdirSync(join(process.cwd(), 'cache', 'contract-names'), { recursive: true });
    writeFileSync(
      contractNamePath,
      JSON.stringify({
        schemaVersion: 1,
        name: 'ProxyAdmin',
        source: 'block-explorer',
        timestamp: 0,
      }),
    );

    expect(existsSync(contractNamePath)).toBe(true);
    expect(CacheManager.getContractNameFromFile(chainId, address)).toBeNull();
    expect(existsSync(contractNamePath)).toBe(false);
  });

  it('keeps fresh contract-name entries', () => {
    mkdirSync(join(process.cwd(), 'cache', 'contract-names'), { recursive: true });
    writeFileSync(
      contractNamePath,
      JSON.stringify({
        schemaVersion: 1,
        name: 'ProxyAdmin',
        source: 'block-explorer',
        timestamp: Date.now(),
      }),
    );

    expect(existsSync(contractNamePath)).toBe(true);
    expect(CacheManager.getContractNameFromFile(chainId, address)).toBe('ProxyAdmin');
    expect(existsSync(contractNamePath)).toBe(true);
  });
});
