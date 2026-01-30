import { describe, expect, it } from 'bun:test';
import { encodeFunctionData } from 'viem';
import type { Address } from 'viem';
import { GOVERNOR_ABI } from '../frontend/src/config/abis';
import {
  buildExecuteArgs,
  buildExecuteArgsFromSimulationData,
  buildProposeArgs,
  getWriteActionForSimulationType,
  parseSimulationType,
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

  it('getWriteActionForSimulationType matches Action page branching', () => {
    expect(getWriteActionForSimulationType('new')).toBe('propose');
    expect(getWriteActionForSimulationType('proposed')).toBe('execute');
    expect(getWriteActionForSimulationType('executed')).toBe(null);
    expect(getWriteActionForSimulationType(undefined)).toBe('propose');
    expect(getWriteActionForSimulationType(null)).toBe('propose');
    expect(getWriteActionForSimulationType('not-a-real-type')).toBe(null);
  });

  it('parseSimulationType returns null for unknown values', () => {
    expect(parseSimulationType('new')).toBe('new');
    expect(parseSimulationType('proposed')).toBe('proposed');
    expect(parseSimulationType('executed')).toBe('executed');
    expect(parseSimulationType(undefined)).toBe(null);
    expect(parseSimulationType('not-a-real-type')).toBe(null);
  });
});
