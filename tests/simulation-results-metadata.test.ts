import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AllCheckResults,
  ProposalEvent,
  SimulationBlock,
  StructuredSimulationReport,
} from '../types';

// Import the actual functions we want to test
import { generateAndSaveReports } from '../presentation/report';

// Mock data for testing
const mockProposal: ProposalEvent = {
  id: 123n,
  proposalId: 123n,
  proposer: '0x1234567890abcdef1234567890abcdef12345678',
  startBlock: 18000000n,
  endBlock: 18100000n,
  description: '# Test Proposal\n\nThis is a test proposal description.',
  targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
  values: [0n],
  signatures: ['transfer(address,uint256)'],
  calldatas: ['0x123456'],
};

const mockBlocks = {
  current: { number: 18200000n, timestamp: 1700000000n } as SimulationBlock,
  start: { number: 18000000n, timestamp: 1699000000n } as SimulationBlock,
  end: { number: 18100000n, timestamp: 1699500000n } as SimulationBlock,
};

const mockGovernorAddress = '0x9876543210fedcba9876543210fedcba98765432' as const;

const mockChecks: AllCheckResults = {
  'test-check': {
    name: 'Test Check',
    result: {
      errors: [],
      warnings: ['Test warning'],
      info: ['Test info'],
    },
  },
};

describe('Simulation Results Metadata', () => {
  const testOutputDir = join(__dirname, 'test-output');

  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
    mkdirSync(testOutputDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
  });

  test('should generate structured report with governorAddress in metadata', async () => {
    // Generate reports in test directory
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated JSON file
    const jsonPath = join(testOutputDir, '123.json');
    expect(existsSync(jsonPath)).toBe(true);

    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // Test that metadata includes the new fields
    expect(report.metadata.proposer).toBe(mockProposal.proposer);
    expect(report.metadata.proposalId).toBe('123');

    // These should fail until we implement the changes
    expect(report.metadata.governorAddress).toBe(mockGovernorAddress);
  });

  test('should include executor field for executed proposals when different from proposer', async () => {
    // Create a mock executed proposal where executor != proposer
    const executorAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const executedProposal = {
      ...mockProposal,
      proposer: '0x1234567890abcdef1234567890abcdef12345678', // Original proposer
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: executedProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
      executor: executorAddress, // Pass the executor
    });

    const jsonPath = join(testOutputDir, '123.json');
    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // Should have the original proposer, not the executor
    expect(report.metadata.proposer).toBe('0x1234567890abcdef1234567890abcdef12345678');

    // This should fail until we implement executor tracking
    expect(report.metadata.executor).toBe(executorAddress);
  });

  test('should include executor field even when proposer == executor', async () => {
    // Test case where proposer == executor (executed by original proposer)
    const proposerExecutorAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const executedProposal = {
      ...mockProposal,
      proposer: proposerExecutorAddress,
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: executedProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
      executor: proposerExecutorAddress, // Pass the same address as executor
    });

    const jsonPath = join(testOutputDir, '123.json');
    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // executor field should be defined even when same as proposer
    expect(report.metadata.proposer).toBe(proposerExecutorAddress);
    expect(report.metadata.executor).toBe(proposerExecutorAddress);
  });

  test('should not include executor field for non-executed proposals', async () => {
    // Test case for proposals that haven't been executed yet
    const proposedOnlyProposal = {
      ...mockProposal,
      proposer: '0x1234567890abcdef1234567890abcdef12345678',
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposedOnlyProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    const jsonPath = join(testOutputDir, '123.json');
    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // executor field should be undefined for non-executed proposals
    expect(report.metadata.proposer).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(report.metadata.executor).toBeUndefined();
  });

  test('should generate simulation-results.json file in bulk mode', async () => {
    // Test that we generate the frontend JSON file alongside the regular reports
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Check that the simulation-results.json file is created
    const simulationResultsPath = join(testOutputDir, '123-simulation-results.json');

    // This should fail until we implement the new writeSimulationResultsJson function
    expect(existsSync(simulationResultsPath)).toBe(true);

    if (existsSync(simulationResultsPath)) {
      const content = readFileSync(simulationResultsPath, 'utf8');
      const data = JSON.parse(content);

      // Should be in the same format as the current frontend data
      expect(data).toHaveProperty('proposalData');
      expect(data).toHaveProperty('report');
      expect(data.report.structuredReport.metadata.governorAddress).toBe(mockGovernorAddress);
    }
  });
});

describe('File Generation Tests', () => {
  const testOutputDir = join(__dirname, 'test-output');

  beforeEach(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
    mkdirSync(testOutputDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
  });

  test('should generate all expected report files', async () => {
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Check that all the standard files are generated
    expect(existsSync(join(testOutputDir, '123.md'))).toBe(true);
    expect(existsSync(join(testOutputDir, '123.html'))).toBe(true);
    expect(existsSync(join(testOutputDir, '123.json'))).toBe(true);
    expect(existsSync(join(testOutputDir, '123.pdf'))).toBe(true);

    // Check that our new simulation-results file is also generated
    expect(existsSync(join(testOutputDir, '123-simulation-results.json'))).toBe(true);
  });
});
