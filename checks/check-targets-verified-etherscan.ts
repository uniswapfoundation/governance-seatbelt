import { getAddress } from 'viem';
import type { ProposalCheck } from '../types.d';
import type { ChainConfig } from '../utils/clients/client';

interface VerificationStatus {
  address: string;
  isVerified: boolean;
  isEOA: boolean;
  link: string;
}

async function checkVerificationStatus(
  address: string,
  chainConfig: ChainConfig,
): Promise<VerificationStatus> {
  const normalizedAddress = getAddress(address);
  const link = `${chainConfig.blockExplorer}/address/${normalizedAddress}`;
  // TODO: Implement actual verification check
  return {
    address: normalizedAddress,
    isVerified: true,
    isEOA: false,
    link,
  };
}

async function checkVerificationStatuses(
  addresses: string[],
  chainConfig: ChainConfig,
): Promise<VerificationStatus[]> {
  return Promise.all(addresses.map((address) => checkVerificationStatus(address, chainConfig)));
}

export const checkTargetsVerifiedEtherscan: ProposalCheck = {
  name: 'Check if all target contracts are verified on Etherscan',
  async checkProposal(_, __, deps) {
    const { targets, chainConfig } = deps;
    if (!targets?.length) return { info: [], warnings: [], errors: [] };

    const statuses = await checkVerificationStatuses(targets, chainConfig);

    const verified = statuses.filter((s) => s.isVerified);
    const unverified = statuses.filter((s) => !s.isVerified);
    const eoas = statuses.filter((s) => s.isEOA);

    return {
      info: [
        `Found ${verified.length} verified contracts`,
        `Found ${unverified.length} unverified contracts`,
        `Found ${eoas.length} EOAs`,
      ],
      warnings: unverified.map(
        (s) => `Contract ${s.address} is not verified on ${chainConfig.blockExplorer}`,
      ),
      errors: [],
    };
  },
};

export const checkTouchedContractsVerifiedEtherscan: ProposalCheck = {
  name: 'Check if all touched contracts are verified on Etherscan',
  async checkProposal(_, __, deps) {
    const { touchedContracts, chainConfig } = deps;
    if (!touchedContracts?.length) return { info: [], warnings: [], errors: [] };

    const statuses = await checkVerificationStatuses(touchedContracts, chainConfig);

    const verified = statuses.filter((s) => s.isVerified);
    const unverified = statuses.filter((s) => !s.isVerified);
    const eoas = statuses.filter((s) => s.isEOA);

    return {
      info: [
        `Found ${verified.length} verified contracts`,
        `Found ${unverified.length} unverified contracts`,
        `Found ${eoas.length} EOAs`,
      ],
      warnings: unverified.map(
        (s) => `Contract ${s.address} is not verified on ${chainConfig.blockExplorer}`,
      ),
      errors: [],
    };
  },
};
