import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Abi, getAddress } from 'viem';

// Cache directory path - use a non-gitignored location
const CACHE_DIR = join(process.cwd(), 'cache');
const ABI_CACHE_DIR = join(CACHE_DIR, 'abis');
const VERIFICATION_CACHE_DIR = join(CACHE_DIR, 'verification');

// Ensure cache directory exists
if (!existsSync(ABI_CACHE_DIR)) {
  mkdirSync(ABI_CACHE_DIR, { recursive: true });
}
if (!existsSync(VERIFICATION_CACHE_DIR)) {
  mkdirSync(VERIFICATION_CACHE_DIR, { recursive: true });
}

// In-memory cache for ABIs to avoid redundant API calls within the same session
const abiCache: Record<string, Abi> = {};

// In-memory cache for verification status to avoid redundant API calls within the same session
const verificationCache: Record<string, boolean> = {};

// Simple delay function to help with rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define a type for the Etherscan API response
interface EtherscanApiResponse {
  status: string;
  message: string;
  result: string | null;
}

/**
 * Gets the cache file path for an ABI
 */
function getAbiCacheFilePath(address: string, chainId: number): string {
  const normalizedAddress = getAddress(address);
  return join(ABI_CACHE_DIR, `${chainId}-${normalizedAddress}.json`);
}

/**
 * Gets the cache file path for verification status
 */
function getVerificationCacheFilePath(address: string, chainId: number): string {
  const normalizedAddress = getAddress(address);
  return join(VERIFICATION_CACHE_DIR, `${chainId}-${normalizedAddress}.json`);
}

/**
 * Fetches the ABI for a contract from Etherscan
 * @param address The contract address
 * @param chainId The chain ID (defaults to 1 for Ethereum mainnet)
 * @returns The parsed ABI or null if not found
 */
export async function fetchContractAbi(address: string, chainId = 1): Promise<Abi | null> {
  const normalizedAddress = getAddress(address);
  try {
    // Check in-memory cache first
    const cacheKey = `${chainId}:${normalizedAddress}`;
    if (abiCache[cacheKey]) {
      console.log(`[Cache] Using in-memory ABI for ${normalizedAddress}`);
      return abiCache[cacheKey];
    }

    // Check file cache
    const cachePath = getAbiCacheFilePath(address, chainId);
    if (existsSync(cachePath)) {
      console.log(`[Cache] Using file-cached ABI for ${normalizedAddress}`);
      const cachedAbi = JSON.parse(readFileSync(cachePath, 'utf8'));
      abiCache[cacheKey] = cachedAbi;
      return cachedAbi;
    }

    // Determine the API URL based on the chain ID
    const apiUrl = getEtherscanApiUrl(chainId);
    if (!apiUrl) {
      console.warn(`[ABI] Unsupported chain ID: ${chainId}`);
      return null;
    }

    // Get the API key from environment variables
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      console.warn('[ABI] ETHERSCAN_API_KEY not found in environment variables');
      return null;
    }

    // Retry mechanism for API requests
    const maxRetries = 3;
    let retryCount = 0;
    let data: EtherscanApiResponse | undefined;

    console.log(`[Cache] Fetching new ABI for ${normalizedAddress} from Etherscan`);

    while (retryCount < maxRetries) {
      // Add a delay before making the API call to avoid rate limiting
      await delay(1000); // 1000ms delay to be more conservative with rate limiting

      try {
        // Fetch the ABI from Etherscan
        const url = `${apiUrl}/api?module=contract&action=getabi&address=${normalizedAddress}&apikey=${apiKey}`;
        const response = await fetch(url);
        data = (await response.json()) as EtherscanApiResponse;

        if (data.status === '1' && data.result) {
          break; // Success, exit the retry loop
        }

        console.warn(
          `[ABI] Failed to fetch ABI for ${normalizedAddress} (attempt ${retryCount + 1}/${maxRetries}): ${data.message || 'Unknown error'}`,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          await delay(1000 * 2 ** retryCount);
        }
      } catch (error) {
        console.error(
          `[ABI] Error fetching ABI for ${normalizedAddress} (attempt ${retryCount + 1}/${maxRetries}):`,
          error,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          await delay(1000 * 2 ** retryCount);
        }
      }
    }

    if (!data || data.status !== '1' || !data.result) {
      console.warn(
        `[ABI] Failed to fetch ABI for ${normalizedAddress} after ${maxRetries} attempts`,
      );
      return null;
    }

    // Parse the ABI
    try {
      // Parse the ABI string into a JSON object
      let abiJson: unknown;
      try {
        // First try parsing as direct JSON
        abiJson = JSON.parse(data.result);
      } catch {
        // If that fails, try parsing as a string-encoded JSON
        try {
          abiJson = JSON.parse(data.result.replace(/^"|"$/g, ''));
        } catch (e2) {
          console.error(`[ABI] Error parsing ABI for ${normalizedAddress}:`, e2);
          return null;
        }
      }

      // Validate that it's an array
      if (!Array.isArray(abiJson)) {
        console.warn(`[ABI] Invalid ABI format for ${normalizedAddress}: not an array`);
        return null;
      }

      // Cache the result both in memory and on disk
      abiCache[cacheKey] = abiJson as Abi;
      writeFileSync(cachePath, JSON.stringify(abiJson, null, 2));
      console.log(`[Cache] Cached new ABI for ${normalizedAddress}`);

      return abiJson as Abi;
    } catch (error) {
      console.error(`[ABI] Error parsing ABI for ${normalizedAddress}:`, error);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching ABI for ${address}:`, error);
    return null;
  }
}

/**
 * Gets the Etherscan API URL for a given chain ID
 * @param chainId The chain ID
 * @returns The Etherscan API URL or null if unsupported
 */
function getEtherscanApiUrl(chainId: number): string | null {
  switch (chainId) {
    case 1: // Ethereum Mainnet
      return 'https://api.etherscan.io';
    default:
      return 'https://api.etherscan.io';
  }
}

/**
 * Decodes function data using the fetched ABI
 * @param address The contract address
 * @param data The function data to decode
 * @param chainId The chain ID (defaults to 1 for Ethereum mainnet)
 * @returns The decoded function data or null if not found
 */
export async function decodeFunctionWithAbi(
  address: string,
  data: `0x${string}`,
  chainId = 1,
): Promise<{ name: string; args: unknown[] } | null> {
  const selector = data.slice(0, 10);
  try {
    const abi = await fetchContractAbi(address, chainId);
    if (!abi) return null;

    // Import decodeFunctionData from viem in the function scope to avoid circular dependencies
    const { decodeFunctionData } = await import('viem');

    try {
      const decoded = decodeFunctionData({
        abi,
        data,
      });

      return {
        name: decoded.functionName,
        args: Array.isArray(decoded.args) ? decoded.args : [decoded.args],
      };
    } catch {
      try {
        // Try OpenChain API as fallback
        const response = await fetch(
          `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}&filter=true`,
        );
        const result = await response.json();

        if (result.ok && result.result.function[selector]?.[0]?.name) {
          const functionName = result.result.function[selector][0].name;
          return {
            name: functionName,
            args: [],
          };
        }
      } catch (openChainError) {
        console.warn('[ABI] Failed to decode using OpenChain API:', openChainError);
      }

      return null;
    }
  } catch (error) {
    console.error(`[ABI] Error decoding function data for ${address}:`, error);
    return null;
  }
}

/**
 * Checks if a contract is verified on Etherscan
 * @param address The contract address
 * @param chainId The chain ID (defaults to 1 for Ethereum mainnet)
 * @returns true if verified, false if not verified or error
 */
export async function isContractVerified(address: string, chainId = 1): Promise<boolean> {
  const normalizedAddress = getAddress(address);
  try {
    // Check in-memory cache first
    const cacheKey = `${chainId}:${normalizedAddress}`;
    if (verificationCache[cacheKey] !== undefined) {
      console.log(`[Cache] Using in-memory verification status for ${normalizedAddress}`);
      return verificationCache[cacheKey];
    }

    // Check file cache
    const cachePath = getVerificationCacheFilePath(address, chainId);
    if (existsSync(cachePath)) {
      console.log(`[Cache] Using file-cached verification status for ${normalizedAddress}`);
      const cachedVerification = JSON.parse(readFileSync(cachePath, 'utf8'));
      verificationCache[cacheKey] = cachedVerification.verified;
      return cachedVerification.verified;
    }

    // Determine the API URL based on the chain ID
    const apiUrl = getEtherscanApiUrl(chainId);
    if (!apiUrl) {
      console.warn(`[Verification] Unsupported chain ID: ${chainId}`);
      const result = false;
      verificationCache[cacheKey] = result;
      writeFileSync(cachePath, JSON.stringify({ verified: result, timestamp: Date.now() }));
      return result;
    }

    // Get the API key from environment variables
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      console.warn('[Verification] ETHERSCAN_API_KEY not found in environment variables');
      const result = false;
      verificationCache[cacheKey] = result;
      writeFileSync(cachePath, JSON.stringify({ verified: result, timestamp: Date.now() }));
      return result;
    }

    // Add a delay to avoid rate limiting
    await delay(200);

    console.log(`[Cache] Fetching verification status for ${normalizedAddress} from Etherscan`);

    // Check verification status using getsourcecode endpoint
    const url = `${apiUrl}/api?module=contract&action=getsourcecode&address=${normalizedAddress}&apikey=${apiKey}`;
    const response = await fetch(url);
    const data = (await response.json()) as EtherscanApiResponse;

    if (data.status === '1' && Array.isArray(data.result) && data.result.length > 0) {
      // Contract is verified if SourceCode is not empty
      const sourceCode = data.result[0].SourceCode;
      const isVerified = sourceCode && sourceCode.trim() !== '';

      // Cache the result both in memory and on disk
      verificationCache[cacheKey] = isVerified;
      writeFileSync(cachePath, JSON.stringify({ verified: isVerified, timestamp: Date.now() }));
      console.log(`[Cache] Cached verification status for ${normalizedAddress}: ${isVerified}`);

      return isVerified;
    }

    // Cache negative result both in memory and on disk
    const result = false;
    verificationCache[cacheKey] = result;
    writeFileSync(cachePath, JSON.stringify({ verified: result, timestamp: Date.now() }));
    return result;
  } catch (error) {
    console.error(`[Verification] Error checking verification for ${normalizedAddress}:`, error);
    // Cache negative result for errors too, both in memory and on disk
    const cacheKey = `${chainId}:${normalizedAddress}`;
    const result = false;
    verificationCache[cacheKey] = result;
    const cachePath = getVerificationCacheFilePath(address, chainId);
    writeFileSync(cachePath, JSON.stringify({ verified: result, timestamp: Date.now() }));
    return result;
  }
}
