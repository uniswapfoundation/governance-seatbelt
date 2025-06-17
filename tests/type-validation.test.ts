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
        blockNumber: '18200000',
        timestamp: '1700000000',
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432', // This should be valid
      },
    };

    // These should pass once types are updated
    expect(mockReport.metadata.governorAddress).toBe('0x9876543210fedcba9876543210fedcba98765432');
    expect(mockReport.metadata.proposer).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(mockReport.metadata.blockNumber).toBe('18200000');
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
        blockNumber: '18200000',
        timestamp: '1700000000',
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        executor: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // This should be valid
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
        blockNumber: '18200000',
        timestamp: '1700000000',
        proposalId: '123',
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        // executor is optional for non-executed proposals
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
      blockNumber: '18200000',
      timestamp: '1700000000',
      proposalId: '123',
      proposer: '0x1234567890abcdef1234567890abcdef12345678',
      governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
    };

    // All required fields should be strings or addresses
    expect(typeof validMetadata.blockNumber).toBe('string');
    expect(typeof validMetadata.timestamp).toBe('string');
    expect(typeof validMetadata.proposalId).toBe('string');
    expect(typeof validMetadata.proposer).toBe('string');
    expect(typeof validMetadata.governorAddress).toBe('string');

    // Validate address format (basic check)
    expect(validMetadata.proposer).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(validMetadata.governorAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
