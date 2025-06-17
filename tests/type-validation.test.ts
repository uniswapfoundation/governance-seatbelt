import { describe, expect, test } from 'bun:test';
import type { StructuredSimulationReport } from '../types';

describe('Type Validation for Metadata Updates', () => {
  test('StructuredSimulationReport metadata should include governorAddress', () => {
    // This test will fail until we update the type definition
    const mockReport: StructuredSimulationReport = {
      title: 'Test Proposal',
      proposalText: 'Test proposal description',
      status: 'success',
      summary: 'Test summary',
      checks: [],
      stateChanges: [],
      events: [],
      metadata: {
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        simulationBlockNumber: '18200000',
        simulationTimestamp: '1700000000',
        proposalCreatedAtBlockNumber: '17800000',
        proposalCreatedAtTimestamp: '1695000000',
      },
    };

    // These should pass once types are updated
    expect(mockReport.metadata.governorAddress).toBe('0x9876543210fedcba9876543210fedcba98765432');
    expect(mockReport.metadata.proposer).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(mockReport.metadata.simulationBlockNumber).toBe('18200000');
  });

  test('StructuredSimulationReport metadata should optionally include executor', () => {
    // Test with executor field
    const mockReportWithExecutor: StructuredSimulationReport = {
      title: 'Test Proposal',
      proposalText: 'Test proposal description',
      status: 'success',
      summary: 'Test summary',
      checks: [],
      stateChanges: [],
      events: [],
      metadata: {
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        executor: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        simulationBlockNumber: '18200000',
        simulationTimestamp: '1700000000',
        proposalCreatedAtBlockNumber: '17800000',
        proposalCreatedAtTimestamp: '1695000000',
        proposalExecutedAtBlockNumber: '17850000',
        proposalExecutedAtTimestamp: '1696000000',
      },
    };

    expect(mockReportWithExecutor.metadata.executor).toBe(
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    expect(mockReportWithExecutor.metadata.proposer).toBe(
      '0x1234567890abcdef1234567890abcdef12345678',
    );

    // Test without executor field (should also be valid for non-executed proposals)
    const mockReportWithoutExecutor: StructuredSimulationReport = {
      title: 'Test Proposal',
      proposalText: 'Test proposal description',
      status: 'success',
      summary: 'Test summary',
      checks: [],
      stateChanges: [],
      events: [],
      metadata: {
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        simulationBlockNumber: '18200000',
        simulationTimestamp: '1700000000',
        proposalCreatedAtBlockNumber: '17800000',
        proposalCreatedAtTimestamp: '1695000000',
        // executor and execution timing are optional for non-executed proposals
      },
    };

    expect(mockReportWithoutExecutor.metadata.executor).toBeUndefined();
    expect(mockReportWithoutExecutor.metadata.proposer).toBe(
      '0x1234567890abcdef1234567890abcdef12345678',
    );
  });

  test('should validate required vs optional metadata fields', () => {
    // Test that all required fields are present
    const validMetadata = {
      proposalId: '123',
      proposer: '0x1234567890abcdef1234567890abcdef12345678',
      governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
      simulationBlockNumber: '18200000',
      simulationTimestamp: '1700000000',
      proposalCreatedAtBlockNumber: '17800000',
      proposalCreatedAtTimestamp: '1695000000',
    };

    // All required fields should be strings or addresses
    expect(typeof validMetadata.proposalId).toBe('string');
    expect(typeof validMetadata.proposer).toBe('string');
    expect(typeof validMetadata.governorAddress).toBe('string');
    expect(typeof validMetadata.simulationBlockNumber).toBe('string');
    expect(typeof validMetadata.simulationTimestamp).toBe('string');
    expect(typeof validMetadata.proposalCreatedAtBlockNumber).toBe('string');
    expect(typeof validMetadata.proposalCreatedAtTimestamp).toBe('string');

    // Validate address format (basic check)
    expect(validMetadata.proposer).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(validMetadata.governorAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
