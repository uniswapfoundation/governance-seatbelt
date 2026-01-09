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
    description: 'security test',
    targets,
    values: [0n],
    signatures: ['0x'],
    calldatas: ['0x'],
  };
}

describe('Selfdestruct checks - security against placeholder bypass', () => {
  test('prevents security bypass when malicious placeholder is used', async () => {
    // An attacker trying to use a dangerous address as "placeholder"
    const maliciousPlaceholder = getAddress('0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF');

    // Configure PC to return malicious address as empty (would trigger warning)
    const deps = makeDeps({
      publicClient: {
        getCode: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === maliciousPlaceholder) return '0x'; // empty (triggers warning)
          return '0x';
        },
        getTransactionCount: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === maliciousPlaceholder) return 0; // empty -> warning
          return 0;
        },
      },
    });

    // Mock a scenario where someone has marked this malicious address as a "placeholder"
    // by modifying the isOurPlaceholder detection (this simulates the attack)
    const proposal = makeProposal([maliciousPlaceholder]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, {} as any, deps);

    // The malicious placeholder should NOT be suppressed - warning should remain
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join('\n')).toContain('DeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF');
  });

  test('only suppresses warnings from the legitimate hardcoded placeholder', async () => {
    const legitimatePlaceholder = DEFAULT_SIMULATION_ADDRESS;

    const deps = makeDeps({
      publicClient: {
        getCode: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === getAddress(legitimatePlaceholder)) return '0x'; // empty
          return '0x';
        },
        getTransactionCount: async ({ address }: { address: string }) => {
          const a = getAddress(address);
          if (a === getAddress(legitimatePlaceholder)) return 0; // empty -> warning
          return 0;
        },
      },
    });

    const proposal = makeProposal([legitimatePlaceholder]);
    const res = await checkTargetsNoSelfdestruct.checkProposal(proposal, {} as any, deps);

    // Only the legitimate hardcoded placeholder should be suppressed
    expect(res.warnings.length).toBe(0);
  });
});
