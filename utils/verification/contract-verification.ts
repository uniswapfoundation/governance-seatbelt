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
  /** Detailed status (e.g., 'perfect', 'partial', 'verified') */
  status?: string;
  /** Human-readable reason when not verified */
  reason?: string;
}

/**
 * Check contract verification status using Sourcify first, then block explorer fallback.
 *
 * Order of checks:
 * 1. Sourcify - Check for verification on Sourcify (returns 'perfect' or 'partial' if verified)
 * 2. Block Explorer - If not on Sourcify or Sourcify errors, check configured block explorer
 *
 * @param address - Contract address to check
 * @param chainId - Chain ID where the contract is deployed
 * @returns Verification result with source information
 */
export async function checkContractVerification(
  address: string,
  chainId: number,
): Promise<ContractVerificationResult> {
  // Step 1: Check Sourcify first
  const sourcifyResult = await checkSourcify(address, chainId);
  if (sourcifyResult.verified) {
    return {
      verified: true,
      source: 'sourcify',
      status: sourcifyResult.status,
    };
  }

  // Step 2: Sourcify returned not verified or error - try block explorer
  const blockExplorerResult = await checkBlockExplorer(address, chainId);
  if (blockExplorerResult) {
    return {
      verified: true,
      source: 'block_explorer',
      status: 'verified',
    };
  }

  // Step 3: Not verified on any source
  return {
    verified: false,
    source: 'none',
    reason: 'Contract not verified on Sourcify or block explorer',
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
 * @returns Formatted string like "sourcify [perfect match]" or "block explorer"
 */
export function formatVerificationSource(result: ContractVerificationResult): string {
  if (!result.verified) {
    return 'not verified';
  }

  if (result.source === 'sourcify') {
    const matchType = result.status === 'perfect' ? 'perfect match' : 'partial match';
    return `sourcify [${matchType}]`;
  }

  return 'block explorer';
}
