import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { CallTrace, ProposalCheck, TenderlySimulation } from '../types';
import type { ChainConfig } from '../utils/clients/client';
import { isContractVerified } from '../utils/clients/etherscan';

/**
 * Check all targets with code are verified on block explorer
 */
export const checkTargetsVerifiedEtherscan: ProposalCheck = {
  name: 'Check all targets are verified on Etherscan',
  async checkProposal(proposal, _sim, deps, l2Simulations) {
    const isL2Chain = deps.chainConfig?.chainId !== 1;
    const hasL2Data = l2Simulations && l2Simulations.length > 0;

    let targets: `0x${string}`[];

    if (isL2Chain && hasL2Data) {
      // For L2 chains, extract targets from cross-chain simulation data
      targets = extractL2Targets(l2Simulations);
      if (targets.length === 0) {
        return {
          info: ['No L2 targets found in cross-chain simulation'],
          warnings: [],
          errors: [],
        };
      }
    } else {
      // For mainnet, use proposal targets
      targets = proposal.targets
        .filter((addr, i, targets) => targets.indexOf(addr) === i)
        .map(getAddress);
    }

    const info = await checkVerificationStatuses(targets, deps.publicClient, deps.chainConfig);
    return { info, warnings: [], errors: [] };
  },
};

/**
 * Check all touched contracts with code are verified on Etherscan
 */
export const checkTouchedContractsVerifiedEtherscan: ProposalCheck = {
  name: 'Check all touched contracts are verified on Etherscan',
  async checkProposal(_, sim, deps) {
    const info = await checkVerificationStatuses(
      sim.transaction.addresses.map(getAddress),
      deps.publicClient,
      deps.chainConfig,
    );
    return { info, warnings: [], errors: [] };
  },
};

/**
 * For a given simulation response, check verification status of a set of addresses
 */
async function checkVerificationStatuses(
  addresses: `0x${string}`[],
  publicClient: PublicClient,
  chainConfig: ChainConfig,
): Promise<string[]> {
  const info: string[] = [];
  for (const addr of addresses) {
    const status = await checkVerificationStatus(addr, publicClient, chainConfig.chainId);
    const address = toAddressLink(addr, chainConfig.blockExplorer.baseUrl);
    if (status === 'eoa') info.push(`${address}: EOA (verification not applicable)`);
    else if (status === 'empty')
      info.push(`${address}: EOA (may have code later, verification not applicable)`);
    else if (status === 'verified') info.push(`${address}: Contract (verified)`);
    else info.push(`${address}: Contract (not verified)`);
  }
  return info;
}

/**
 * For a given address, check if it's an EOA, a verified contract, or an unverified contract
 */
async function checkVerificationStatus(
  addr: `0x${string}`,
  publicClient: PublicClient,
  chainId: number,
): Promise<'verified' | 'eoa' | 'unverified' | 'empty'> {
  // First check if there's code at the address
  const [code, nonce] = await Promise.all([
    publicClient.getCode({ address: addr }),
    publicClient.getTransactionCount({ address: addr }),
  ]);

  // If there is no code and nonce is > 0 then it's an EOA.
  // If nonce is 0 it is an empty account that might have code later.
  if (!code || code === '0x') return nonce > 0 ? 'eoa' : 'empty';

  // For contracts, check verification status via appropriate block explorer API
  const isVerified = await isContractVerified(addr, chainId);
  return isVerified ? 'verified' : 'unverified';
}

/**
 * Extract unique target addresses from L2 simulations
 */
function extractL2Targets(
  l2Simulations: Array<{ chainId: number; sim: TenderlySimulation }>,
): `0x${string}`[] {
  const targets = new Set<string>();

  for (const l2Sim of l2Simulations) {
    if (l2Sim.sim?.transaction?.transaction_info?.call_trace?.calls) {
      // Extract target addresses from L2 calls
      extractTargetsFromCalls(l2Sim.sim.transaction.transaction_info.call_trace.calls, targets);
    }

    // Also include the main transaction target if it exists
    if (l2Sim.sim?.transaction?.to) {
      targets.add(l2Sim.sim.transaction.to.toLowerCase());
    }
  }

  return Array.from(targets).map((addr) => getAddress(addr));
}

/**
 * Recursively extract target addresses from call traces
 */
function extractTargetsFromCalls(calls: CallTrace[], targets: Set<string>): void {
  for (const call of calls || []) {
    if (call.to && call.input && call.input !== '0x') {
      targets.add(call.to.toLowerCase());
    }

    // Recursively process subcalls
    if (call.calls) {
      extractTargetsFromCalls(call.calls, targets);
    }
  }
}
