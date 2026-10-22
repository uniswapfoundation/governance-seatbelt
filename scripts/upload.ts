import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  buildCanonicalShareUrl,
  buildPrettyShareUrl,
  buildViewerUrl,
  normalizePublishId,
} from '../frontend/src/lib/share-link';
import { readNonEmptyEnv, readPrimaryOrAliasEnv } from '../utils/env.js';
import {
  PublishArtifactValidationError,
  type PublishableSimulationResult,
  validatePublishArtifact,
} from '../utils/publish/artifact-validator';
import { computeArtifactHash, createPublishMetadata } from '../utils/publish/publish-metadata';
import { buildRelayPublishArtifactRaw } from '../utils/publish/relay-publish-artifact';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadArgs = {
  artifactPath: string;
  logPath: string;
  publish: boolean;
  validateOnly: boolean;
  publishProvider: PublishProviderSelection;
  relayUrl?: string;
};

const DEFAULT_ARTIFACT_PATH = 'frontend/public/simulation-results.json';
const DEFAULT_LOG_PATH = '.seatbelt/publish-log.jsonl';
const FRONTEND_SOURCE_DIR = resolve(import.meta.dir, '..', 'frontend');
const DEFAULT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';
const DEFAULT_RELAY_TIMEOUT_MS = 120_000;
const DEFAULT_RELAY_MAX_BYTES = 25 * 1024 * 1024;

const DEPLOY_BUNDLE_EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.vercel',
  '.turbo',
  '.cache',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'out',
]);

const DEPLOY_BUNDLE_EXCLUDED_FILES = new Set(['.gitignore', '.vercelignore']);

type PublishMode = 'validate-only' | 'managed-relay' | 'byo-vercel';
type PublishProviderSelection = 'managed' | 'vercel';

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

type ManagedRelayResponse = {
  deploymentUrl: string;
  artifactUrl?: string;
  metadataUrl?: string;
  viewerUrl?: string;
  publishId?: string;
  publishIdResolvable?: boolean;
  idempotencyKey?: string;
};

type ManagedRelayRunner = (input: {
  endpointUrl: string;
  artifactRaw: string;
  publishLogEntry: PublishLogEntry;
  timeoutMs: number;
  maxPayloadBytes: number;
}) => Promise<ManagedRelayResponse>;

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
  frontendSourceDir?: string;
  runManagedRelay?: ManagedRelayRunner;
};

type VercelPublishEnv = {
  token: string;
  projectId: string;
  orgId: string;
};

// ---------------------------------------------------------------------------
// Help + argument parsing
// ---------------------------------------------------------------------------

function printHelp() {
  console.log('Seatbelt upload');
  console.log('');
  console.log('Usage: bun upload [options]');
  console.log('');
  console.log('Options:');
  console.log('  --artifact <path>      Path to simulation-results artifact');
  console.log('  --publish              Publish validated artifact via managed relay');
  console.log('  --validate-only        Validate + log metadata without publish attempt');
  console.log('  --log <path>           Publish metadata log path');
  console.log('  -h, --help             Show this help');
  console.log('');
  console.log('Advanced (break-glass):');
  console.log('  --publish-provider vercel   Use BYO Vercel deploy instead of managed relay');
  console.log('  --relay-url <url>           Override managed relay endpoint');
}

function parseUploadArgs(argv: string[]): UploadArgs {
  const parsed: UploadArgs = {
    artifactPath: DEFAULT_ARTIFACT_PATH,
    logPath: DEFAULT_LOG_PATH,
    publish: false,
    validateOnly: false,
    publishProvider: 'managed',
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

    if (arg === '--publish-provider') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --publish-provider');
      }

      if (value !== 'managed' && value !== 'vercel') {
        throw new Error('Invalid value for --publish-provider (expected managed or vercel)');
      }

      parsed.publishProvider = value;
      i += 1;
      continue;
    }

    if (arg === '--relay-url') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --relay-url');
      }

      parsed.relayUrl = value;
      i += 1;
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

// ---------------------------------------------------------------------------
// Common utilities
// ---------------------------------------------------------------------------

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

function appendPathToUrl(baseUrl: string, relativePath: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${relativePath}`;
  }

  return `${baseUrl}/${relativePath}`;
}

function readPositiveIntegerEnv(
  env: Record<string, string | undefined>,
  name: string,
): number | undefined {
  const value = readNonEmptyEnv(env, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when set (received: ${value})`);
  }

  return Math.floor(parsed);
}

// ---------------------------------------------------------------------------
// Managed relay publish (default path)
// ---------------------------------------------------------------------------

function readRelayUrl(args: UploadArgs, runtimeEnv: Record<string, string | undefined>): string {
  const fromArg = args.relayUrl?.trim();
  if (fromArg && fromArg.length > 0) {
    return fromArg;
  }

  const fromEnv = readNonEmptyEnv(runtimeEnv, 'SEATBELT_RELAY_URL');
  if (fromEnv) {
    return fromEnv;
  }

  return DEFAULT_RELAY_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') {
    return value;
  }

  return undefined;
}

function parseRelayResponse(value: unknown): ManagedRelayResponse {
  if (!isRecord(value)) {
    throw new Error('Managed relay response must be a JSON object.');
  }

  const deploymentUrl = readOptionalString(value, 'deploymentUrl');
  if (!deploymentUrl) {
    throw new Error('Managed relay response is missing deploymentUrl.');
  }

  return {
    deploymentUrl,
    artifactUrl: readOptionalString(value, 'artifactUrl'),
    metadataUrl: readOptionalString(value, 'metadataUrl'),
    viewerUrl: readOptionalString(value, 'viewerUrl'),
    publishId: readOptionalString(value, 'publishId'),
    publishIdResolvable: value.publishIdResolvable === true,
    idempotencyKey: readOptionalString(value, 'idempotencyKey'),
  };
}

function toJsonSnippet(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '(empty response body)';
  }

  if (trimmed.length <= 500) {
    return trimmed;
  }

  return `${trimmed.slice(0, 500)}…`;
}

function extractErrorMessageFromJson(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const message = readOptionalString(value, 'message');
  if (message) {
    return message;
  }

  return readOptionalString(value, 'error');
}

async function defaultManagedRelayRunner(input: {
  endpointUrl: string;
  artifactRaw: string;
  publishLogEntry: PublishLogEntry;
  timeoutMs: number;
  maxPayloadBytes: number;
}): Promise<ManagedRelayResponse> {
  const payload = JSON.stringify({
    artifactRaw: input.artifactRaw,
    publishMetadata: input.publishLogEntry,
  });

  const payloadBytes = Buffer.byteLength(payload, 'utf8');

  if (payloadBytes > input.maxPayloadBytes) {
    throw new Error(
      `Publish payload is too large (${payloadBytes} bytes > ${input.maxPayloadBytes} bytes). Reduce artifact size or use --publish-provider vercel for BYO deployment.`,
    );
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);

  let responseText = '';

  try {
    const response = await fetch(input.endpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-seatbelt-client': 'governance-seatbelt-cli',
        'idempotency-key': input.publishLogEntry.artifact_hash,
      },
      body: payload,
      signal: controller.signal,
    });

    responseText = await response.text();

    if (!response.ok) {
      const parsedBody = (() => {
        try {
          return JSON.parse(responseText) as unknown;
        } catch {
          return undefined;
        }
      })();

      const serviceMessage = extractErrorMessageFromJson(parsedBody);
      const suffix = serviceMessage ? ` ${serviceMessage}` : ` ${toJsonSnippet(responseText)}`;

      if (response.status === 429) {
        throw new Error(`Publish was rate-limited (HTTP 429). Please wait and retry.${suffix}`);
      }

      if (response.status === 413) {
        throw new Error(`Publish rejected: payload too large (HTTP 413).${suffix}`);
      }

      throw new Error(`Publish failed with HTTP ${response.status}.${suffix}`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText) as unknown;
    } catch {
      throw new Error(`Publish returned non-JSON success response: ${toJsonSnippet(responseText)}`);
    }

    return parseRelayResponse(parsedJson);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Publish timed out after ${input.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runManagedRelayPublish(
  rawArtifact: string,
  logEntry: PublishLogEntry,
  runtimeEnv: Record<string, string | undefined>,
  args: UploadArgs,
  relayRunner: ManagedRelayRunner,
): Promise<void> {
  const relayUrl = readRelayUrl(args, runtimeEnv);
  const endpointUrl = `${relayUrl.replace(/\/+$/, '')}/api/v1/publishes`;
  const timeoutMs =
    readPositiveIntegerEnv(runtimeEnv, 'SEATBELT_RELAY_TIMEOUT_MS') ?? DEFAULT_RELAY_TIMEOUT_MS;
  const maxPayloadBytes =
    readPositiveIntegerEnv(runtimeEnv, 'SEATBELT_RELAY_MAX_BYTES') ?? DEFAULT_RELAY_MAX_BYTES;

  const result = await relayRunner({
    endpointUrl,
    artifactRaw: rawArtifact,
    publishLogEntry: logEntry,
    timeoutMs,
    maxPayloadBytes,
  });

  console.log('[upload] Publish succeeded.');
  const artifactUrl =
    result.artifactUrl ?? appendPathToUrl(result.deploymentUrl, 'simulation-results.json');
  if (result.viewerUrl) {
    const viewerUrl = buildViewerUrl(result.viewerUrl);
    const publishId = result.publishIdResolvable ? normalizePublishId(result.publishId) : null;
    const shareUrl = publishId
      ? buildPrettyShareUrl(viewerUrl, publishId)
      : buildCanonicalShareUrl(viewerUrl, artifactUrl);
    console.log(`[upload] Share URL: ${shareUrl}`);
  } else {
    console.log('[upload] Share URL unavailable: configure SEATBELT_VIEWER_URL on the relay.');
  }
  console.log(`[upload] Deployment URL: ${result.deploymentUrl}`);
  console.log(`[upload] Artifact URL: ${artifactUrl}`);

  if (result.metadataUrl) {
    console.log(`[upload] Metadata URL: ${result.metadataUrl}`);
  } else {
    console.log(
      `[upload] Metadata URL: ${appendPathToUrl(result.deploymentUrl, 'publish-metadata.json')}`,
    );
  }

  if (result.publishId) {
    console.log(`[upload] Publish ID: ${result.publishId}`);
  }
}

// ---------------------------------------------------------------------------
// BYO Vercel publish (break-glass fallback, --publish-provider vercel)
// ---------------------------------------------------------------------------

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
      `BYO Vercel publish is missing required environment variables: ${missing.join(', ')}.\n  export VERCEL_TOKEN="<token>"\n  export VERCEL_PROJECT_ID="<project-id>"\n  export VERCEL_ORG_ID="<team-or-user-id>"`,
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

function shouldExcludeFromDeployBundle(relativePath: string): boolean {
  if (relativePath.length === 0) {
    return false;
  }

  const segments = relativePath.split(/[/\\]/).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }

  if (segments.some((segment) => DEPLOY_BUNDLE_EXCLUDED_DIRS.has(segment))) {
    return true;
  }

  const fileName = segments[segments.length - 1];
  return DEPLOY_BUNDLE_EXCLUDED_FILES.has(fileName);
}

function assertFrontendPublishBundleExists(frontendSourceDir: string) {
  const requiredEntries = [
    join(frontendSourceDir, 'package.json'),
    join(frontendSourceDir, 'src', 'app', 'page.tsx'),
    join(frontendSourceDir, 'public'),
  ];

  const missing = requiredEntries.filter((entry) => !existsSync(entry));
  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Frontend publish bundle is incomplete. Missing required paths: ${missing.join(', ')}`,
  );
}

function copyFrontendPublishBundle(frontendSourceDir: string, deployDir: string) {
  cpSync(frontendSourceDir, deployDir, {
    recursive: true,
    filter: (sourcePath) => {
      if (sourcePath === frontendSourceDir) {
        return true;
      }

      const relativePath = relative(frontendSourceDir, sourcePath);
      return !shouldExcludeFromDeployBundle(relativePath);
    },
  });
}

function prepareDeployDirectory(
  rawArtifact: string,
  logEntry: PublishLogEntry,
  vercelEnv: VercelPublishEnv,
  frontendSourceDir: string,
): string {
  assertFrontendPublishBundleExists(frontendSourceDir);

  const deployDir = mkdtempSync(join(tmpdir(), 'seatbelt-upload-'));
  const vercelDir = join(deployDir, '.vercel');
  const publicDir = join(deployDir, 'public');

  copyFrontendPublishBundle(frontendSourceDir, deployDir);
  mkdirSync(vercelDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });

  writeFileSync(
    join(vercelDir, 'project.json'),
    JSON.stringify({
      projectId: vercelEnv.projectId,
      orgId: vercelEnv.orgId,
    }),
  );

  writeFileSync(join(publicDir, 'simulation-results.json'), rawArtifact);
  writeFileSync(join(publicDir, 'publish-metadata.json'), JSON.stringify(logEntry, null, 2));

  return deployDir;
}

function buildCommandOutputSummary(stdout: string, stderr: string): string {
  const chunks = [stdout.trim(), stderr.trim()].filter((chunk) => chunk.length > 0);
  if (chunks.length === 0) {
    return 'No Vercel CLI output was captured.';
  }

  return chunks.join('\n');
}

async function runVercelPublish(
  artifactRaw: string,
  logEntry: PublishLogEntry,
  runtimeEnv: Record<string, string | undefined>,
  runCommand: CommandRunner,
  frontendSourceDir: string,
): Promise<void> {
  const vercelEnv = readVercelPublishEnv(runtimeEnv);
  const deployDir = prepareDeployDirectory(artifactRaw, logEntry, vercelEnv, frontendSourceDir);

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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runUpload(
  argv: string[],
  overrides: UploadRuntimeOverrides = {},
): Promise<number> {
  const runtimeEnv = overrides.env ?? process.env;
  const runCommand = overrides.runCommand ?? defaultRunCommand;
  const frontendSourceDir = overrides.frontendSourceDir ?? FRONTEND_SOURCE_DIR;
  const relayRunner = overrides.runManagedRelay ?? defaultManagedRelayRunner;

  try {
    const args = parseUploadArgs(argv);
    const artifactPath = resolve(args.artifactPath);

    if (!existsSync(artifactPath)) {
      throw new Error(`Artifact not found at ${artifactPath}`);
    }

    const rawArtifact = readFileSync(artifactPath, 'utf8');
    const parsedArtifact: unknown = JSON.parse(rawArtifact);
    const validated = validatePublishArtifact(parsedArtifact);
    const mode: PublishMode = !args.publish
      ? 'validate-only'
      : args.publishProvider === 'vercel'
        ? 'byo-vercel'
        : 'managed-relay';
    const managedRelayArtifactRaw =
      mode === 'managed-relay' ? buildRelayPublishArtifactRaw(validated) : undefined;
    const artifactHash = computeArtifactHash(managedRelayArtifactRaw ?? rawArtifact);

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

    if (args.publishProvider === 'vercel') {
      console.log('[upload] Publish provider: BYO Vercel (break-glass).');
      await runVercelPublish(rawArtifact, logEntry, runtimeEnv, runCommand, frontendSourceDir);
      return 0;
    }

    console.log('[upload] Publish provider: managed relay (default).');
    await runManagedRelayPublish(
      managedRelayArtifactRaw ?? rawArtifact,
      logEntry,
      runtimeEnv,
      args,
      relayRunner,
    );
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
