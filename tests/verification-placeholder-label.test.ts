import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { checkTargetsVerifiedOnBlockExplorer } from '../checks/check-targets-verified-etherscan';
import type { ProposalData, ProposalEvent } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

function makeDeps(overrides?: Partial<ProposalData>): ProposalData {
  return {
    governor: { address: getAddress('0x1111111111111111111111111111111111111111') },
    timelock: { address: getAddress('0x2222222222222222222222222222222222222222') },
    publicClient: overrides?.publicClient ?? {
      getCode: async (_: { address: string }) => '0x60', // non-empty => contract path
      getTransactionCount: async (_: { address: string }) => 1,
    },
    chainConfig: {
      chainId: 1,
      blockExplorer: { baseUrl: 'https://etherscan.io' },
    },
    targets: [],
    touchedContracts: [],
    ...overrides,
  } as unknown as ProposalData;
}

function makeProposal(targets: string[]): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: getAddress('0x9999999999999999999999999999999999999999'),
    startBlock: 0n,
    endBlock: 1n,
    description: 'verification label test',
    targets,
    values: [0n],
    signatures: ['0x'],
    calldatas: ['0x'],
  };
}

describe('Verification checks - placeholder labeling', () => {
  test('labels placeholder and shows verified/unverified as expected', async () => {
    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const realContract = getAddress('0x1234567890abcdef1234567890abcdef12345678');

    // Monkey-patch isContractVerified to avoid network requests
    const original = BlockExplorerFactory.isContractVerified;
    BlockExplorerFactory.isContractVerified = async (addr: string, _chainId: number) => {
      return getAddress(addr) !== realContract; // placeholder -> true, real -> false
    };

    try {
      const deps = makeDeps();
      const proposal = makeProposal([placeholder, realContract]);
      const res = await checkTargetsVerifiedOnBlockExplorer.checkProposal(
        proposal,
        {} as any,
        deps,
      );

      const output = res.info.join('\n');
      expect(output).toContain('(simulation placeholder)');
      expect(output).toMatch(/Contract \(verified\)/); // placeholder
      expect(output).toMatch(/Contract \(not verified\)/); // realContract
    } finally {
      BlockExplorerFactory.isContractVerified = original;
    }
  });
});
