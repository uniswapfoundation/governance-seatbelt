import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { ProposalCheck } from '../types';
import type { ChainConfig } from '../utils/clients/client';
import { isContractVerified } from '../utils/clients/etherscan';

/**
 * Check all targets with code are verified on Etherscan
 */
export const checkTargetsVerifiedEtherscan: ProposalCheck = {
  name: 'Check all targets are verified on Etherscan',
  async checkProposal(proposal, _, deps) {
    const uniqueTargets = proposal.targets.filter(
      (addr, i, targets) => targets.indexOf(addr) === i,
    );
    const info = await checkVerificationStatuses(uniqueTargets.map(getAddress), deps.publicClient, deps.chainConfig);
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
): Promise<'verified' | 'eoa' | 'unverified'> {
  // First check if there's code at the address
  const code = await publicClient.getCode({ address: addr });
  if (code === '0x') return 'eoa';

  // For contracts, check verification status via appropriate block explorer API
  const isVerified = await isContractVerified(addr, chainId);
  return isVerified ? 'verified' : 'unverified';
}
