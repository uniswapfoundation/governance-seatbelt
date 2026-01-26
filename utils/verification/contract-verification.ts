import { BlockExplorerFactory } from '../clients/block-explorers/factory';
import { type SourcifyCheckResult, SourcifyClient } from '../clients/sourcify';

/**
 * Source of contract verification.
 * - 'sourcify': Verified on Sourcify
 * - 'block_explorer': Verified on block explorer (Etherscan/Blockscout)
 * - 'none': Not verified on any source
 */
export type VerificationSource = 'sourcify' | 'block_explorer' | 'none';

/**
 * Result of contract verification check.
 */
export interface ContractVerificationResult {
  /** Whether the contract is verified on any source */
  verified: boolean;
  /** Which source the contract was verified on */
  source: VerificationSource;
  /** Detailed status (e.g., 'exact_match', 'match', 'verified') */
  status?: string;
  /** Human-readable reason when not verified */
  reason?: string;
  /** True if verified on Sourcify but NOT on block explorer (Slither can't fetch from Sourcify) */
  sourcifyOnly?: boolean;
}

/**
 * Check contract verification status on both Sourcify and block explorer.
 *
 * IMPORTANT: Slither can only fetch sources from block explorers (Etherscan/Blockscout),
 * not from Sourcify. We check both sources and flag "Sourcify-only" contracts so callers
 * can handle them appropriately (e.g., skip Slither with a clear message).
 *
 * @param address - Contract address to check
 * @param chainId - Chain ID where the contract is deployed
 * @returns Verification result with source information and sourcifyOnly flag
 */
export async function checkContractVerification(
  address: string,
  chainId: number,
): Promise<ContractVerificationResult> {
  // Check both sources in parallel for efficiency
  const [sourcifyResult, blockExplorerResult] = await Promise.all([
    checkSourcify(address, chainId),
    checkBlockExplorer(address, chainId),
  ]);

  // Block explorer verified - Slither can use this
  if (blockExplorerResult) {
    return {
      verified: true,
      // Prefer Sourcify as the reported source if both are verified
      source: sourcifyResult.verified ? 'sourcify' : 'block_explorer',
      status: sourcifyResult.verified ? sourcifyResult.status : 'verified',
      sourcifyOnly: false,
    };
  }

  // Sourcify-only - verified but Slither can't fetch sources
  if (sourcifyResult.verified) {
    return {
      verified: true,
      source: 'sourcify',
      status: sourcifyResult.status,
      sourcifyOnly: true,
    };
  }

  // Not verified on any source
  return {
    verified: false,
    source: 'none',
    reason: 'Contract not verified on Sourcify or block explorer',
    sourcifyOnly: false,
  };
}

/**
 * Check Sourcify for contract verification.
 */
async function checkSourcify(address: string, chainId: number): Promise<SourcifyCheckResult> {
  try {
    return await SourcifyClient.isContractVerified(address, chainId);
  } catch (error) {
    console.warn(`Error checking Sourcify for ${address}:`, error);
    return { verified: false, status: 'error' };
  }
}

/**
 * Check block explorer for contract verification.
 */
async function checkBlockExplorer(address: string, chainId: number): Promise<boolean> {
  try {
    return await BlockExplorerFactory.isContractVerified(address, chainId);
  } catch (error) {
    console.warn(`Error checking block explorer for ${address}:`, error);
    return false;
  }
}

/**
 * Format the sources that were checked for verification.
 * Used for detailed skip messages.
 *
 * @param result - The verification result
 * @param blockExplorerName - Name of the block explorer (e.g., 'Etherscan', 'Arbiscan')
 * @returns Formatted string like "Sourcify, Etherscan"
 */
export function formatSourcesChecked(blockExplorerName = 'block explorer'): string {
  return `Sourcify, ${blockExplorerName}`;
}

/**
 * Format the verification source for display in reports.
 *
 * @param result - The verification result
 * @returns Formatted string like "sourcify [exact match]" or "block explorer"
 */
export function formatVerificationSource(result: ContractVerificationResult): string {
  if (!result.verified) {
    return 'not verified';
  }

  if (result.source === 'sourcify') {
    const matchType = result.status === 'exact_match' ? 'exact match' : 'match';
    return `sourcify [${matchType}]`;
  }

  return 'block explorer';
}
