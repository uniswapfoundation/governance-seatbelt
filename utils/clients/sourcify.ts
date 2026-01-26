import { getAddress } from 'viem';
import { SchemaValidationError, parseWithSchema, z } from '../validation/zod';

/**
 * Sourcify verification status values.
 * - 'exact_match': Full match - all source files and metadata match
 * - 'match': Partial match - source code matches but metadata may differ
 * - 'no_match': Not verified on Sourcify
 * - 'error': API error occurred during check
 */
export type SourcifyVerificationStatus = 'exact_match' | 'match' | 'no_match' | 'error';

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

const sourcifyV2LookupResponseSchema = z
  .object({
    match: z.string().nullable(),
    creationMatch: z.string().nullable().optional(),
    runtimeMatch: z.string().nullable().optional(),
    verifiedAt: z.string().optional(),
    chainId: z.union([z.string(), z.number()]),
    address: z.string(),
  })
  .passthrough();

function getCacheKey(address: string, chainId: number): string {
  return `${chainId}:${getAddress(address)}`;
}

/**
 * Sourcify API client for checking contract verification status.
 *
 * Uses the Sourcify v2 contract lookup endpoint which is efficient for simple verification status
 * checks without retrieving full source code.
 *
 * @see https://docs.sourcify.dev/docs/api/
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Consistent with BlockExplorerFactory pattern
export class SourcifyClient {
  private static readonly BASE_URL = 'https://sourcify.dev/server/v2';
  private static readonly TIMEOUT_MS = 10000;

  static async isContractVerified(address: string, chainId: number): Promise<SourcifyCheckResult> {
    const cacheKey = getCacheKey(address, chainId);
    if (sourcifyCache[cacheKey]) return sourcifyCache[cacheKey];

    try {
      const checksummedAddress = getAddress(address);
      const url = `${SourcifyClient.BASE_URL}/contract/${chainId}/${checksummedAddress}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SourcifyClient.TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        const rawData = await response.json();
        const data = parseWithSchema(
          sourcifyV2LookupResponseSchema,
          rawData,
          'Sourcify v2 contract lookup response',
        );
        const result = SourcifyClient.parseV2LookupResponse(data);
        sourcifyCache[cacheKey] = result;
        return result;
      }

      if (!response.ok) {
        console.warn(`Sourcify API returned status ${response.status} for ${address}`);
        const result: SourcifyCheckResult = { verified: false, status: 'error' };
        sourcifyCache[cacheKey] = result;
        return result;
      }

      const rawData = await response.json();
      const data = parseWithSchema(
        sourcifyV2LookupResponseSchema,
        rawData,
        'Sourcify v2 contract lookup response',
      );
      const result = SourcifyClient.parseV2LookupResponse(data);
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

  private static parseV2LookupResponse(
    data: z.infer<typeof sourcifyV2LookupResponseSchema>,
  ): SourcifyCheckResult {
    if (data.match === 'exact_match' || data.match === 'match') {
      return { verified: true, status: data.match };
    }

    return { verified: false, status: 'no_match' };
  }

  static clearCache(): void {
    for (const key of Object.keys(sourcifyCache)) {
      delete sourcifyCache[key];
    }
  }
}

export async function getSourcifyMatch(address: string, chainId: number): Promise<SourcifyMatch> {
  const result = await SourcifyClient.isContractVerified(address, chainId);

  if (result.status === 'error') return 'error';
  return result.status;
}

export async function getSourcifyVerification(
  address: string,
  chainId: number,
): Promise<SourcifyVerification> {
  const result = await SourcifyClient.isContractVerified(address, chainId);

  if (result.status === 'exact_match') return { status: 'verified', match: 'exact_match' };
  if (result.status === 'match') return { status: 'verified', match: 'partial_match' };
  return { status: 'unverified' };
}

export async function isContractVerifiedOnSourcify(
  address: string,
  chainId: number,
): Promise<boolean> {
  const result = await SourcifyClient.isContractVerified(address, chainId);
  return result.verified;
}
