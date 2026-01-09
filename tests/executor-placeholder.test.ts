import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'node:fs';
import { getAddress } from 'viem';
import { writeSimulationResultsJson } from '../presentation/report';
import type { AllCheckResults, GovernorType, ProposalEvent, SimulationBlocks } from '../types';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

function makeMockBlocks(): SimulationBlocks {
  return {
    current: { number: 1000n, timestamp: 1234567890n },
    start: null,
    end: null,
  };
}

function makeMockProposal(): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: getAddress('0x1111111111111111111111111111111111111111'),
    startBlock: 999n,
    endBlock: 1001n,
    description: 'Test proposal',
    targets: ['0x2222222222222222222222222222222222222222'],
    values: [0n],
    signatures: ['test()'],
    calldatas: ['0x'],
  };
}

function makeMockChecks(): AllCheckResults {
  return {
    'test-check': {
      name: 'Test Check',
      result: { info: [], warnings: [], errors: [] },
    },
  };
}

describe('Executor placeholder detection', () => {
  test('detects when executor is placeholder address', async () => {
    const governorType: GovernorType = 'oz';
    const blocks = makeMockBlocks();
    const proposal = makeMockProposal();
    const checks = makeMockChecks();
    const governorAddress = '0x3333333333333333333333333333333333333333';
    const outputPath = '/tmp/test-executor-placeholder.json';

    // Clean up any existing test file
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }

    // Test with executor as placeholder
    writeSimulationResultsJson({
      governorType,
      blocks,
      proposal,
      checks,
      markdownReport: '# Test Report',
      governorAddress,
      outputPath,
      executor: DEFAULT_SIMULATION_ADDRESS,
    });

    expect(existsSync(outputPath)).toBe(true);

    const resultData = await Bun.file(outputPath).json();
    expect(resultData.report.structuredReport.metadata.executor).toBe(DEFAULT_SIMULATION_ADDRESS);
    expect(resultData.report.structuredReport.metadata.executorIsPlaceholder).toBe(true);

    // Clean up
    unlinkSync(outputPath);
  });

  test('detects when executor is not placeholder address', async () => {
    const governorType: GovernorType = 'oz';
    const blocks = makeMockBlocks();
    const proposal = makeMockProposal();
    const checks = makeMockChecks();
    const governorAddress = '0x3333333333333333333333333333333333333333';
    const realExecutor = '0x4444444444444444444444444444444444444444';
    const outputPath = '/tmp/test-executor-real.json';

    // Clean up any existing test file
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }

    // Test with real executor
    writeSimulationResultsJson({
      governorType,
      blocks,
      proposal,
      checks,
      markdownReport: '# Test Report',
      governorAddress,
      outputPath,
      executor: realExecutor,
    });

    expect(existsSync(outputPath)).toBe(true);

    const resultData = await Bun.file(outputPath).json();
    expect(resultData.report.structuredReport.metadata.executor).toBe(realExecutor);
    expect(resultData.report.structuredReport.metadata.executorIsPlaceholder).toBe(false);

    // Clean up
    unlinkSync(outputPath);
  });

  test('handles undefined executor correctly', async () => {
    const governorType: GovernorType = 'oz';
    const blocks = makeMockBlocks();
    const proposal = makeMockProposal();
    const checks = makeMockChecks();
    const governorAddress = '0x3333333333333333333333333333333333333333';
    const outputPath = '/tmp/test-executor-undefined.json';

    // Clean up any existing test file
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }

    // Test with undefined executor (new proposal scenario)
    writeSimulationResultsJson({
      governorType,
      blocks,
      proposal,
      checks,
      markdownReport: '# Test Report',
      governorAddress,
      outputPath,
      // executor is undefined
    });

    expect(existsSync(outputPath)).toBe(true);

    const resultData = await Bun.file(outputPath).json();
    expect(resultData.report.structuredReport.metadata.executor).toBeUndefined();
    expect(resultData.report.structuredReport.metadata.executorIsPlaceholder).toBeUndefined();

    // Clean up
    unlinkSync(outputPath);
  });
});
