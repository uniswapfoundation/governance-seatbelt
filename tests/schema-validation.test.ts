import { describe, expect, it } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BlockscoutExplorer } from '../utils/clients/block-explorers/blockscout';
import { CacheManager } from '../utils/clients/block-explorers/cache';
import { EtherscanExplorer } from '../utils/clients/block-explorers/etherscan';
import { SourcifyClient } from '../utils/clients/sourcify';
import { SchemaValidationError } from '../utils/validation/zod';

describe('Schema validation at API boundaries', () => {
  it('throws for invalid Etherscan getabi response', async () => {
    const originalFetch = globalThis.fetch;
    const explorerProto = EtherscanExplorer.prototype as unknown as {
      delay: () => Promise<void>;
    };
    const originalDelay = explorerProto.delay;
    explorerProto.delay = async () => {};
    CacheManager.clearMemory();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: '1', result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const chainId = 1;
      const address = '0x0000000000000000000000000000000000000001';
      const cachePath = join(process.cwd(), 'cache', 'abis', `${chainId}-${address}.json`);
      if (existsSync(cachePath)) unlinkSync(cachePath);

      const explorer = new EtherscanExplorer('test-key');
      await expect(explorer.fetchContractAbi(address, chainId)).rejects.toBeInstanceOf(
        SchemaValidationError,
      );
    } finally {
      explorerProto.delay = originalDelay;
      globalThis.fetch = originalFetch;
    }
  });

  it('throws for invalid Blockscout contract response', async () => {
    const originalFetch = globalThis.fetch;
    const explorerProto = BlockscoutExplorer.prototype as unknown as {
      delay: () => Promise<void>;
    };
    const originalDelay = explorerProto.delay;
    explorerProto.delay = async () => {};
    CacheManager.clearMemory();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ is_verified: 'true', abi: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const chainId = 1;
      const address = '0x0000000000000000000000000000000000000001';
      const cachePath = join(process.cwd(), 'cache', 'abis', `${chainId}-${address}.json`);
      if (existsSync(cachePath)) unlinkSync(cachePath);

      const explorer = new BlockscoutExplorer(
        'https://blockscout.test',
        'https://api.blockscout.test',
      );
      await expect(explorer.fetchContractAbi(address, chainId)).rejects.toBeInstanceOf(
        SchemaValidationError,
      );
    } finally {
      explorerProto.delay = originalDelay;
      globalThis.fetch = originalFetch;
    }
  });

  it('throws for invalid Sourcify response shape', async () => {
    const originalFetch = globalThis.fetch;
    SourcifyClient.clearCache();

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ not: 'a v2 response' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      await expect(
        SourcifyClient.isContractVerified('0x0000000000000000000000000000000000000001', 1),
      ).rejects.toBeInstanceOf(SchemaValidationError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
