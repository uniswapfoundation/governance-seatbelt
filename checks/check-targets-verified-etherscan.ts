import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { ProposalCheck, TenderlySimulation } from '../types';

/**
 * Check all targets with code are verified on Etherscan
 */
export const checkTargetsVerifiedEtherscan: ProposalCheck = {
  name: 'Check all targets are verified on Etherscan',
  async checkProposal(proposal, sim, deps) {
    const uniqueTargets = proposal.targets.filter(
      (addr, i, targets) => targets.indexOf(addr) === i,
    );
    const info = await checkVerificationStatuses(
      sim,
      uniqueTargets.map(getAddress),
      deps.publicClient,
    );
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
      sim,
      sim.transaction.addresses.map(getAddress),
      deps.publicClient,
    );
    return { info, warnings: [], errors: [] };
  },
};

/**
 * For a given simulation response, check verification status of a set of addresses
 */
async function checkVerificationStatuses(
  sim: TenderlySimulation,
  addresses: `0x${string}`[],
  publicClient: PublicClient,
): Promise<string[]> {
  const info: string[] = [];
  for (const addr of addresses) {
    const status = await checkVerificationStatus(sim, addr, publicClient);
    const address = toAddressLink(addr);
    if (status === 'eoa') info.push(`${address}: EOA (verification not applicable)`);
    else if (status === 'verified') info.push(`${address}: Contract (verified)`);
    else info.push(`${address}: Contract (not verified)`);
  }
  return info;
}

/**
 * For a given address, check if it's an EOA, a verified contract, or an unverified contract
 */
async function checkVerificationStatus(
  sim: TenderlySimulation,
  addr: `0x${string}`,
  publicClient: PublicClient,
): Promise<'verified' | 'eoa' | 'unverified'> {
  // If an address exists in the contracts array, it's verified on Etherscan
  const contract = sim.contracts.find((item) => item.address === addr);
  if (contract) return 'verified';
  // Otherwise, check if there's code at the address. Addresses with code not in the contracts array are not verified
  const code = await publicClient.getCode({ address: addr });
  return code === '0x' ? 'eoa' : 'unverified';
}
