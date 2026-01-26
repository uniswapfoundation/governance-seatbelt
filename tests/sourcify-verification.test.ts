import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';

describe('Sourcify-first verification', () => {
  it('prefers Sourcify exact_match over block explorer', async () => {
    BlockExplorerFactory.clear();

    const chainId = 1;
    const address = getAddress('0x0000000000000000000000000000000000000007');

    const cachePath = join(process.cwd(), 'cache', 'verification', `${chainId}-${address}.json`);
    if (existsSync(cachePath)) unlinkSync(cachePath);

    const originalFetch = globalThis.fetch;
    let etherscanCalled = false;

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(urlString);

      if (
        url.origin === 'https://sourcify.dev' &&
        url.pathname === `/server/v2/contract/${chainId}/${address}`
      ) {
        return new Response(
          JSON.stringify({
            match: 'exact_match',
            creationMatch: 'exact_match',
            runtimeMatch: 'exact_match',
            verifiedAt: '2024-01-01T00:00:00Z',
            chainId: String(chainId),
            address,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.hostname === 'api.etherscan.io') {
        etherscanCalled = true;
        return new Response(JSON.stringify({ status: '0', result: 'NOTOK' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch in test: ${url.toString()}`);
    }) as typeof fetch;

    try {
      const verified = await BlockExplorerFactory.isContractVerified(address, chainId);
      expect(verified).toBe(true);
      expect(etherscanCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
