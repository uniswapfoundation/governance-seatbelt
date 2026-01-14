import { describe, expect, it } from 'bun:test';
import {
  SimulationResultsParseError,
  parseSimulationResultsJson,
} from '../frontend/src/lib/simulation-results';

describe('simulation-results parsing', () => {
  it('normalizes a single object into an array', () => {
    const input = {
      proposalData: {
        targets: ['0x0000000000000000000000000000000000000001'],
        values: ['0'],
        signatures: ['0x'],
        calldatas: ['0x'],
        description: 'Test',
      },
      report: {
        status: 'success',
        summary: 'ok',
        markdownReport: '# Report',
      },
    };

    const results = parseSimulationResultsJson(input);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
  });

  it('throws when the simulation result shape is invalid', () => {
    const input = {
      proposalData: {
        targets: ['0x0000000000000000000000000000000000000001'],
        values: null,
        signatures: ['0x'],
        calldatas: ['0x'],
        description: 'Test',
      },
      report: {
        status: 'success',
        summary: 'ok',
        markdownReport: '# Report',
      },
    };

    expect(() => parseSimulationResultsJson(input)).toThrow(SimulationResultsParseError);
  });
});
