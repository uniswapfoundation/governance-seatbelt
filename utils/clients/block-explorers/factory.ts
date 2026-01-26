import type { Abi } from 'viem';
import { getAddress } from 'viem';
import { BlockExplorerSource, getChainConfig } from '../client';
import { type SourcifyMatch, getSourcifyMatch } from '../sourcify';
import { BlockscoutExplorer } from './blockscout';
import { CacheManager } from './cache';
import { EtherscanExplorer } from './etherscan';
import type { BlockExplorer } from './index';

export type ContractVerificationStatus = 'verified' | 'unverified' | 'unknown';

export interface ContractVerificationResult {
  status: ContractVerificationStatus;
  source: 'sourcify' | 'block-explorer' | 'none' | 'unknown';
  sourcifyMatch?: string;
  blockExplorer?: { name: string };
  reason?: string;
}

// biome-ignore lint/complexity/noStaticOnlyClass: Factory pattern with static methods
export class BlockExplorerFactory {
  private static explorers: Record<number, BlockExplorer> = {};

  static getExplorer(chainId: number): BlockExplorer {
    if (!BlockExplorerFactory.explorers[chainId]) {
      const chainConfig = getChainConfig(chainId);

      if (chainConfig.blockExplorer.source === BlockExplorerSource.Blockscout) {
        BlockExplorerFactory.explorers[chainId] = new BlockscoutExplorer(
          chainConfig.blockExplorer.baseUrl,
          chainConfig.blockExplorer.apiUrl,
        );
      } else {
        // Use Etherscan for other chains
        BlockExplorerFactory.explorers[chainId] = new EtherscanExplorer(
          chainConfig.blockExplorer.apiKey || '',
        );
      }
    }

    return BlockExplorerFactory.explorers[chainId];
  }

  /**
   * Fetch contract ABI from the appropriate block explorer
   */
  static async fetchContractAbi(address: string, chainId: number): Promise<Abi | null> {
    try {
      const explorer = BlockExplorerFactory.getExplorer(chainId);
      return await explorer.fetchContractAbi(address, chainId);
    } catch (error) {
      console.warn(`Failed to fetch ABI for ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Fetch contract name from the appropriate block explorer (best-effort).
   */
  static async fetchContractName(address: string, chainId: number): Promise<string | null> {
    try {
      const explorer = BlockExplorerFactory.getExplorer(chainId);
      return await explorer.fetchContractName(address, chainId);
    } catch (error) {
      console.warn(`Failed to fetch contract name for ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Get contract verification status with a distinct "unknown" state for API failures.
   */
  static async getContractVerification(
    address: string,
    chainId: number,
  ): Promise<ContractVerificationResult> {
    try {
      const normalizedAddress = getAddress(address);

      const memoryEntry = CacheManager.getVerificationEntryFromMemory(chainId, normalizedAddress);
      if (memoryEntry) {
        return {
          status: memoryEntry.verified ? 'verified' : 'unverified',
          source: memoryEntry.source,
          sourcifyMatch: memoryEntry.sourcifyMatch,
          blockExplorer: memoryEntry.blockExplorer
            ? { name: memoryEntry.blockExplorer.name }
            : undefined,
        };
      }

      const fileEntry = CacheManager.getVerificationEntryFromFile(chainId, normalizedAddress);
      if (fileEntry) {
        CacheManager.setVerificationEntryInMemory(chainId, normalizedAddress, fileEntry);
        return {
          status: fileEntry.verified ? 'verified' : 'unverified',
          source: fileEntry.source,
          sourcifyMatch: fileEntry.sourcifyMatch,
          blockExplorer: fileEntry.blockExplorer
            ? { name: fileEntry.blockExplorer.name }
            : undefined,
        };
      }

      let sourcifyMatch: SourcifyMatch = 'error';
      try {
        sourcifyMatch = await getSourcifyMatch(normalizedAddress, chainId);
      } catch (error) {
        console.warn(
          `Sourcify check failed for ${normalizedAddress} on chain ${chainId}; falling back to block explorer:`,
          error,
        );
      }
      if (sourcifyMatch === 'exact_match' || sourcifyMatch === 'match') {
        const cacheMeta = { source: 'sourcify' as const, sourcifyMatch };
        CacheManager.setVerificationInMemory(chainId, normalizedAddress, true, cacheMeta);
        CacheManager.setVerificationInFile(chainId, normalizedAddress, true, cacheMeta);
        return {
          status: 'verified',
          source: 'sourcify',
          sourcifyMatch,
        };
      }

      const explorer = BlockExplorerFactory.getExplorer(chainId);

      try {
        const isVerified = await explorer.isContractVerified(normalizedAddress, chainId, {
          skipCache: true,
        });
        const source = isVerified ? ('block-explorer' as const) : ('none' as const);
        const cacheMeta = {
          source,
          sourcifyMatch,
          blockExplorer: { name: explorer.getName(), verified: isVerified },
        };
        CacheManager.setVerificationInMemory(chainId, normalizedAddress, isVerified, cacheMeta);
        CacheManager.setVerificationInFile(chainId, normalizedAddress, isVerified, cacheMeta);

        return {
          status: isVerified ? 'verified' : 'unverified',
          source,
          sourcifyMatch,
          blockExplorer: { name: explorer.getName() },
        };
      } catch (error) {
        // Do not cache failures as "unverified" — surface an explicit unknown state.
        return {
          status: 'unknown',
          source: 'unknown',
          sourcifyMatch,
          blockExplorer: { name: explorer.getName() },
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      console.warn(`Failed to check verification for ${address} on chain ${chainId}:`, error);
      return {
        status: 'unknown',
        source: 'unknown',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a contract is verified on any supported verification source.
   * Returns false for "unknown" failures (call getContractVerification() to distinguish).
   */
  static async isContractVerified(address: string, chainId: number): Promise<boolean> {
    const result = await BlockExplorerFactory.getContractVerification(address, chainId);
    return result.status === 'verified';
  }

  /**
   * Decode function call using ABI from block explorer
   */
  static async decodeFunctionWithAbi(
    address: string,
    calldata: string,
    chainId: number,
  ): Promise<{ name: string; args: unknown[] } | null> {
    try {
      const abi = await BlockExplorerFactory.fetchContractAbi(address, chainId);
      if (!abi) {
        return null;
      }

      // Import decodeFunctionData from viem in the function scope to avoid circular dependencies
      const { decodeFunctionData } = await import('viem');

      try {
        const decoded = decodeFunctionData({
          abi,
          data: calldata as `0x${string}`,
        });

        return {
          name: decoded.functionName,
          args: Array.isArray(decoded.args) ? decoded.args : [decoded.args],
        };
      } catch {
        return null;
      }
    } catch (error) {
      console.warn(`Failed to decode function for ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  /**
   * Clear all cached explorers (useful for testing)
   */
  static clear(): void {
    BlockExplorerFactory.explorers = {};
    CacheManager.clearMemory();
  }
}
