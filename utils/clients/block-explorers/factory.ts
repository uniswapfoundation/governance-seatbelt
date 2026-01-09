import type { Abi } from 'viem';
import { BlockExplorerSource, getChainConfig } from '../client';
import { BlockscoutExplorer } from './blockscout';
import { EtherscanExplorer } from './etherscan';
import type { BlockExplorer } from './index';

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
   * Check if a contract is verified on the appropriate block explorer
   */
  static async isContractVerified(address: string, chainId: number): Promise<boolean> {
    try {
      const explorer = BlockExplorerFactory.getExplorer(chainId);
      return await explorer.isContractVerified(address, chainId);
    } catch (error) {
      console.warn(`Failed to check verification for ${address} on chain ${chainId}:`, error);
      return false;
    }
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
  }
}
