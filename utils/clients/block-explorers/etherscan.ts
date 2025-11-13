import { type Abi, getAddress } from 'viem';
import { CacheManager } from './cache';
import { BaseBlockExplorer } from './index';

interface EtherscanApiResponse {
  status: string;
  result: string | Array<{ SourceCode?: string }>;
  message?: string;
}

export class EtherscanExplorer extends BaseBlockExplorer {
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  getName(): string {
    return 'Etherscan';
  }

  async fetchContractAbi(address: string, chainId: number): Promise<Abi | null> {
    const normalizedAddress = getAddress(address);

    try {
      // Check cache first
      const cachedAbi = await this.checkAbiCache(chainId, address, normalizedAddress);
      if (cachedAbi) {
        return cachedAbi;
      }

      this.log(
        `Fetching new ABI for ${normalizedAddress} from Etherscan V2 API (Chain ${chainId})`,
      );

      // Retry mechanism for API requests
      const maxRetries = 3;
      let retryCount = 0;
      let data: EtherscanApiResponse | undefined;

      while (retryCount < maxRetries) {
        // Add a delay before making the API call to avoid rate limiting
        await this.delay(1000); // 1000ms delay to be more conservative with rate limiting

        try {
          // Use Etherscan V2 API with chainid parameter for unified multichain support
          const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${normalizedAddress}&apikey=${this.apiKey}`;

          const response = await fetch(url);
          data = (await response.json()) as EtherscanApiResponse;

          if (data.status === '1' && data.result && typeof data.result === 'string') {
            break; // Success, exit the retry loop
          }

          this.warn(
            `Failed to fetch ABI for ${normalizedAddress} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}): ${data.message || 'Unknown error'}`,
          );
          retryCount++;

          if (retryCount < maxRetries) {
            await this.delay(1000 * 2 ** retryCount);
          }
        } catch (error) {
          this.error(
            `Error fetching ABI for ${normalizedAddress} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}):`,
            error,
          );
          retryCount++;

          if (retryCount < maxRetries) {
            await this.delay(1000 * 2 ** retryCount);
          }
        }
      }

      if (!data || data.status !== '1' || !data.result) {
        this.warn(
          `Failed to fetch ABI for ${normalizedAddress} on chain ${chainId} after ${maxRetries} attempts`,
        );
        return null;
      }

      // Parse the ABI
      try {
        // Parse the ABI string into a JSON object
        let abiJson: unknown;
        const resultString = typeof data.result === 'string' ? data.result : '';

        try {
          // First try parsing as direct JSON
          abiJson = JSON.parse(resultString);
        } catch {
          // If that fails, try parsing as a string-encoded JSON
          try {
            abiJson = JSON.parse(resultString.replace(/^"|"$/g, ''));
          } catch (e2) {
            this.error(`Error parsing ABI for ${normalizedAddress}:`, e2);
            return null;
          }
        }

        // Validate that it's an array
        if (!Array.isArray(abiJson)) {
          this.warn(`Invalid ABI format for ${normalizedAddress}: not an array`);
          return null;
        }

        // Cache the result both in memory and on disk
        CacheManager.setAbiInMemory(chainId, address, abiJson as Abi);
        CacheManager.setAbiInFile(chainId, address, abiJson as Abi);
        this.log(`Cached new ABI for ${normalizedAddress} on chain ${chainId}`);

        return abiJson as Abi;
      } catch (error) {
        this.error(`Error parsing ABI for ${normalizedAddress}:`, error);
        return null;
      }
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

    try {
      // Use Etherscan v2 API with chainid parameter for unified multichain support
      const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${normalizedAddress}&apikey=${this.apiKey}`;
      const response = await fetch(url);
      const data = (await response.json()) as EtherscanApiResponse;

      // For verification, Etherscan returns an array with contract info
      const isVerified: boolean =
        data.status === '1' &&
        Array.isArray(data.result) &&
        data.result.length > 0 &&
        Boolean(data.result[0].SourceCode) &&
        data.result[0].SourceCode!.trim() !== '';

      this.log(`Verification result for ${normalizedAddress}: ${isVerified}`);

      // Cache the result
      CacheManager.setVerificationInMemory(chainId, address, isVerified);
      CacheManager.setVerificationInFile(chainId, address, isVerified);

      return isVerified;
    } catch (error) {
      this.error(`Error fetching verification status for ${address} on chain ${chainId}:`, error);
      const result = false;
      CacheManager.setVerificationInMemory(chainId, address, result);
      CacheManager.setVerificationInFile(chainId, address, result);
      return result;
    }
  }
}

// Legacy functions for backward compatibility
export async function fetchContractAbi(address: string, chainId = 1): Promise<Abi | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    console.warn('[ABI] ETHERSCAN_API_KEY not found in environment variables');
    return null;
  }

  const explorer = new EtherscanExplorer(apiKey);
  return explorer.fetchContractAbi(address, chainId);
}

export async function isContractVerified(address: string, chainId = 1): Promise<boolean> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    console.warn('[Verification] ETHERSCAN_API_KEY not found in environment variables');
    return false;
  }

  const explorer = new EtherscanExplorer(apiKey);
  return explorer.isContractVerified(address, chainId);
}
