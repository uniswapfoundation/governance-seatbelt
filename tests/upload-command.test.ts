import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpload } from '../scripts/upload';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${key}`);
  }
  return value;
}

describe('bun upload command scaffold', () => {
  it('writes publish metadata log for valid artifacts in validate-only mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-'));
    const artifactPath = join(__dirname, 'fixtures', 'upload', 'simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    const result = await runUpload([
      '--artifact',
      artifactPath,
      '--validate-only',
      '--log',
      logPath,
    ]);

    expect(result).toBe(0);
    expect(existsSync(logPath)).toBe(true);

    const logLines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(logLines.length).toBe(1);

    const parsedLogEntry = JSON.parse(logLines[0]);
    if (!isRecord(parsedLogEntry)) {
      throw new Error('Expected log entry to be an object');
    }

    const publishId = readStringField(parsedLogEntry, 'publish_id');
    const publishedAt = readStringField(parsedLogEntry, 'published_at');
    const artifactHash = readStringField(parsedLogEntry, 'artifact_hash');
    const simulationType = readStringField(parsedLogEntry, 'simulation_type');
    const mode = readStringField(parsedLogEntry, 'mode');

    expect(publishId.length).toBeGreaterThan(0);
    expect(publishedAt.length).toBeGreaterThan(0);
    expect(artifactHash.length).toBe(64);
    expect(simulationType).toBe('proposed');
    expect(mode).toBe('validate-only');
  });

  it('blocks invalid artifacts', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-invalid-'));
    const artifactPath = join(
      __dirname,
      'fixtures',
      'upload',
      'simulation-results.invalid.missing-schema-version.json',
    );
    const logPath = join(tempDir, 'publish-log.jsonl');

    const result = await runUpload([
      '--artifact',
      artifactPath,
      '--validate-only',
      '--log',
      logPath,
    ]);

    expect(result).toBe(1);
    expect(existsSync(logPath)).toBe(false);
  });
});
