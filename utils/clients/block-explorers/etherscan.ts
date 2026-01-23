import { type Abi, getAddress } from 'viem';
import { SchemaValidationError, parseWithSchema, z } from '../../validation/zod';
import { CacheManager } from './cache';
import { BaseBlockExplorer, type VerificationOptions } from './index';

interface EtherscanAbiResponse {
  status: string;
  result: string;
  message?: string;
}

interface EtherscanSourceCodeResponse {
  status: string;
  result: string | EtherscanSourceCodeResultItem[];
  message?: string;
}

interface EtherscanSourceCodeResultItem {
  SourceCode?: string;
  ContractName?: string;
}

const etherscanAbiResponseSchema: z.ZodType<EtherscanAbiResponse> = z
  .object({
    status: z.string(),
    result: z.string(),
    message: z.string().optional(),
  })
  .passthrough();

const etherscanSourceCodeResponseSchema: z.ZodType<EtherscanSourceCodeResponse> = z
  .object({
    status: z.string(),
    result: z.union([
      z.string(),
      z.array(
        z
          .object({
            SourceCode: z.string().optional(),
            ContractName: z.string().optional(),
          })
          .passthrough(),
      ),
    ]),
    message: z.string().optional(),
  })
  .passthrough();

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
      let data: EtherscanAbiResponse | undefined;

      while (retryCount < maxRetries) {
        // Add a delay before making the API call to avoid rate limiting
        await this.delay(1000); // 1000ms delay to be more conservative with rate limiting

        try {
          // Use Etherscan V2 API with chainid parameter for unified multichain support
          const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${normalizedAddress}&apikey=${this.apiKey}`;

          const response = await fetch(url);
          const rawData = await response.json();
          data = parseWithSchema(etherscanAbiResponseSchema, rawData, 'Etherscan getabi response');

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
          if (error instanceof SchemaValidationError) {
            throw error;
          }
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
      if (error instanceof SchemaValidationError) {
        throw error;
      }
      this.error(`Error fetching ABI for ${address} on chain ${chainId}:`, error);
      return null;
    }
  }

  async fetchContractName(address: string, chainId: number): Promise<string | null> {
    const normalizedAddress = getAddress(address);

    try {
      const entry = await this.fetchSourceCodeEntry(normalizedAddress, chainId);
      const name = entry?.ContractName?.trim();
      return name && name.length > 0 ? name : null;
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw error;
      }
      this.warn(
        `Failed to fetch contract name for ${normalizedAddress} on chain ${chainId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async fetchSourceCodeEntry(
    normalizedAddress: string,
    chainId: number,
  ): Promise<EtherscanSourceCodeResultItem> {
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: string | null = null;

    while (retryCount < maxRetries) {
      await this.delay(1000);

      try {
        const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${normalizedAddress}&apikey=${this.apiKey}`;

        const response = await fetch(url);
        const rawData = await response.json();
        const data = parseWithSchema(
          etherscanSourceCodeResponseSchema,
          rawData,
          'Etherscan getsourcecode response',
        );

        if (data.status === '1' && Array.isArray(data.result) && data.result.length > 0) {
          return data.result[0];
        }

        const message = data.message || 'Unknown error';
        const resultStr =
          typeof data.result === 'string' ? data.result : JSON.stringify(data.result);

        // Etherscan uses status "0" for API errors (including rate limiting). Treat as retryable.
        if (data.status !== '1') {
          lastError = `${message} (${resultStr})`;
          this.warn(
            `Etherscan getsourcecode error for ${normalizedAddress} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}): ${message} (${resultStr})`,
          );
          retryCount++;
          if (retryCount < maxRetries) {
            await this.delay(1000 * 2 ** retryCount);
            continue;
          }
          break;
        }

        // Unexpected successful wrapper but no result array.
        lastError = `No result array (${message})`;
        this.warn(
          `Etherscan getsourcecode returned no result array for ${normalizedAddress} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries})`,
        );
        retryCount++;
        if (retryCount < maxRetries) {
          await this.delay(1000 * 2 ** retryCount);
        }
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
        this.error(
          `Error fetching getsourcecode for ${normalizedAddress} on chain ${chainId} (attempt ${retryCount + 1}/${maxRetries}):`,
          error,
        );
        retryCount++;
        if (retryCount < maxRetries) {
          await this.delay(1000 * 2 ** retryCount);
        }
      }
    }

    throw new Error(
      `Etherscan getsourcecode failed for ${normalizedAddress} on chain ${chainId} after ${maxRetries} attempts: ${lastError ?? 'Unknown error'}`,
    );
  }

  private async fetchVerificationStatus(
    normalizedAddress: string,
    chainId: number,
  ): Promise<boolean> {
    const entry = await this.fetchSourceCodeEntry(normalizedAddress, chainId);
    return Boolean(entry.SourceCode) && entry.SourceCode!.trim() !== '';
  }

  async isContractVerified(
    address: string,
    chainId: number,
    options?: VerificationOptions,
  ): Promise<boolean> {
    const normalizedAddress = getAddress(address);
    const skipCache = options?.skipCache === true;

    if (!skipCache) {
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
    }

    this.log(`Fetching verification status for ${normalizedAddress} from chain ${chainId}`);

    try {
      const isVerified = await this.fetchVerificationStatus(normalizedAddress, chainId);

      this.log(`Verification result for ${normalizedAddress}: ${isVerified}`);

      if (!skipCache) {
        // Cache the result
        const cacheMeta = {
          source: 'block-explorer' as const,
          blockExplorer: { name: this.getName(), verified: isVerified },
        };
        CacheManager.setVerificationInMemory(chainId, address, isVerified, cacheMeta);
        CacheManager.setVerificationInFile(chainId, address, isVerified, cacheMeta);
      }

      return isVerified;
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw error;
      }
      this.error(`Error fetching verification status for ${address} on chain ${chainId}:`, error);
      if (skipCache) {
        throw error;
      }
      return false;
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
