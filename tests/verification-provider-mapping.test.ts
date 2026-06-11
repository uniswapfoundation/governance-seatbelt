import { describe, expect, test } from 'bun:test';
import { tempo, worldchain, xLayer, zora } from 'viem/chains';
import { megaeth } from '../utils/chains/megaeth';
import {
  seedRpcEnv,
  setMockFetch,
  sourcifyNotFoundResponse,
  toFetchUrl,
  uniqueAddress,
} from './helpers/verification-test-helpers';

describe('verification backend provider mapping', () => {
  test('maps chain verification backends explicitly', async () => {
    seedRpcEnv();

    const { VerificationBackend, getChainConfig } = await import('../utils/clients/client');

    expect(getChainConfig(zora.id).verification?.backend).toBe(VerificationBackend.Blockscout);
    expect(getChainConfig(worldchain.id).verification?.backend).toBe(
      VerificationBackend.EtherscanV2,
    );
    expect(getChainConfig(xLayer.id).verification?.backend).toBe(VerificationBackend.SourcifyOnly);
    expect(getChainConfig(tempo.id).verification?.backend).toBe(VerificationBackend.Tempo);
    expect(getChainConfig(megaeth.id).verification?.backend).toBe(VerificationBackend.EtherscanV2);
  });

  test('does not call unsupported explorer APIs for Sourcify-only chains', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(11);
    const chainId = xLayer.id;

    let sourcifyCalls = 0;
    let nonSourcifyCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        sourcifyCalls += 1;
        return sourcifyNotFoundResponse(chainId, address);
      }

      nonSourcifyCalls += 1;
      throw new Error(`Unexpected non-Sourcify call: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      BlockExplorerFactory.clear();
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('unknown');
      expect(result.source).toBe('unknown');
      expect(result.reason).toContain('Sourcify only');
      expect(sourcifyCalls).toBeGreaterThan(0);
      expect(nonSourcifyCalls).toBe(0);

      const sourcifyCallsAfterFirstCheck = sourcifyCalls;
      BlockExplorerFactory.clear();

      const cachedResult = await BlockExplorerFactory.getContractVerification(address, chainId);
      expect(cachedResult.status).toBe('unknown');
      expect(cachedResult.source).toBe('unknown');
      expect(sourcifyCalls).toBeGreaterThan(sourcifyCallsAfterFirstCheck);
      expect(nonSourcifyCalls).toBe(0);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });

  test('ignores stale cache entries written with a different verification backend', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(1024);
    const chainId = zora.id;

    BlockExplorerFactory.clear();
    CacheManager.setVerificationEntryInMemory(chainId, address, {
      schemaVersion: 2,
      verified: true,
      source: 'block-explorer',
      verificationBackend: 'etherscan-v2',
      blockExplorer: { name: 'Etherscan', verified: true },
      timestamp: Date.now(),
    });

    let blockscoutCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.toString().includes('explorer.zora.energy/api/v2/smart-contracts')) {
        blockscoutCalls += 1;
        return new Response(
          JSON.stringify({ is_verified: false, is_partially_verified: false, abi: null }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('unverified');
      expect(result.source).toBe('none');
      expect(blockscoutCalls).toBeGreaterThan(0);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });

  test('uses Blockscout backend for Zora instead of Etherscan v2', async () => {
    seedRpcEnv();

    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const address = uniqueAddress(12);
    const chainId = zora.id;

    let blockscoutCalls = 0;
    let etherscanCalls = 0;

    const restoreFetch = setMockFetch(async (input, _init) => {
      const url = toFetchUrl(input);

      if (url.hostname === 'sourcify.dev') {
        return sourcifyNotFoundResponse(chainId, address);
      }

      if (url.toString().includes('explorer.zora.energy/api/v2/smart-contracts')) {
        blockscoutCalls += 1;
        return new Response(
          JSON.stringify({
            is_verified: true,
            is_partially_verified: false,
            abi: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.hostname === 'api.etherscan.io') {
        etherscanCalls += 1;
      }

      throw new Error(`Unexpected fetch URL: ${url.toString()}`);
    });

    const originalSetVerificationInFile = CacheManager.setVerificationInFile;
    CacheManager.setVerificationInFile = () => {};

    try {
      BlockExplorerFactory.clear();
      const result = await BlockExplorerFactory.getContractVerification(address, chainId);

      expect(result.status).toBe('verified');
      expect(result.source).toBe('block-explorer');
      expect(blockscoutCalls).toBeGreaterThan(0);
      expect(etherscanCalls).toBe(0);
    } finally {
      restoreFetch();
      CacheManager.setVerificationInFile = originalSetVerificationInFile;
    }
  });
});
