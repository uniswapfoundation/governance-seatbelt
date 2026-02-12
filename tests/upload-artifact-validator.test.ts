import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PublishArtifactValidationError,
  validatePublishArtifact,
} from '../utils/publish/artifact-validator';

function readFixture(name: string): unknown {
  const fixturePath = join(__dirname, 'fixtures', 'upload', name);
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

describe('publish artifact validator', () => {
  // --- Happy paths: all 3 simulation contexts ---

  it('accepts new (pre-proposal) context fixture', () => {
    const parsed = validatePublishArtifact(readFixture('simulation-results.new.json'));
    expect(parsed.report.structuredReport.metadata.simulationType).toBe('new');
    expect(parsed.report.structuredReport.metadata.proposalCreatedAtBlockNumber).toBe('unknown');
  });

  it('accepts proposed context fixture', () => {
    const parsed = validatePublishArtifact(readFixture('simulation-results.proposed.json'));
    expect(parsed.report.structuredReport.metadata.simulationType).toBe('proposed');
    expect(parsed.report.structuredReport.metadata.proposalId).toBe('123');
  });

  it('accepts executed context fixture', () => {
    const parsed = validatePublishArtifact(readFixture('simulation-results.executed.json'));
    expect(parsed.report.structuredReport.metadata.simulationType).toBe('executed');
    expect(parsed.report.structuredReport.metadata.proposalExecutedAtBlockNumber).toBe('18100000');
  });

  // --- Guardrail: schema version ---

  it('rejects artifacts missing schemaVersion', () => {
    expect(() =>
      validatePublishArtifact(
        readFixture('simulation-results.invalid.missing-schema-version.json'),
      ),
    ).toThrow(PublishArtifactValidationError);
  });

  // --- Guardrail: executed without execution metadata ---

  it('rejects executed artifact missing proposalExecutedAtBlockNumber', () => {
    try {
      validatePublishArtifact(
        readFixture('simulation-results.invalid.executed-missing-exec-block.json'),
      );
      // should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(PublishArtifactValidationError);
      if (error instanceof PublishArtifactValidationError) {
        const paths = error.issues.map((issue) => issue.path);
        expect(paths).toContain('report.structuredReport.metadata.proposalExecutedAtBlockNumber');
      }
    }
  });

  // --- Guardrail: status mismatch ---

  it('rejects artifacts where report.status differs from structuredReport.status', () => {
    try {
      validatePublishArtifact(readFixture('simulation-results.invalid.mismatched-status.json'));
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(PublishArtifactValidationError);
      if (error instanceof PublishArtifactValidationError) {
        const msgs = error.issues.map((issue) => issue.message);
        expect(msgs.some((m) => m.includes('must match report.status'))).toBe(true);
      }
    }
  });

  // --- Guardrail: multi-entry ---

  it('rejects multi-entry artifacts for publish', () => {
    const proposed = readFixture('simulation-results.proposed.json');

    expect(() => validatePublishArtifact([proposed, proposed])).toThrow(
      PublishArtifactValidationError,
    );
  });

  // --- Guardrail: completely bogus input ---

  it('rejects empty object', () => {
    expect(() => validatePublishArtifact({})).toThrow(PublishArtifactValidationError);
  });

  it('rejects null', () => {
    expect(() => validatePublishArtifact(null)).toThrow(PublishArtifactValidationError);
  });
});
