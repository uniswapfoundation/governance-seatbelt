import { describe, expect, it } from 'bun:test';
import { encodeFunctionData } from 'viem';
import type { Address } from 'viem';
import { GOVERNOR_ABI } from '../frontend/src/config/abis';
import { getProposalActionUi, getProposalCardUi } from '../frontend/src/lib/proposal-action-ui';
import {
  buildExecuteArgs,
  buildExecuteArgsFromSimulationData,
  buildProposeArgs,
  parseSimulationType,
  resolveProposalAction,
} from '../frontend/src/lib/write-actions';

describe('frontend write actions (deterministic wiring)', () => {
  it('buildProposeArgs maps proposalData into Governor.propose args', () => {
    const targets = ['0x0000000000000000000000000000000000000001'] as Address[];
    const values = [0n, 1n];
    const signatures = [''] as string[];
    const calldatas = ['0x1234'] as `0x${string}`[];
    const description = 'Test proposal';

    const args = buildProposeArgs({ targets, values, signatures, calldatas, description });

    expect(args[0]).toEqual(targets);
    expect(args[1]).toEqual([0n, 1n]);
    expect(args[2]).toEqual(signatures);
    expect(args[3]).toEqual(calldatas);
    expect(args[4]).toBe(description);
  });

  it('Governor ABI can encode propose args produced by buildProposeArgs', () => {
    const targets = ['0x0000000000000000000000000000000000000001'] as Address[];
    const values = [0n, 1n];
    const signatures = [''] as string[];
    const calldatas = ['0x1234'] as `0x${string}`[];
    const description = 'Test proposal';

    const args = buildProposeArgs({ targets, values, signatures, calldatas, description });
    const data = encodeFunctionData({ abi: GOVERNOR_ABI, functionName: 'propose', args });

    expect(data.startsWith('0x')).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it('buildExecuteArgs converts proposalId to BigInt', () => {
    expect(buildExecuteArgs('123')).toEqual([123n]);
    expect(buildExecuteArgs(456n)).toEqual([456n]);
  });

  it('Governor ABI can encode execute args produced by buildExecuteArgs', () => {
    const args = buildExecuteArgs('123');
    const data = encodeFunctionData({ abi: GOVERNOR_ABI, functionName: 'execute', args });
    expect(data.startsWith('0x')).toBe(true);
    expect(data.length).toBeGreaterThan(10);
  });

  it('buildExecuteArgsFromSimulationData reads proposalId from structuredReport metadata', () => {
    const args = buildExecuteArgsFromSimulationData({
      report: { structuredReport: { metadata: { proposalId: '999' } } },
    });
    expect(args).toEqual([999n]);
  });

  it('buildExecuteArgsFromSimulationData throws when proposalId is missing', () => {
    expect(() => buildExecuteArgsFromSimulationData({ report: {} })).toThrow(
      'Proposal ID not found in simulation data',
    );
  });

  it('resolveProposalAction maps simulation metadata to write availability', () => {
    expect(resolveProposalAction(undefined)).toEqual({ kind: 'propose' });
    expect(resolveProposalAction(null)).toEqual({ kind: 'propose' });
    expect(resolveProposalAction('new')).toEqual({ kind: 'propose' });
    expect(resolveProposalAction('executed')).toEqual({ kind: 'executed' });
    expect(resolveProposalAction('proposed')).toEqual({ kind: 'blocked', reason: 'unknown' });
    expect(resolveProposalAction('proposed', 'Queued')).toEqual({ kind: 'execute' });
    expect(resolveProposalAction('proposed', 'Defeated')).toEqual({
      kind: 'blocked',
      reason: 'defeated',
    });
    expect(resolveProposalAction('proposed', 'Expired')).toEqual({
      kind: 'blocked',
      reason: 'expired',
    });
    expect(resolveProposalAction('proposed', 'Canceled')).toEqual({
      kind: 'blocked',
      reason: 'canceled',
    });
    expect(resolveProposalAction('proposed', 'Active')).toEqual({
      kind: 'blocked',
      reason: 'unknown',
    });
    expect(resolveProposalAction('proposed', 'Succeeded')).toEqual({
      kind: 'blocked',
      reason: 'unknown',
    });
    expect(resolveProposalAction('proposed', 'Pending')).toEqual({
      kind: 'blocked',
      reason: 'unknown',
    });
    expect(resolveProposalAction('proposed', 'Executed')).toEqual({
      kind: 'blocked',
      reason: 'unknown',
    });
    expect(resolveProposalAction('not-a-real-type')).toEqual({ kind: 'invalid' });
  });

  it('only queued proposed simulations are executable', () => {
    const nonExecutableStates = [
      undefined,
      'Defeated',
      'Expired',
      'Canceled',
      'Active',
      'Succeeded',
      'Pending',
      'Executed',
    ];

    for (const proposalState of nonExecutableStates) {
      expect(resolveProposalAction('proposed', proposalState)).not.toEqual({ kind: 'execute' });
    }

    expect(resolveProposalAction('proposed', 'Queued')).toEqual({ kind: 'execute' });
  });

  it('surface-specific action ui helpers stay aligned with action state', () => {
    expect(getProposalActionUi({ kind: 'propose' }).nav.label).toBe('Propose');
    expect(getProposalActionUi({ kind: 'execute' }).summary.buttonText).toBe('Review & Execute');
    expect(
      getProposalCardUi(
        { kind: 'executed' },
        { isConnected: true, isPending: false, isPendingConfirmation: false },
      ).showButton,
    ).toBe(false);
    expect(getProposalActionUi({ kind: 'blocked', reason: 'defeated' }).page.title).toBe(
      'Proposal Defeated',
    );
    expect(getProposalActionUi({ kind: 'blocked', reason: 'unknown' }).nav.label).toBe(
      'Unavailable',
    );
    expect(getProposalActionUi({ kind: 'invalid' }).summary.title).toBe('Action Unavailable');
  });

  it('getProposalCardUi maps wallet and pending state onto the CTA', () => {
    expect(
      getProposalCardUi(
        { kind: 'execute' },
        { isConnected: true, isPending: false, isPendingConfirmation: false },
      ),
    ).toEqual({
      title: 'Proposal calls',
      description: 'Calls included in this proposal.',
      readyText: 'Ready to execute',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
      buttonLabel: 'Execute',
      buttonIconName: 'play',
      isButtonDisabled: false,
      showButton: true,
    });

    expect(
      getProposalCardUi(
        { kind: 'propose' },
        { isConnected: false, isPending: false, isPendingConfirmation: false },
      ),
    ).toEqual({
      title: 'Proposal calls',
      description: 'Calls included in this proposal.',
      readyText: 'Ready to propose',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
      buttonLabel: 'Connect Wallet',
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: true,
    });

    expect(
      getProposalCardUi(
        { kind: 'blocked', reason: 'defeated' },
        { isConnected: true, isPending: false, isPendingConfirmation: false },
      ),
    ).toEqual({
      title: 'Proposal Defeated',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal defeated',
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-red-500',
      buttonLabel: null,
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: false,
    });
  });

  it('parseSimulationType returns null for unknown values', () => {
    expect(parseSimulationType('new')).toBe('new');
    expect(parseSimulationType('proposed')).toBe('proposed');
    expect(parseSimulationType('executed')).toBe('executed');
    expect(parseSimulationType(undefined)).toBe(null);
    expect(parseSimulationType('not-a-real-type')).toBe(null);
  });
});
