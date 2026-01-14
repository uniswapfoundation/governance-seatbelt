import { getAddress } from 'viem';
import { SchemaValidationError, parseWithSchema, z } from '../validation/zod';

/**
 * Sourcify verification status values.
 * - 'perfect': Full match - all source files and metadata match
 * - 'partial': Partial match - source code matches but metadata may differ
 * - 'false': Not verified on Sourcify
 * - 'error': API error occurred during check
 */
export type SourcifyVerificationStatus = 'perfect' | 'partial' | 'false' | 'error';

export interface SourcifyCheckResult {
  verified: boolean;
  status: SourcifyVerificationStatus;
}

export type SourcifyMatch = 'exact_match' | 'match' | 'no_match' | 'error';

export type SourcifyVerification =
  | { status: 'verified'; match: 'exact_match' | 'partial_match' }
  | { status: 'unverified' };
// In-memory cache for Sourcify verification results
const sourcifyCache: Record<string, SourcifyCheckResult> = {};

const sourcifyResponseSchema = z.array(
  z
    .object({
      chainIds: z.array(
        z
          .object({
            chainId: z.union([z.string(), z.number()]),
            status: z.string(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
);

function getCacheKey(address: string, chainId: number): string {
  return `${chainId}:${getAddress(address)}`;
}

/**
 * Sourcify API client for checking contract verification status.
 *
 * Uses the Sourcify check-all-by-addresses endpoint which is efficient
 * for simple verification status checks without retrieving full source code.
 *
 * @see https://docs.sourcify.dev/docs/api/server/check-all-by-addresses/
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Consistent with BlockExplorerFactory pattern
export class SourcifyClient {
  private static readonly BASE_URL = 'https://sourcify.dev/server';
  private static readonly TIMEOUT_MS = 10000;

  static async isContractVerified(address: string, chainId: number): Promise<SourcifyCheckResult> {
    const cacheKey = getCacheKey(address, chainId);
    if (sourcifyCache[cacheKey]) return sourcifyCache[cacheKey];

    try {
      const checksummedAddress = getAddress(address);
      const url = `${SourcifyClient.BASE_URL}/check-all-by-addresses?addresses=${checksummedAddress}&chainIds=${chainId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SourcifyClient.TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`Sourcify API returned status ${response.status} for ${address}`);
        const result: SourcifyCheckResult = { verified: false, status: 'error' };
        sourcifyCache[cacheKey] = result;
        return result;
      }

      const rawData = await response.json();
      const data = parseWithSchema(
        sourcifyResponseSchema,
        rawData,
        'Sourcify check-all-by-addresses response',
      );
      const result = SourcifyClient.parseResponse(data, chainId);
      sourcifyCache[cacheKey] = result;
      return result;
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`Sourcify API timeout for ${address} on chain ${chainId}`);
      } else {
        console.warn(`Sourcify API error for ${address} on chain ${chainId}:`, error);
      }

      const result: SourcifyCheckResult = { verified: false, status: 'error' };
      sourcifyCache[cacheKey] = result;
      return result;
    }
  }

  private static parseResponse(data: unknown, chainId: number): SourcifyCheckResult {
    if (!Array.isArray(data) || data.length === 0) {
      return { verified: false, status: 'false' };
    }

    const addressResult = data[0];
    if (!addressResult || !Array.isArray(addressResult.chainIds)) {
      return { verified: false, status: 'false' };
    }

    const chainResult = addressResult.chainIds.find(
      (c: { chainId: string; status: string }) => String(c.chainId) === String(chainId),
    );

    if (!chainResult) {
      return { verified: false, status: 'false' };
    }

    const status = chainResult.status as SourcifyVerificationStatus;

    if (status === 'perfect' || status === 'partial') {
      return { verified: true, status };
    }

    return { verified: false, status: 'false' };
  }

  static clearCache(): void {
    for (const key of Object.keys(sourcifyCache)) {
      delete sourcifyCache[key];
    }
  }
}

export async function getSourcifyMatch(address: string, chainId: number): Promise<SourcifyMatch> {
  const result = await SourcifyClient.isContractVerified(address, chainId);

  if (result.status === 'perfect') return 'exact_match';
  if (result.status === 'partial') return 'match';
  if (result.status === 'error') return 'error';
  return 'no_match';
}

export async function getSourcifyVerification(
  address: string,
  chainId: number,
): Promise<SourcifyVerification> {
  const result = await SourcifyClient.isContractVerified(address, chainId);

  if (result.status === 'perfect') return { status: 'verified', match: 'exact_match' };
  if (result.status === 'partial') return { status: 'verified', match: 'partial_match' };
  return { status: 'unverified' };
}

export async function isContractVerifiedOnSourcify(
  address: string,
  chainId: number,
): Promise<boolean> {
  const result = await SourcifyClient.isContractVerified(address, chainId);
  return result.verified;
}
