import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { CallTrace, ProposalCheck, TenderlySimulation } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import type { ChainConfig } from '../utils/clients/client';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

/**
 * Check all targets with code are verified on Sourcify or block explorer
 */
export const checkTargetsVerifiedOnBlockExplorer: ProposalCheck = {
  name: 'Check all targets are verified on Sourcify or block explorer',
  async checkProposal(proposal, sim, deps) {
    const isL2Chain = deps.chainConfig?.chainId !== 1;

    const targets: `0x${string}`[] = isL2Chain
      ? extractTargetsFromSimulation(sim)
      : proposal.targets.filter((addr, i, targets) => targets.indexOf(addr) === i).map(getAddress);

    if (isL2Chain && targets.length === 0) {
      return {
        info: [],
        warnings: [],
        errors: [],
        skipped: { reason: 'No L2 targets found in destination simulation' },
      };
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
 * Check all touched contracts with code are verified on Sourcify or block explorer
 */
export const checkTouchedContractsVerifiedOnBlockExplorer: ProposalCheck = {
  name: 'Check all touched contracts are verified on Sourcify or block explorer',
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

function extractTargetsFromSimulation(sim: TenderlySimulation): `0x${string}`[] {
  const targets = new Set<string>();

  if (sim.transaction.transaction_info.call_trace?.calls) {
    extractTargetsFromCalls(sim.transaction.transaction_info.call_trace.calls, targets);
  }

  if (sim.transaction?.to) {
    targets.add(sim.transaction.to.toLowerCase());
  }

  return Array.from(targets).map((addr) => getAddress(addr));
}
