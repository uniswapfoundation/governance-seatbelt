import { describe, expect, it } from 'bun:test';
import { checkDecodeCalldata } from '../checks/check-decode-calldata';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';

describe('checkDecodeCalldata concurrency', () => {
  it('caps concurrent ABI decodes to 2', async () => {
    const timelock = '0x1111111111111111111111111111111111111111';

    const targets = Array.from(
      { length: 8 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
    );
    const calldatas = Array.from(
      { length: targets.length },
      (_, i) => `0x12345678${(i + 1).toString(16).padStart(64, '0')}`,
    );

    const calls = targets.map((to, i) => ({
      from: timelock,
      to,
      input: calldatas[i],
      value: '0',
    }));

    const proposal: ProposalEvent = {
      id: 1n,
      proposalId: 1n,
      proposer: timelock,
      startBlock: 0n,
      endBlock: 0n,
      description: 'test',
      targets,
      values: Array.from({ length: targets.length }, () => 0n),
      signatures: Array.from({ length: targets.length }, () => ''),
      calldatas,
    };

    const sim = {
      transaction: {
        transaction_info: {
          call_trace: { calls },
        },
      },
      contracts: [],
    } as unknown as TenderlySimulation;

    const deps = {
      chainConfig: { chainId: 1 },
      timelock: { address: timelock },
    } as unknown as ProposalData;

    const original = BlockExplorerFactory.decodeFunctionWithAbi;

    let inFlight = 0;
    let maxInFlight = 0;
    BlockExplorerFactory.decodeFunctionWithAbi = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      inFlight--;
      return { name: 'foo', args: [] };
    };

    try {
      const result = await checkDecodeCalldata.checkProposal(proposal, sim, deps, undefined);

      expect(result.errors).toEqual([]);
      expect(result.info.length).toBe(targets.length);
      expect(maxInFlight).toBe(2);
    } finally {
      BlockExplorerFactory.decodeFunctionWithAbi = original;
    }
  });
});
