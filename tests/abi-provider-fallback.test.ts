import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { CacheManager } from '../utils/clients/block-explorers/cache';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { CHAIN_CONFIGS } from '../utils/clients/client';
import { SourcifyClient } from '../utils/clients/sourcify';
import { setMockFetch, toFetchUrl, uniqueAddress } from './helpers/verification-test-helpers';

const chainId = 5042;
const abi = parseAbi(['function setFeeTo(address feeTo)']);
const recipient = uniqueAddress(7000);
const calldata = encodeFunctionData({ abi, functionName: 'setFeeTo', args: [recipient] });
const cacheFiles = new Set<string>();

function cachePath(address: string) {
  const path = join(process.cwd(), 'cache', 'abis', `${chainId}-${address}.json`);
  cacheFiles.add(path);
  return path;
}

afterEach(() => {
  for (const path of cacheFiles) if (existsSync(path)) unlinkSync(path);
  cacheFiles.clear();
  BlockExplorerFactory.clear();
  SourcifyClient.clearCache();
});

// Only provider HTTP responses are doubled: availability and rate limits cannot
// be deterministic in CI. Exercise the real factory, providers, disk cache, and viem decoder.
describe('ABI provider fallback integration', () => {
  for (const [index, source] of ['Etherscan', 'Blockscout', 'Sourcify', 'none'].entries()) {
    test(`decodes through ${source} and stops at the first verified ABI`, async () => {
      const address = uniqueAddress(7100 + index);
      const path = cachePath(address);
      if (existsSync(path)) unlinkSync(path);
      BlockExplorerFactory.clear();
      const requested: string[] = [];
      const config = CHAIN_CONFIGS[chainId];
      const originalVerification = config.verification;
      config.verification = { ...originalVerification!, apiKey: 'test-key' };
      const restore = setMockFetch(async (input) => {
        const url = toFetchUrl(input);
        if (url.hostname === 'api.etherscan.io') {
          requested.push('Etherscan');
          // A malformed successful response must not prevent the next provider.
          if (source === 'Sourcify') return Response.json({ malformed: true });
          return Response.json(
            source === 'Etherscan'
              ? { status: '1', result: JSON.stringify(abi) }
              : { status: '0', result: 'Contract source code not verified' },
          );
        }
        if (url.hostname === 'explorer.arc.io') {
          requested.push('Blockscout');
          // An ABI attached to an unverified contract must not be accepted.
          return Response.json({ is_verified: source === 'Blockscout', abi });
        }
        if (url.hostname === 'sourcify.dev') {
          requested.push('Sourcify');
          expect(url.searchParams.get('fields')).toBe('abi');
          return Response.json({
            address,
            chainId: String(chainId),
            match: source === 'Sourcify' ? 'match' : null,
            abi: source === 'Sourcify' ? abi : null,
          });
        }
        throw new Error('Unexpected external request');
      });
      try {
        const decoded = await BlockExplorerFactory.decodeFunctionWithAbi(
          address,
          calldata,
          chainId,
        );
        expect(requested).toEqual(
          ['Etherscan', 'Blockscout', 'Sourcify'].slice(0, Math.min(index + 1, 3)),
        );
        if (source === 'none') {
          expect(decoded).toBeNull();
          expect(existsSync(path)).toBe(false);
        } else {
          expect(decoded).toEqual({ name: 'setFeeTo', args: [recipient], source });
          // Prove provider provenance survives a new process's memory state.
          BlockExplorerFactory.clear();
          expect(
            await BlockExplorerFactory.decodeFunctionWithAbi(address, calldata, chainId),
          ).toEqual(decoded);
          expect(requested.length).toBe(index + 1);
          expect(CacheManager.getAbiFromMemory(1, address)).toBeUndefined();
        }
      } finally {
        restore();
        config.verification = originalVerification;
      }
    }, 15000);
  }

  test('uses Sourcify when Etherscan has no key and Blockscout returns 404', async () => {
    const address = uniqueAddress(7300);
    const path = cachePath(address);
    if (existsSync(path)) unlinkSync(path);
    BlockExplorerFactory.clear();
    const config = CHAIN_CONFIGS[chainId];
    const originalVerification = config.verification;
    config.verification = { ...originalVerification!, apiKey: '' };
    const requested: string[] = [];
    const restore = setMockFetch(async (input) => {
      const url = toFetchUrl(input);
      requested.push(url.hostname);
      if (url.hostname === 'explorer.arc.io') return new Response(null, { status: 404 });
      if (url.hostname === 'sourcify.dev') {
        return Response.json({ address, chainId, match: 'exact_match', abi });
      }
      throw new Error('Unexpected external request');
    });
    try {
      expect(await BlockExplorerFactory.decodeFunctionWithAbi(address, calldata, chainId)).toEqual({
        name: 'setFeeTo',
        args: [recipient],
        source: 'Sourcify',
      });
      expect(requested).toEqual(['explorer.arc.io', 'sourcify.dev']);
    } finally {
      restore();
      config.verification = originalVerification;
    }
  });

  test('reads existing ABI cache files without inventing a provider', async () => {
    const address = uniqueAddress(7200);
    writeFileSync(cachePath(address), JSON.stringify(abi));
    BlockExplorerFactory.clear();
    const decoded = await BlockExplorerFactory.decodeFunctionWithAbi(address, calldata, chainId);
    expect(decoded?.name).toBe('setFeeTo');
    expect(decoded?.source).toBeUndefined();
  });
});
