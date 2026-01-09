import { type Abi, getAddress } from 'viem';
import { CacheManager } from './cache';
import { BaseBlockExplorer } from './index';

interface BlockscoutContractResponse {
  status: string;
  is_verified: boolean;
  is_partially_verified?: boolean;
  abi: Abi | null;
  name: string;
  source_code: string | null;
}

export class BlockscoutExplorer extends BaseBlockExplorer {
  private baseUrl: string;
  private apiUrl: string;

  constructor(baseUrl: string, apiUrl: string) {
    super();
    this.baseUrl = baseUrl;
    this.apiUrl = apiUrl;
  }

  getName(): string {
    return 'Blockscout';
  }

  /**
   * Shared fetch method with retry logic
   */
  private async fetchWithRetry<T>(
    url: string,
    operation: string,
    chainId: number,
    address: string,
  ): Promise<T | null> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      // Add a delay before making the API call to avoid rate limiting
      await this.delay(1000); // 1000ms delay to be more conservative with rate limiting

      try {
        const response = await fetch(url);

        if (response.ok) {
          const data = (await response.json()) as T;
          // Blockscout API responses don't have a status wrapper, so just return the data
          return data;
        }

        this.warn(
          `Failed to ${operation} for ${address} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}): ${response.status}`,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          await this.delay(1000 * 2 ** retryCount);
        }
      } catch (error) {
        this.error(
          `Error ${operation} for ${address} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}):`,
          error,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          await this.delay(1000 * 2 ** retryCount);
        }
      }
    }

    this.warn(
      `Failed to ${operation} for ${address} on chain ${chainId} after ${maxRetries} attempts`,
    );
    return null;
  }

  async fetchContractAbi(address: string, chainId: number): Promise<Abi | null> {
    const normalizedAddress = getAddress(address);

    try {
      // Check cache first
      const cachedAbi = await this.checkAbiCache(chainId, address, normalizedAddress);
      if (cachedAbi) {
        return cachedAbi;
      }

      this.log(`Fetching new ABI for ${normalizedAddress} from ${this.baseUrl} (Chain ${chainId})`);

      // Use shared fetch method
      const url = `${this.apiUrl}/smart-contracts/${normalizedAddress}`;
      const data = await this.fetchWithRetry<BlockscoutContractResponse>(
        url,
        'fetch ABI',
        chainId,
        normalizedAddress,
      );

      if (!data || !data.abi) {
        this.warn(`No ABI found for ${normalizedAddress} on chain ${chainId}`);
        return null;
      }

      // Cache the result both in memory and on disk
      CacheManager.setAbiInMemory(chainId, address, data.abi);
      CacheManager.setAbiInFile(chainId, address, data.abi);
      this.log(`Cached new ABI for ${normalizedAddress} on chain ${chainId}`);

      return data.abi;
    } catch (error) {
      this.error(`Error fetching ABI for ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  async isContractVerified(address: string, chainId: number): Promise<boolean> {
    const normalizedAddress = getAddress(address);

    // Check in-memory cache first
    const memoryCached = CacheManager.getVerificationFromMemory(chainId, address);
    if (memoryCached !== undefined) {
      return memoryCached;
    }

    // Check file cache
    const fileCached = CacheManager.getVerificationFromFile(chainId, address);
    if (fileCached !== null) {
      CacheManager.setVerificationInMemory(chainId, address, fileCached);
      return fileCached;
    }

    this.log(`Fetching verification status for ${normalizedAddress} from chain ${chainId}`);

    // Use shared fetch method with properly normalized address
    const url = `${this.apiUrl}/smart-contracts/${normalizedAddress}`;
    const data = await this.fetchWithRetry<BlockscoutContractResponse>(
      url,
      'fetch verification status',
      chainId,
      normalizedAddress,
    );

    if (!data) {
      const result = false;
      CacheManager.setVerificationInMemory(chainId, address, result);
      CacheManager.setVerificationInFile(chainId, address, result);
      return result;
    }

    // Consider both fully verified and partially verified contracts as verified
    const isVerified = data.is_verified || data.is_partially_verified === true;
    this.log(
      `Verification result for ${normalizedAddress}: ${isVerified} (fully: ${data.is_verified}, partially: ${data.is_partially_verified})`,
    );

    // Cache the result
    CacheManager.setVerificationInMemory(chainId, address, isVerified);
    CacheManager.setVerificationInFile(chainId, address, isVerified);

    return isVerified;
  }
}
