import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { checkTargetsNoSelfdestruct } from '../checks/check-targets-no-selfdestruct';
import type { ProposalData, ProposalEvent } from '../types';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

function makeDeps(overrides?: Partial<ProposalData>): ProposalData {
  return {
    governor: { address: getAddress('0x1111111111111111111111111111111111111111') },
    timelock: { address: getAddress('0x2222222222222222222222222222222222222222') },
    publicClient: overrides?.publicClient ?? {
      // default EOA (empty account)
      getCode: async (_: { address: string }) => '0x',
      getTransactionCount: async (_: { address: string }) => 0,
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
    description: 'placeholder suppression test',
    targets,
    values: [0n],
    signatures: ['0x'],
    calldatas: ['0x'],
  };
}

describe('Selfdestruct checks - placeholder warning suppression', () => {
  test('suppresses warnings when only placeholder yields a warning', async () => {
    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const realEoa = getAddress('0x1234567890abcdef1234567890abcdef12345678');

    // Configure PC to return: placeholder -> empty (warning), realEoa -> eoa (info)
    const deps = makeDeps({
      publicClient: {
        getCode: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === getAddress(placeholder)) return '0x'; // empty
          if (a === realEoa) return '0x'; // still 0x, but we'll set nonce > 0 to mark EOA
          return '0x';
        },
        getTransactionCount: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === getAddress(placeholder)) return 0; // empty -> warning
          if (a === realEoa) return 1; // eoa -> info
          return 0;
        },
      },
    });

    const proposal = makeProposal([placeholder, realEoa]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, {} as any, deps);

    // Only placeholder would have triggered a warning; suppression should clear all warnings
    expect(res.warnings.length).toBe(0);
    // The info should contain the real EOA, placeholder warning was suppressed entirely
    expect(res.info.join('\n')).toContain('0x1234567890abCdEf1234567890AbCDEF12345678');
  });

  test('does not suppress when there are non-placeholder warnings', async () => {
    const placeholder = DEFAULT_SIMULATION_ADDRESS;
    const otherEmpty = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    // Configure PC to return: placeholder -> empty (warning), otherEmpty -> empty (warning)
    const deps = makeDeps({
      publicClient: {
        getCode: async (_: { address: string }) => '0x',
        getTransactionCount: async (_: { address: string }) => 0,
      },
    });

    const proposal = makeProposal([placeholder, otherEmpty]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, {} as any, deps);

    // Two warnings should remain (no suppression because non-placeholder also warns)
    expect(res.warnings.length).toBeGreaterThanOrEqual(1);
    expect(res.warnings.join('\n')).toContain('(simulation placeholder)');
  });
});
