import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { generateAndSaveReports } from '../presentation/report';
import type { TenderlySimulation } from '../types';

// Mock data for testing Issue #92 metadata fields
const mockSimulation: TenderlySimulation = {
  simulation: {
    id: 'test-simulation-id-123',
    project_id: 'test-project',
    owner_id: 'test-owner',
    network_id: '1',
    block_number: 123456,
    transaction_index: 0,
    from: '0x0000000000000000000000000000000000001234',
    to: '0x0000000000000000000000000000000000005678',
    input: '0x',
    gas: 21000,
    gas_price: '1000000000',
    value: '0',
    method: 'test',
    status: true,
    access_list: null,
    queue_origin: '',
    created_at: new Date('2024-01-01T00:00:00Z'),
  },
  transaction: {
    hash: '0xtest',
    block_hash: '0xblock',
    block_number: 123456,
    from: '0x0000000000000000000000000000000000001234',
    gas: 21000,
    gas_price: 1000000000,
    gas_fee_cap: 1000000000,
    gas_tip_cap: 1000000000,
    cumulative_gas_used: 21000,
    gas_used: 21000,
    effective_gas_price: 1000000000,
    input: '0x',
    nonce: 0,
    to: '0x0000000000000000000000000000000000005678',
    index: 0,
    value: '0',
    access_list: null,
    status: true,
    addresses: [],
    contract_ids: [],
    network_id: '1',
    function_selector: '0x',
    transaction_info: {
      contract_id: 'test',
      block_number: 123456,
      transaction_id: '0xtest',
      contract_address: '0x0000000000000000000000000000000000005678',
      method: 'test',
      parameters: null,
      intrinsic_gas: 21000,
      refund_gas: 0,
      call_trace: {
        from: '0x0000000000000000000000000000000000001234',
        to: '0x0000000000000000000000000000000000005678',
        input: '0x',
      },
      stack_trace: null,
      logs: null,
      state_diff: [],
      raw_state_diff: null,
      console_logs: null,
      created_at: new Date('2024-01-01T00:00:00Z'),
      asset_changes: null,
      balance_changes: null,
    },
    timestamp: new Date('2024-01-01T00:00:00Z'),
    method: 'test',
    decoded_input: null,
  },
  contracts: [],
  generated_access_list: [],
};

const mockBlocks = {
  current: { number: 123456n, timestamp: 1234567890n },
  start: null,
  end: null,
};

const mockProposal = {
  id: 92n,
  proposalId: 92n,
  proposer: '0x0000000000000000000000000000000000001234',
  targets: ['0x0000000000000000000000000000000000005678'],
  values: [0n],
  signatures: [''],
  calldatas: ['0x'],
  startBlock: 123456n,
  endBlock: 123457n,
  description: 'Test proposal for Issue #92',
};

const mockChecks = {
  'Test Check': {
    name: 'Test Check',
    result: {
      info: [],
      warnings: [],
      errors: [],
    },
  },
};

const TEST_DIR = join(__dirname, 'test-reports-issue-92');

describe('Issue #92: Decision Header Metadata', () => {
  beforeAll(() => {
    // Create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });

    // Mock environment variables for Tenderly URL generation
    process.env.TENDERLY_USER = 'test_user';
    process.env.TENDERLY_PROJECT_SLUG = 'test_project';
  });

  afterAll(() => {
    // Clean up test directory and environment
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    process.env.TENDERLY_USER = undefined;
    process.env.TENDERLY_PROJECT_SLUG = undefined;
  });

  test('should include repoCommit and repoUrl in metadata', async () => {
    // Get actual git commit and repo URL
    let expectedCommit: string | undefined;
    let expectedUrl: string | undefined;

    try {
      expectedCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      const remoteUrl = execSync('git config --get remote.origin.url', {
        encoding: 'utf-8',
      }).trim();
      expectedUrl = remoteUrl
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git$/, '');
    } catch {
      // Git not available, skip this part of the test
    }

    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: TEST_DIR,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      simulationType: 'new',
      chainId: 1,
      simulation: mockSimulation,
    });

    // Read the generated JSON report
    const reportPath = join(TEST_DIR, '92.json');
    expect(existsSync(reportPath)).toBe(true);

    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));

    // Check metadata fields
    expect(report.metadata).toBeDefined();

    if (expectedCommit) {
      expect(report.metadata.repoCommit).toBe(expectedCommit);
    }

    if (expectedUrl) {
      expect(report.metadata.repoUrl).toBe(expectedUrl);
    }
  });

  test('should generate Tenderly URL when simulation ID is provided', async () => {
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: TEST_DIR,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      simulationType: 'new',
      chainId: 1,
      simulation: mockSimulation,
    });

    // Read the generated JSON report
    const reportPath = join(TEST_DIR, '92.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));

    // Check Tenderly URL
    expect(report.metadata.tenderlyUrl).toBe(
      'https://dashboard.tenderly.co/test_user/test_project/simulator/test-simulation-id-123',
    );
  });

  test('should handle missing simulation gracefully', async () => {
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: TEST_DIR,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      simulationType: 'new',
      chainId: 1,
      // No simulation provided
    });

    // Read the generated JSON report
    const reportPath = join(TEST_DIR, '92.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));

    // Tenderly URL should be undefined when no simulation
    expect(report.metadata.tenderlyUrl).toBeUndefined();

    // But repo fields should still be present
    expect(report.metadata).toBeDefined();
    if (report.metadata.repoCommit) {
      expect(typeof report.metadata.repoCommit).toBe('string');
    }
    if (report.metadata.repoUrl) {
      expect(typeof report.metadata.repoUrl).toBe('string');
    }
  });

  test('should maintain backward compatibility with existing metadata fields', async () => {
    await generateAndSaveReports({
      governorType: 'bravo',
      blocks: mockBlocks,
      proposal: mockProposal,
      checks: mockChecks,
      outputDir: TEST_DIR,
      governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      simulationType: 'new',
      chainId: 1,
      simulation: mockSimulation,
    });

    // Read the generated JSON report
    const reportPath = join(TEST_DIR, '92.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));

    // Check all required existing fields are still present
    expect(report.metadata.proposalId).toBe('92');
    expect(report.metadata.proposer).toBe('0x0000000000000000000000000000000000001234');
    expect(report.metadata.governorAddress).toBe('0x408ED6354d4973f66138C91495F2f2FCbd8724C3');
    expect(report.metadata.simulationBlockNumber).toBeDefined();
    expect(report.metadata.simulationTimestamp).toBeDefined();
    expect(report.metadata.chainId).toBe(1);
    expect(report.metadata.chainName).toBe('Ethereum');
    expect(report.metadata.blockExplorerBaseUrl).toBe('https://etherscan.io');
    expect(report.metadata.simulationType).toBe('new');

    // New fields should also be present
    expect(report.metadata.repoCommit).toBeDefined();
    expect(report.metadata.repoUrl).toBeDefined();
    expect(report.metadata.tenderlyUrl).toBeDefined();
  });
});
