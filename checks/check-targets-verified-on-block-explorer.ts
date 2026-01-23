import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { CallTrace, ProposalCheck, TenderlySimulation } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import type { ChainConfig } from '../utils/clients/client';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

/**
 * Check all targets with code are verified on block explorer
 */
export const checkTargetsVerifiedOnBlockExplorer: ProposalCheck = {
  name: 'Check all targets are verified on block explorer',
  async checkProposal(proposal, _sim, deps, l2Simulations) {
    const isL2Chain = deps.chainConfig?.chainId !== 1;
    const hasL2Data = l2Simulations && l2Simulations.length > 0;

    let targets: `0x${string}`[];

    if (isL2Chain && hasL2Data) {
      // For L2 chains, extract targets from cross-chain simulation data
      targets = extractL2Targets(l2Simulations);
      if (targets.length === 0) {
        return {
          info: [],
          warnings: [],
          errors: [],
          skipped: { reason: 'No L2 targets found in cross-chain simulation' },
        };
      }
    } else {
      // For mainnet, use proposal targets
      targets = proposal.targets
        .filter((addr, i, targets) => targets.indexOf(addr) === i)
        .map(getAddress);
    }

    const { info, warnings } = await checkVerificationStatuses(
      targets,
      deps.publicClient,
      deps.chainConfig,
    );
    return { info, warnings, errors: [] };
  },
};

/**
 * Check all touched contracts with code are verified on Etherscan
 */
export const checkTouchedContractsVerifiedOnBlockExplorer: ProposalCheck = {
  name: 'Check all touched contracts are verified on block explorer',
  async checkProposal(_, sim, deps) {
    // Only check touched contracts on the main chain (chain 1), not on L2 simulations
    if (deps.chainConfig.chainId !== 1) {
      return {
        info: [],
        warnings: [],
        errors: [],
        skipped: { reason: 'Touched contracts verification skipped for L2 simulations' },
      };
    }

    const { info, warnings } = await checkVerificationStatuses(
      sim.transaction.addresses.map(getAddress),
      deps.publicClient,
      deps.chainConfig,
    );
    return { info, warnings, errors: [] };
  },
};

/**
 * For a given simulation response, check verification status of a set of addresses
 */
async function checkVerificationStatuses(
  addresses: `0x${string}`[],
  publicClient: PublicClient,
  chainConfig: ChainConfig,
): Promise<{ info: string[]; warnings: string[] }> {
  const info: string[] = [];
  const warnings: string[] = [];

  for (const addr of addresses) {
    const status = await getAddressKind(addr, publicClient);
    const address = toAddressLink(addr, chainConfig.blockExplorer.baseUrl);

    const isPlaceholder = getAddress(addr) === getAddress(DEFAULT_SIMULATION_ADDRESS);
    const suffix = isPlaceholder ? ' (simulation placeholder)' : '';

    if (status === 'eoa') {
      info.push(`${address}${suffix}: EOA (verification not applicable)`);
      continue;
    }

    if (status === 'empty') {
      info.push(`${address}${suffix}: EOA (may have code later, verification not applicable)`);
      continue;
    }

    const verification = await BlockExplorerFactory.getContractVerification(
      addr,
      chainConfig.chainId,
    );

    if (verification.status === 'verified') {
      info.push(`${address}${suffix}: Contract (verified)`);
      continue;
    }

    if (verification.status === 'unverified') {
      info.push(`${address}${suffix}: Contract (unverified)`);
      continue;
    }

    info.push(`${address}${suffix}: Contract (verification check failed)`);
    warnings.push(
      `Could not determine verification status for ${addr} on chain ${chainConfig.chainId}${
        verification.blockExplorer?.name ? ` (${verification.blockExplorer.name})` : ''
      }: ${verification.reason || 'Unknown error'}`,
    );
  }

  return { info, warnings };
}

/**
 * For a given address, check if it's an EOA, an empty account, or a contract.
 */
async function getAddressKind(
  addr: `0x${string}`,
  publicClient: PublicClient,
): Promise<'contract' | 'eoa' | 'empty'> {
  // First check if there's code at the address
  const [code, nonce] = await Promise.all([
    publicClient.getCode({ address: addr }),
    publicClient.getTransactionCount({ address: addr }),
  ]);

  // If there is no code and nonce is > 0 then it's an EOA.
  // If nonce is 0 it is an empty account that might have code later.
  if (!code || code === '0x') {
    return nonce > 0 ? 'eoa' : 'empty';
  }

  return 'contract';
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
