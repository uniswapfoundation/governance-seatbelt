import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import type {
  AllCheckResults,
  ProposalEvent,
  SimulationBlock,
  StructuredSimulationReport,
} from '../types';

// Import the actual functions and constants we want to test
import { generateAndSaveReports } from '../presentation/report';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

// Mock data for testing
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
      warnings: [],
      info: ['Test info'],
    },
  },
};

describe('Placeholder Address Detection and Labeling', () => {
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

  test('should detect placeholder address and set proposerIsPlaceholder flag', async () => {
    // Create a proposal with the default simulation address as proposer
    const proposalWithPlaceholder: ProposalEvent = {
      id: 123n,
      proposalId: 123n,
      proposer: DEFAULT_SIMULATION_ADDRESS, // Use the placeholder address
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Test Proposal\n\nThis is a new proposal simulation.',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0x123456'],
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposalWithPlaceholder,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated JSON file
    const jsonPath = join(testOutputDir, '123.json');
    expect(existsSync(jsonPath)).toBe(true);

    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // Test that the placeholder address is detected
    expect(report.metadata.proposer).toBe(DEFAULT_SIMULATION_ADDRESS);
    expect(report.metadata.proposerIsPlaceholder).toBe(true);
  });

  test('should not flag real proposer addresses as placeholders', async () => {
    // Create a proposal with a real proposer address
    const realProposerAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const proposalWithRealProposer: ProposalEvent = {
      id: 124n,
      proposalId: 124n,
      proposer: realProposerAddress, // Use a real proposer address
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Real Proposal\n\nThis is an existing proposal.',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0x123456'],
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposalWithRealProposer,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated JSON file
    const jsonPath = join(testOutputDir, '124.json');
    expect(existsSync(jsonPath)).toBe(true);

    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // Test that the real proposer is not flagged as placeholder
    expect(report.metadata.proposer).toBe(realProposerAddress);
    expect(report.metadata.proposerIsPlaceholder).toBe(false);
  });

  test('should add placeholder label in markdown report', async () => {
    // Create a proposal with the default simulation address as proposer
    const proposalWithPlaceholder: ProposalEvent = {
      id: 125n,
      proposalId: 125n,
      proposer: DEFAULT_SIMULATION_ADDRESS, // Use the placeholder address
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Test Proposal\n\nThis is a new proposal simulation.',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0x123456'],
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposalWithPlaceholder,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated markdown file
    const markdownPath = join(testOutputDir, '125.md');
    expect(existsSync(markdownPath)).toBe(true);

    const markdownContent = readFileSync(markdownPath, 'utf8');

    // Test that the markdown contains the placeholder label
    expect(markdownContent).toContain('(placeholder simulation address)');
    expect(markdownContent).toContain(DEFAULT_SIMULATION_ADDRESS);
  });

  test('should not add placeholder label for real proposer addresses in markdown', async () => {
    // Create a proposal with a real proposer address
    const realProposerAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const proposalWithRealProposer: ProposalEvent = {
      id: 126n,
      proposalId: 126n,
      proposer: realProposerAddress, // Use a real proposer address
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Real Proposal\n\nThis is an existing proposal.',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0x123456'],
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposalWithRealProposer,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated markdown file
    const markdownPath = join(testOutputDir, '126.md');
    expect(existsSync(markdownPath)).toBe(true);

    const markdownContent = readFileSync(markdownPath, 'utf8');

    // Test that the markdown does NOT contain the placeholder label
    expect(markdownContent).not.toContain('(placeholder simulation address)');
    expect(markdownContent).toContain(realProposerAddress);
  });

  test('should handle address case sensitivity correctly', async () => {
    // Test with lowercase version of the placeholder address to ensure getAddress normalization works
    const lowercasePlaceholder = DEFAULT_SIMULATION_ADDRESS.toLowerCase() as `0x${string}`;
    const proposalWithLowercasePlaceholder: ProposalEvent = {
      id: 127n,
      proposalId: 127n,
      proposer: lowercasePlaceholder,
      startBlock: 18000000n,
      endBlock: 18100000n,
      description: '# Test Proposal\n\nThis is a new proposal simulation.',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: ['transfer(address,uint256)'],
      calldatas: ['0x123456'],
    };

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: proposalWithLowercasePlaceholder,
      checks: mockChecks,
      outputDir: testOutputDir,
      governorAddress: mockGovernorAddress,
    });

    // Read the generated JSON file
    const jsonPath = join(testOutputDir, '127.json');
    expect(existsSync(jsonPath)).toBe(true);

    const content = readFileSync(jsonPath, 'utf8');
    const report: StructuredSimulationReport = JSON.parse(content);

    // Test that the lowercase address is still detected as placeholder due to getAddress normalization
    expect(getAddress(report.metadata.proposer)).toBe(getAddress(DEFAULT_SIMULATION_ADDRESS));
    expect(report.metadata.proposerIsPlaceholder).toBe(true);
  });
});
