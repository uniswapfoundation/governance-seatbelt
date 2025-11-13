import type { Abi } from 'viem';
import { CacheManager } from './cache';

/**
 * Base interface for block explorer implementations
 */
export interface BlockExplorer {
  /**
   * Fetch the ABI for a contract
   * @param address The contract address
   * @param chainId The chain ID
   * @returns The parsed ABI or null if not found
   */
  fetchContractAbi(address: string, chainId: number): Promise<Abi | null>;

  /**
   * Check if a contract is verified
   * @param address The contract address
   * @param chainId The chain ID
   * @returns True if verified, false otherwise
   */
  isContractVerified(address: string, chainId: number): Promise<boolean>;

  /**
   * Get the name of the block explorer
   */
  getName(): string;
}

/**
 * Base class for block explorer implementations
 */
export abstract class BaseBlockExplorer implements BlockExplorer {
  abstract fetchContractAbi(address: string, chainId: number): Promise<Abi | null>;
  abstract isContractVerified(address: string, chainId: number): Promise<boolean>;
  abstract getName(): string;

  /**
   * Normalize an address for consistent handling
   */
  protected normalizeAddress(address: string): string {
    return address.toLowerCase();
  }

  /**
   * Log a message with the explorer name prefix
   */
  protected log(message: string): void {
    console.log(`[${this.getName()}] ${message}`);
  }

  /**
   * Log a warning with the explorer name prefix
   */
  protected warn(message: string): void {
    console.warn(`[${this.getName()}] ${message}`);
  }

  /**
   * Log an error with the explorer name prefix
   */
  protected error(message: string, error?: unknown): void {
    console.error(`[${this.getName()}] ${message}`, error);
  }

  /**
   * Delay function for rate limiting
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check cache for ABI and return if found
   */
  protected async checkAbiCache(
    chainId: number,
    address: string,
    normalizedAddress: string,
  ): Promise<Abi | null> {
    // Check in-memory cache first
    const cachedAbi = CacheManager.getAbiFromMemory(chainId, address);
    if (cachedAbi) {
      this.log(`Using in-memory ABI for ${normalizedAddress}`);
      return cachedAbi;
    }

    // Check file cache
    const fileCachedAbi = CacheManager.getAbiFromFile(chainId, address);
    if (fileCachedAbi) {
      this.log(`Using file-cached ABI for ${normalizedAddress}`);
      CacheManager.setAbiInMemory(chainId, address, fileCachedAbi);
      return fileCachedAbi;
    }

    return null;
  }
}
