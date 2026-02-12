import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type UploadRuntimeOverrides, runUpload } from '../scripts/upload';

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

function readLogEntry(logPath: string): Record<string, unknown> {
  const logLines = readFileSync(logPath, 'utf8').trim().split('\n');
  expect(logLines.length).toBe(1);

  const parsed = JSON.parse(logLines[0]);
  if (!isRecord(parsed)) {
    throw new Error('Expected log entry to be an object');
  }

  return parsed;
}

async function runWithCapturedConsole(
  argv: string[],
  overrides: UploadRuntimeOverrides,
): Promise<{
  code: number;
  logs: string[];
  errors: string[];
}> {
  const logs: string[] = [];
  const errors: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;

  const captureLog: typeof console.log = (...args) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  };

  const captureError: typeof console.error = (...args) => {
    errors.push(args.map((arg) => String(arg)).join(' '));
  };

  console.log = captureLog;
  console.error = captureError;

  try {
    const code = await runUpload(argv, overrides);
    return { code, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function fixturePath(name: string): string {
  return join(__dirname, 'fixtures', 'upload', name);
}

describe('bun upload command', () => {
  it('writes publish metadata log for valid artifacts in validate-only mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
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

    const parsedLogEntry = readLogEntry(logPath);

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
    const artifactPath = fixturePath('simulation-results.invalid.missing-schema-version.json');
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

  it('fails with actionable error when publish env vars are missing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-missing-env-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandCalled = false;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {},
        runCommand: async () => {
          commandCalled = true;
          return {
            exitCode: 0,
            stdout: 'https://unused.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(1);
    expect(commandCalled).toBe(false);
    expect(runResult.errors.join('\n')).toContain('VERCEL_TOKEN');
    expect(runResult.errors.join('\n')).toContain('SEATBELT_VERCEL_TOKEN');
    expect(runResult.errors.join('\n')).toContain('VERCEL_PROJECT_ID');
    expect(runResult.errors.join('\n')).toContain('SEATBELT_VERCEL_PROJECT_ID');
    expect(runResult.errors.join('\n')).toContain('VERCEL_ORG_ID');
    expect(runResult.errors.join('\n')).toContain('SEATBELT_VERCEL_ORG_ID');
    expect(existsSync(logPath)).toBe(true);
  });

  it('uses SEATBELT_VERCEL_* aliases when VERCEL_* vars are absent', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-publish-alias-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandInvocationCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {
          SEATBELT_VERCEL_TOKEN: 'alias_token',
          SEATBELT_VERCEL_PROJECT_ID: 'alias_project',
          SEATBELT_VERCEL_ORG_ID: 'alias_org',
        },
        runCommand: async (command, args, options) => {
          commandInvocationCount += 1;

          expect(command).toBe('vercel');
          expect(args).toEqual(['deploy', '--yes', '--prod', '--token', 'alias_token']);
          expect(options.env.VERCEL_TOKEN).toBe('alias_token');
          expect(options.env.VERCEL_PROJECT_ID).toBe('alias_project');
          expect(options.env.VERCEL_ORG_ID).toBe('alias_org');

          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-upload-alias.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(commandInvocationCount).toBe(1);
  });

  it('prefers VERCEL_* over SEATBELT_VERCEL_* when both are set', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-publish-precedence-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandInvocationCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {
          VERCEL_TOKEN: 'primary_token',
          VERCEL_PROJECT_ID: 'primary_project',
          VERCEL_ORG_ID: 'primary_org',
          SEATBELT_VERCEL_TOKEN: 'alias_token',
          SEATBELT_VERCEL_PROJECT_ID: 'alias_project',
          SEATBELT_VERCEL_ORG_ID: 'alias_org',
        },
        runCommand: async (command, args, options) => {
          commandInvocationCount += 1;

          expect(command).toBe('vercel');
          expect(args).toEqual(['deploy', '--yes', '--prod', '--token', 'primary_token']);
          expect(options.env.VERCEL_TOKEN).toBe('primary_token');
          expect(options.env.VERCEL_PROJECT_ID).toBe('primary_project');
          expect(options.env.VERCEL_ORG_ID).toBe('primary_org');

          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-upload-precedence.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(commandInvocationCount).toBe(1);
  });

  it('runs non-interactive vercel deploy for bun upload --publish', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-publish-success-'));
    const artifactPath = fixturePath('simulation-results.executed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    let commandInvocationCount = 0;

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {
          VERCEL_TOKEN: 'test_token',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_ORG_ID: 'team_456',
        },
        runCommand: async (command, args, options) => {
          commandInvocationCount += 1;

          expect(command).toBe('vercel');
          expect(args).toEqual(['deploy', '--yes', '--prod', '--token', 'test_token']);
          expect(existsSync(join(options.cwd, 'simulation-results.json'))).toBe(true);
          expect(existsSync(join(options.cwd, 'publish-metadata.json'))).toBe(true);
          expect(existsSync(join(options.cwd, '.vercel', 'project.json'))).toBe(true);

          const linkedProjectRaw = readFileSync(
            join(options.cwd, '.vercel', 'project.json'),
            'utf8',
          );
          const linkedProject = JSON.parse(linkedProjectRaw);
          if (!isRecord(linkedProject)) {
            throw new Error('Expected .vercel/project.json to be an object');
          }

          expect(readStringField(linkedProject, 'projectId')).toBe('prj_123');
          expect(readStringField(linkedProject, 'orgId')).toBe('team_456');

          return {
            exitCode: 0,
            stdout: 'Production: https://seatbelt-upload-success.vercel.app',
            stderr: '',
          };
        },
      },
    );

    expect(runResult.code).toBe(0);
    expect(commandInvocationCount).toBe(1);

    const joinedLogs = runResult.logs.join('\n');
    expect(joinedLogs).toContain('Vercel deploy succeeded');
    expect(joinedLogs).toContain(
      'https://seatbelt-upload-success.vercel.app/simulation-results.json',
    );

    expect(existsSync(logPath)).toBe(true);
    const parsedLogEntry = readLogEntry(logPath);
    expect(readStringField(parsedLogEntry, 'mode')).toBe('upload-scaffold');
  });

  it('surfaces vercel deploy failures with CLI output', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-publish-failure-'));
    const artifactPath = fixturePath('simulation-results.proposed.json');
    const logPath = join(tempDir, 'publish-log.jsonl');

    const runResult = await runWithCapturedConsole(
      ['--artifact', artifactPath, '--publish', '--log', logPath],
      {
        env: {
          VERCEL_TOKEN: 'test_token',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_ORG_ID: 'team_456',
        },
        runCommand: async () => ({
          exitCode: 1,
          stdout: 'Error! Build failed',
          stderr: 'Permission denied',
        }),
      },
    );

    expect(runResult.code).toBe(1);
    const joinedErrors = runResult.errors.join('\n');
    expect(joinedErrors).toContain('Vercel deploy failed with exit code 1');
    expect(joinedErrors).toContain('Permission denied');
    expect(joinedErrors).toContain('VERCEL_PROJECT_ID');
    expect(existsSync(logPath)).toBe(true);
  });
});
