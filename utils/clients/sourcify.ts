import type { Abi } from 'viem';
import { VerifierLookupClient, type VerifierLookupResponse } from './verifier-lookup';

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
  private static readonly client = new VerifierLookupClient({
    baseUrl: 'https://sourcify.dev/server',
    name: 'Sourcify',
  });

  static async isContractVerified(address: string, chainId: number): Promise<SourcifyCheckResult> {
    const lookup = await SourcifyClient.client.lookup(address, chainId);
    if (lookup.status === 'error') return { verified: false, status: 'error' };
    if (lookup.status === 'not_found' || !lookup.data)
      return { verified: false, status: 'no_match' };
    return SourcifyClient.parseLookupResponse(lookup.data);
  }

  private static parseLookupResponse(data: VerifierLookupResponse): SourcifyCheckResult {
    if (data.match === 'exact_match' || data.match === 'match') {
      return { verified: true, status: data.match };
    }
    return { verified: false, status: 'no_match' };
  }

  static async fetchContractAbi(address: string, chainId: number): Promise<Abi | null> {
    const lookup = await SourcifyClient.client.lookup(address, chainId, { fields: ['abi'] });
    if (lookup.status !== 'ok' || !lookup.data) return null;
    return SourcifyClient.parseLookupResponse(lookup.data).verified
      ? (lookup.data.abi ?? null)
      : null;
  }

  static clearCache(): void {
    SourcifyClient.client.clearCache();
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
