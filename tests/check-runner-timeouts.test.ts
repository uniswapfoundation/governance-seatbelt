import { describe, expect, it } from 'bun:test';
import type { ProposalCheck, ProposalData, ProposalEvent, TenderlySimulation } from '../types.d';
import { runChecksWithTimeouts } from '../utils/check-runner';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal fixtures (we only care about orchestration behavior)
const proposal = {} as ProposalEvent;
const sim = {} as TenderlySimulation;
const deps = {} as ProposalData;

describe('runChecksWithTimeouts', () => {
  it('marks per-check timeouts as skipped and continues running subsequent checks', async () => {
    const checks: Record<string, ProposalCheck> = {
      fast: {
        name: 'Fast',
        async checkProposal(_proposal, _tx, _deps) {
          return { info: ['fast'], warnings: [], errors: [] };
        },
      },
      slow: {
        name: 'Slow',
        async checkProposal(_proposal, _tx, _deps) {
          await sleep(50);
          return { info: ['slow'], warnings: [], errors: [] };
        },
      },
      after: {
        name: 'After',
        async checkProposal(_proposal, _tx, _deps) {
          return { info: ['after'], warnings: [], errors: [] };
        },
      },
    };

    const results = await runChecksWithTimeouts(checks, proposal, sim, deps, undefined, {
      globalTimeoutMs: 1000,
      defaultPerCheckTimeoutMs: 20,
    });

    expect(results.fast.result.info).toEqual(['fast']);
    expect(results.slow.result.skipped?.reason).toContain('per-check timeout');
    expect(results.after.result.info).toEqual(['after']);
  });

  it('applies per-check timeout overrides', async () => {
    const checks: Record<string, ProposalCheck> = {
      slow: {
        name: 'Slow',
        async checkProposal(_proposal, _tx, _deps) {
          await sleep(30);
          return { info: ['slow'], warnings: [], errors: [] };
        },
      },
    };

    const results = await runChecksWithTimeouts(checks, proposal, sim, deps, undefined, {
      globalTimeoutMs: 1000,
      defaultPerCheckTimeoutMs: 100,
      perCheckTimeoutOverridesMs: { slow: 10 },
    });

    expect(results.slow.result.skipped?.reason).toContain('per-check timeout');
  });

  it('marks global timeout and skips remaining checks', async () => {
    const checks: Record<string, ProposalCheck> = {
      first: {
        name: 'First',
        async checkProposal(_proposal, _tx, _deps) {
          await sleep(50);
          return { info: ['first'], warnings: [], errors: [] };
        },
      },
      second: {
        name: 'Second',
        async checkProposal(_proposal, _tx, _deps) {
          return { info: ['second'], warnings: [], errors: [] };
        },
      },
    };

    const results = await runChecksWithTimeouts(checks, proposal, sim, deps, undefined, {
      globalTimeoutMs: 20,
      defaultPerCheckTimeoutMs: 100,
    });

    expect(results.first.result.skipped?.reason).toContain('global checks timeout');
    expect(results.second.result.skipped?.reason).toContain('global checks timeout');
  });

  it('captures thrown check errors and continues', async () => {
    const checks: Record<string, ProposalCheck> = {
      thrower: {
        name: 'Thrower',
        async checkProposal(_proposal, _tx, _deps) {
          throw new Error('boom');
        },
      },
      after: {
        name: 'After',
        async checkProposal(_proposal, _tx, _deps) {
          return { info: ['after'], warnings: [], errors: [] };
        },
      },
    };

    const results = await runChecksWithTimeouts(checks, proposal, sim, deps, undefined, {
      globalTimeoutMs: 1000,
      defaultPerCheckTimeoutMs: 1000,
    });

    expect(results.thrower.result.errors.join('\n')).toContain('boom');
    expect(results.after.result.info).toEqual(['after']);
  });
});
