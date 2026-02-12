import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  PublishArtifactValidationError,
  type PublishableSimulationResult,
  validatePublishArtifact,
} from '../utils/publish/artifact-validator';
import { computeArtifactHash, createPublishMetadata } from '../utils/publish/publish-metadata';

type UploadArgs = {
  artifactPath: string;
  logPath: string;
  publish: boolean;
  validateOnly: boolean;
};

const DEFAULT_ARTIFACT_PATH = 'frontend/public/simulation-results.json';
const DEFAULT_LOG_PATH = '.seatbelt/publish-log.jsonl';

type PublishMode = 'validate-only' | 'upload-scaffold';

type PublishLogEntry = {
  publish_id: string;
  published_at: string;
  artifact_hash: string;
  schema_version: number;
  simulation_type: string;
  proposal_id: string;
  chain_id: number;
  artifact_path: string;
  mode: PublishMode;
};

type CommandRunOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
};

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions,
) => Promise<CommandRunResult>;

export type UploadRuntimeOverrides = {
  env?: Record<string, string | undefined>;
  runCommand?: CommandRunner;
};

type VercelPublishEnv = {
  token: string;
  projectId: string;
  orgId: string;
};

function printHelp() {
  console.log('Seatbelt upload (Phase 1)');
  console.log('');
  console.log('Usage: bun upload [options]');
  console.log('');
  console.log('Options:');
  console.log('  --artifact <path>      Path to simulation-results artifact');
  console.log('  --publish              Publish validated artifact to Vercel');
  console.log('  --validate-only        Validate + log metadata without publish attempt');
  console.log('  --log <path>           Publish metadata log path');
  console.log('  -h, --help             Show this help');
}

function parseUploadArgs(argv: string[]): UploadArgs {
  const parsed: UploadArgs = {
    artifactPath: DEFAULT_ARTIFACT_PATH,
    logPath: DEFAULT_LOG_PATH,
    publish: false,
    validateOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--artifact') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --artifact');
      }
      parsed.artifactPath = value;
      i += 1;
      continue;
    }

    if (arg === '--log') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --log');
      }
      parsed.logPath = value;
      i += 1;
      continue;
    }

    if (arg === '--publish') {
      parsed.publish = true;
      continue;
    }

    if (arg === '--validate-only') {
      parsed.validateOnly = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function appendPublishLog(logPath: string, entry: PublishLogEntry) {
  const fullPath = resolve(logPath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const serialized = `${JSON.stringify(entry)}\n`;
  writeFileSync(fullPath, serialized, { flag: 'a' });
}

function buildLogEntry(
  validated: PublishableSimulationResult,
  artifactPath: string,
  mode: PublishMode,
  artifactHash: string,
): PublishLogEntry {
  const metadata = validated.report.structuredReport.metadata;
  const publishMetadata = createPublishMetadata(artifactHash);

  return {
    ...publishMetadata,
    schema_version: metadata.schemaVersion,
    simulation_type: metadata.simulationType,
    proposal_id: metadata.proposalId,
    chain_id: metadata.chainId,
    artifact_path: resolve(artifactPath),
    mode,
  };
}

function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function readPrimaryOrAliasEnv(
  env: Record<string, string | undefined>,
  primaryName: string,
  aliasName: string,
): string | undefined {
  const primaryValue = readNonEmptyEnv(env, primaryName);
  if (primaryValue) {
    return primaryValue;
  }

  return readNonEmptyEnv(env, aliasName);
}

function formatEnvPair(primaryName: string, aliasName: string): string {
  return `${primaryName} (or ${aliasName})`;
}

function readVercelPublishEnv(env: Record<string, string | undefined>): VercelPublishEnv {
  const token = readPrimaryOrAliasEnv(env, 'VERCEL_TOKEN', 'SEATBELT_VERCEL_TOKEN');
  const projectId = readPrimaryOrAliasEnv(env, 'VERCEL_PROJECT_ID', 'SEATBELT_VERCEL_PROJECT_ID');
  const orgId = readPrimaryOrAliasEnv(env, 'VERCEL_ORG_ID', 'SEATBELT_VERCEL_ORG_ID');

  const missing: string[] = [];
  if (!token) {
    missing.push(formatEnvPair('VERCEL_TOKEN', 'SEATBELT_VERCEL_TOKEN'));
  }
  if (!projectId) {
    missing.push(formatEnvPair('VERCEL_PROJECT_ID', 'SEATBELT_VERCEL_PROJECT_ID'));
  }
  if (!orgId) {
    missing.push(formatEnvPair('VERCEL_ORG_ID', 'SEATBELT_VERCEL_ORG_ID'));
  }

  if (missing.length > 0) {
    throw new Error(
      `Vercel publish is missing required environment variables: ${missing.join(', ')}.\nSet these before running bun upload --publish (VERCEL_* takes precedence when both are set):\n  export VERCEL_TOKEN="<token>"\n  export VERCEL_PROJECT_ID="<project-id>"\n  export VERCEL_ORG_ID="<team-or-user-id>"\n  # Or use SEATBELT_VERCEL_TOKEN / SEATBELT_VERCEL_PROJECT_ID / SEATBELT_VERCEL_ORG_ID`,
    );
  }

  if (!token || !projectId || !orgId) {
    throw new Error('Vercel publish env validation failed unexpectedly.');
  }

  return {
    token,
    projectId,
    orgId,
  };
}

function sanitizeEnvForSpawn(env: Record<string, string | undefined>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: CommandRunOptions,
): Promise<CommandRunResult> {
  const child = Bun.spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    env: sanitizeEnvForSpawn(options.env),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutPromise = child.stdout ? new Response(child.stdout).text() : Promise.resolve('');
  const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve('');

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    stdoutPromise,
    stderrPromise,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

function stripAnsi(input: string): string {
  const escapeChar = String.fromCharCode(27);
  return input.split(escapeChar).join('');
}

function trimTrailingPunctuation(input: string): string {
  return input.replace(/[\])},.;]+$/, '');
}

function extractDeploymentUrl(stdout: string, stderr: string): string | undefined {
  const combined = stripAnsi(`${stdout}\n${stderr}`);
  const matches = combined.match(/https:\/\/[\w./?#[\]@!$&'()*+,;=%:-]+/g);
  if (!matches || matches.length === 0) {
    return undefined;
  }

  const normalized = matches.map((match) => trimTrailingPunctuation(match));
  const vercelUrls = normalized.filter((candidate) => candidate.includes('.vercel.app'));

  if (vercelUrls.length > 0) {
    return vercelUrls[vercelUrls.length - 1];
  }

  return normalized[normalized.length - 1];
}

function isErrorWithCode(value: unknown): value is {
  code: unknown;
} {
  return typeof value === 'object' && value !== null && 'code' in value;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPublishLandingPage(logEntry: PublishLogEntry): string {
  const metadataJson = escapeHtml(JSON.stringify(logEntry, null, 2));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Seatbelt publish artifact</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        margin: 2rem;
        line-height: 1.5;
        background: #0f1117;
        color: #e6edf3;
      }
      a {
        color: #7cc7ff;
      }
      pre {
        padding: 1rem;
        border-radius: 0.5rem;
        background: #161b22;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <h1>Seatbelt simulation publish</h1>
    <p>This deployment contains a validated simulation artifact.</p>
    <ul>
      <li><a href="./simulation-results.json">simulation-results.json</a></li>
      <li><a href="./publish-metadata.json">publish-metadata.json</a></li>
    </ul>
    <h2>Publish metadata</h2>
    <pre>${metadataJson}</pre>
  </body>
</html>
`;
}

function prepareDeployDirectory(
  rawArtifact: string,
  logEntry: PublishLogEntry,
  vercelEnv: VercelPublishEnv,
): string {
  const deployDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-'));
  const vercelDir = join(deployDir, '.vercel');

  mkdirSync(vercelDir, { recursive: true });

  writeFileSync(
    join(vercelDir, 'project.json'),
    JSON.stringify({
      projectId: vercelEnv.projectId,
      orgId: vercelEnv.orgId,
    }),
  );

  writeFileSync(join(deployDir, 'simulation-results.json'), rawArtifact);
  writeFileSync(join(deployDir, 'publish-metadata.json'), JSON.stringify(logEntry, null, 2));
  writeFileSync(join(deployDir, 'index.html'), buildPublishLandingPage(logEntry));

  return deployDir;
}

function buildCommandOutputSummary(stdout: string, stderr: string): string {
  const chunks = [stdout.trim(), stderr.trim()].filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) {
    return 'No Vercel CLI output was captured.';
  }

  return chunks.join('\n');
}

function appendPathToUrl(baseUrl: string, relativePath: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${relativePath}`;
  }

  return `${baseUrl}/${relativePath}`;
}

async function runVercelPublish(
  artifactRaw: string,
  logEntry: PublishLogEntry,
  runtimeEnv: Record<string, string | undefined>,
  runCommand: CommandRunner,
): Promise<void> {
  const vercelEnv = readVercelPublishEnv(runtimeEnv);
  const deployDir = prepareDeployDirectory(artifactRaw, logEntry, vercelEnv);

  try {
    const deployResult = await runCommand(
      'vercel',
      ['deploy', '--yes', '--prod', '--token', vercelEnv.token],
      {
        cwd: deployDir,
        env: {
          ...runtimeEnv,
          VERCEL_TOKEN: vercelEnv.token,
          VERCEL_PROJECT_ID: vercelEnv.projectId,
          VERCEL_ORG_ID: vercelEnv.orgId,
        },
      },
    );

    if (deployResult.exitCode !== 0) {
      throw new Error(
        `Vercel deploy failed with exit code ${deployResult.exitCode}.\n${buildCommandOutputSummary(deployResult.stdout, deployResult.stderr)}\nVerify VERCEL_TOKEN permissions and confirm VERCEL_PROJECT_ID / VERCEL_ORG_ID are correct.`,
      );
    }

    const deploymentUrl = extractDeploymentUrl(deployResult.stdout, deployResult.stderr);
    if (!deploymentUrl) {
      throw new Error(
        `Vercel deploy succeeded but no deployment URL was found in CLI output.\n${buildCommandOutputSummary(deployResult.stdout, deployResult.stderr)}`,
      );
    }

    console.log('[upload] Vercel deploy succeeded.');
    console.log(`[upload] Deployment URL: ${deploymentUrl}`);
    console.log(
      `[upload] Artifact URL: ${appendPathToUrl(deploymentUrl, 'simulation-results.json')}`,
    );
    console.log(
      `[upload] Metadata URL: ${appendPathToUrl(deploymentUrl, 'publish-metadata.json')}`,
    );
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      throw new Error(
        'Vercel CLI was not found. Install it before publishing: bun add -g vercel (or npm i -g vercel).',
      );
    }

    throw error;
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
}

export async function runUpload(
  argv: string[],
  overrides: UploadRuntimeOverrides = {},
): Promise<number> {
  const runtimeEnv = overrides.env ?? process.env;
  const runCommand = overrides.runCommand ?? defaultRunCommand;

  try {
    const args = parseUploadArgs(argv);
    const artifactPath = resolve(args.artifactPath);

    if (!existsSync(artifactPath)) {
      throw new Error(`Artifact not found at ${artifactPath}`);
    }

    const rawArtifact = readFileSync(artifactPath, 'utf8');
    const parsedArtifact: unknown = JSON.parse(rawArtifact);
    const validated = validatePublishArtifact(parsedArtifact);
    const artifactHash = computeArtifactHash(rawArtifact);

    const mode: PublishMode = args.publish ? 'upload-scaffold' : 'validate-only';
    const logEntry = buildLogEntry(validated, artifactPath, mode, artifactHash);
    appendPublishLog(args.logPath, logEntry);

    console.log('[upload] Artifact validation passed.');
    console.log(`[upload] Artifact hash: ${artifactHash}`);
    console.log(`[upload] Publish metadata logged at: ${resolve(args.logPath)}`);

    if (args.validateOnly || !args.publish) {
      console.log('[upload] Validation-only mode complete.');
      console.log(JSON.stringify(logEntry, null, 2));
      return 0;
    }

    await runVercelPublish(rawArtifact, logEntry, runtimeEnv, runCommand);
    return 0;
  } catch (error) {
    if (error instanceof PublishArtifactValidationError) {
      console.error(error.message);
      return 1;
    }

    if (error instanceof Error) {
      console.error(`[upload] ${error.message}`);
      return 1;
    }

    console.error('[upload] Unknown upload error');
    return 1;
  }
}

if (import.meta.main) {
  const code = await runUpload(process.argv.slice(2));
  process.exit(code);
}
