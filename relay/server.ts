import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  PublishArtifactValidationError,
  type PublishableSimulationResult,
  validatePublishArtifact,
} from '../utils/publish/artifact-validator.js';
import { computeArtifactHash, createPublishMetadata } from '../utils/publish/publish-metadata.js';

type OpenJsonObject = Record<string, unknown>;

type RelayPublishLogEntry = {
  publish_id: string;
  published_at: string;
  artifact_hash: string;
  schema_version: number;
  simulation_type: string;
  proposal_id: string;
  chain_id: number;
  idempotency_key: string;
  relay_version: string;
  source_publish_id?: string;
  source_published_at?: string;
  provenance?: OpenJsonObject;
};

type RelaySuccessResponse = {
  publishId: string;
  idempotencyKey: string;
  artifactHash: string;
  deploymentUrl: string;
  artifactUrl: string;
  metadataUrl: string;
};

type RelayPublisherResult = {
  deploymentUrl: string;
  artifactUrl: string;
  metadataUrl: string;
};

type RelayExecutionResult = {
  status: number;
  body: OpenJsonObject;
};

type CompletedIdempotencyRecord = {
  artifactHash: string;
  result: RelayExecutionResult;
};

type InFlightIdempotencyRecord = {
  artifactHash: string;
  promise: Promise<RelayExecutionResult>;
};

type RateLimitBucket = {
  count: number;
  windowStartMs: number;
};

type CommandRunOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
};

type CommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions,
) => Promise<CommandRunResult>;

type RelayDependencies = {
  publisher: (input: {
    artifactRaw: string;
    publishLogEntry: RelayPublishLogEntry;
    env: Record<string, string | undefined>;
    deployTimeoutMs: number;
  }) => Promise<RelayPublisherResult>;
  runCommand: CommandRunner;
  nowMs: () => number;
};

export type RelayConfig = {
  relayVersion: string;
  maxBodyBytes: number;
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  deployTimeoutMs: number;
  port: number;
};

type RelayServerOptions = {
  env?: Record<string, string | undefined>;
  config?: Partial<RelayConfig>;
  dependencies?: Partial<RelayDependencies>;
};

const publishRequestSchema = z
  .object({
    artifact: z.unknown().optional(),
    artifactRaw: z.string().optional(),
    publishMetadata: z.object({}).passthrough().optional(),
    provenance: z.object({}).passthrough().optional(),
  })
  .superRefine((value, ctx) => {
    if (typeof value.artifactRaw === 'string' || typeof value.artifact !== 'undefined') {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['artifact'],
      message: 'artifact or artifactRaw is required',
    });
  });

type PublishRequestPayload = z.infer<typeof publishRequestSchema>;

type VercelPublishEnv = {
  token: string;
  projectId: string;
  orgId: string;
};

const DEFAULT_DEPLOY_TIMEOUT_MS = 180_000;

class RelayPublishTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, details: string) {
    super(`Publish timed out after ${timeoutMs}ms. ${details}`);
    this.name = 'RelayPublishTimeoutError';
    this.timeoutMs = timeoutMs;
  }
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

function readBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return defaultValue;
}

function readPositiveInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const value = readNonEmptyEnv(env, name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when set (received: ${value})`);
  }

  return Math.floor(parsed);
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

  const completionPromise = Promise.all([child.exited, stdoutPromise, stderrPromise]).then(
    ([exitCode, stdout, stderr]) => ({
      exitCode,
      stdout,
      stderr,
      timedOut: false,
    }),
  );

  if (typeof options.timeoutMs !== 'number') {
    return completionPromise;
  }

  const timeoutMs = options.timeoutMs;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<CommandRunResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      child.kill();

      Promise.all([stdoutPromise, stderrPromise]).then(([stdout, stderr]) => {
        resolve({
          exitCode: -1,
          stdout,
          stderr,
          timedOut: true,
        });
      });
    }, timeoutMs);
  });

  const result = await Promise.race([completionPromise, timeoutPromise]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  return result;
}

function formatEnvPair(primaryName: string, aliasName: string): string {
  return `${primaryName} (or ${aliasName})`;
}

function readManagedVercelEnv(env: Record<string, string | undefined>): VercelPublishEnv {
  const token = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN');
  const projectId = readPrimaryOrAliasEnv(
    env,
    'SEATBELT_RELAY_VERCEL_PROJECT_ID',
    'VERCEL_PROJECT_ID',
  );
  const orgId = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID');

  const missing: string[] = [];

  if (!token) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN'));
  }

  if (!projectId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_PROJECT_ID', 'VERCEL_PROJECT_ID'));
  }

  if (!orgId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID'));
  }

  if (missing.length > 0) {
    throw new Error(
      `Relay publish is missing required environment variables: ${missing.join(', ')}.`,
    );
  }

  if (!token || !projectId || !orgId) {
    throw new Error('Relay Vercel env validation failed unexpectedly.');
  }

  return {
    token,
    projectId,
    orgId,
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

function isErrorWithCode(value: unknown): value is { code: unknown } {
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

function buildPublishLandingPage(logEntry: RelayPublishLogEntry): string {
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
  artifactRaw: string,
  publishLogEntry: RelayPublishLogEntry,
  vercelEnv: VercelPublishEnv,
): string {
  const deployDir = mkdtempSync(join(tmpdir(), 'seatbelt-relay-publish-'));
  const vercelDir = join(deployDir, '.vercel');

  mkdirSync(vercelDir, { recursive: true });

  writeFileSync(
    join(vercelDir, 'project.json'),
    JSON.stringify({
      projectId: vercelEnv.projectId,
      orgId: vercelEnv.orgId,
    }),
  );

  writeFileSync(join(deployDir, 'simulation-results.json'), artifactRaw);
  writeFileSync(join(deployDir, 'publish-metadata.json'), JSON.stringify(publishLogEntry, null, 2));
  writeFileSync(join(deployDir, 'index.html'), buildPublishLandingPage(publishLogEntry));
  // Force static-file deployment even if the target Vercel project has a framework preset.
  writeFileSync(
    join(deployDir, 'vercel.json'),
    `${JSON.stringify({ framework: null }, null, 2)}\n`,
  );

  return deployDir;
}

async function defaultRelayPublisher(input: {
  artifactRaw: string;
  publishLogEntry: RelayPublishLogEntry;
  env: Record<string, string | undefined>;
  runCommand: CommandRunner;
  deployTimeoutMs: number;
}): Promise<RelayPublisherResult> {
  const vercelEnv = readManagedVercelEnv(input.env);
  const deployDir = prepareDeployDirectory(input.artifactRaw, input.publishLogEntry, vercelEnv);

  try {
    const deployResult = await input.runCommand(
      'vercel',
      ['deploy', '--yes', '--prod', '--token', vercelEnv.token],
      {
        cwd: deployDir,
        timeoutMs: input.deployTimeoutMs,
        env: {
          ...input.env,
          VERCEL_TOKEN: vercelEnv.token,
          VERCEL_PROJECT_ID: vercelEnv.projectId,
          VERCEL_ORG_ID: vercelEnv.orgId,
        },
      },
    );

    if (deployResult.timedOut) {
      throw new RelayPublishTimeoutError(
        input.deployTimeoutMs,
        buildCommandOutputSummary(deployResult.stdout, deployResult.stderr),
      );
    }

    if (deployResult.exitCode !== 0) {
      throw new Error(
        `Vercel deploy failed with exit code ${deployResult.exitCode}.\n${buildCommandOutputSummary(deployResult.stdout, deployResult.stderr)}`,
      );
    }

    const deploymentUrl = extractDeploymentUrl(deployResult.stdout, deployResult.stderr);

    if (!deploymentUrl) {
      throw new Error(
        `Vercel deploy succeeded but no deployment URL was found in CLI output.\n${buildCommandOutputSummary(deployResult.stdout, deployResult.stderr)}`,
      );
    }

    return {
      deploymentUrl,
      artifactUrl: appendPathToUrl(deploymentUrl, 'simulation-results.json'),
      metadataUrl: appendPathToUrl(deploymentUrl, 'publish-metadata.json'),
    };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      throw new Error(
        'Vercel CLI was not found. Install it before running relay publish: bun add -g vercel (or npm i -g vercel).',
      );
    }

    throw error;
  } finally {
    rmSync(deployDir, { recursive: true, force: true });
  }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return undefined;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, pathname.length - 1);
  }

  return pathname;
}

function createJsonResponse(
  status: number,
  body: OpenJsonObject,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function extractClientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstEntry = forwarded.split(',')[0]?.trim();
    if (firstEntry && firstEntry.length > 0) {
      return firstEntry;
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return 'unknown';
}

function ensureRateLimitAllowance(input: {
  key: string;
  nowMs: number;
  config: RelayConfig;
  buckets: Map<string, RateLimitBucket>;
}): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (!input.config.rateLimitEnabled) {
    return { ok: true };
  }

  const bucket = input.buckets.get(input.key);
  if (!bucket) {
    input.buckets.set(input.key, {
      count: 1,
      windowStartMs: input.nowMs,
    });
    return { ok: true };
  }

  const elapsedMs = input.nowMs - bucket.windowStartMs;

  if (elapsedMs >= input.config.rateLimitWindowMs) {
    input.buckets.set(input.key, {
      count: 1,
      windowStartMs: input.nowMs,
    });
    return { ok: true };
  }

  if (bucket.count >= input.config.rateLimitMaxRequests) {
    const retryAfterMs = Math.max(0, input.config.rateLimitWindowMs - elapsedMs);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      ok: false,
      retryAfterSeconds,
    };
  }

  bucket.count += 1;
  input.buckets.set(input.key, bucket);
  return { ok: true };
}

function maybePruneRateLimitBuckets(
  buckets: Map<string, RateLimitBucket>,
  nowMs: number,
  windowMs: number,
): void {
  // TODO(phase1c): move rate limiting + idempotency state to a shared store for multi-instance relay.
  if (buckets.size <= 10_000) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (nowMs - bucket.windowStartMs > windowMs * 2) {
      buckets.delete(key);
    }
  }
}

async function readRequestBody(request: Request, maxBodyBytes: number): Promise<string> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const readResult = await reader.read();
      if (readResult.done) {
        break;
      }

      if (!readResult.value) {
        continue;
      }

      totalBytes += readResult.value.byteLength;
      if (totalBytes > maxBodyBytes) {
        throw new Error('PAYLOAD_TOO_LARGE');
      }

      chunks.push(readResult.value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let writeOffset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function parsePublishPayload(rawBody: string): PublishRequestPayload {
  let jsonValue: unknown;

  try {
    jsonValue = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error('INVALID_JSON');
  }

  const parsedPayload = publishRequestSchema.safeParse(jsonValue);
  if (!parsedPayload.success) {
    const issues = parsedPayload.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`INVALID_REQUEST_SCHEMA:${issues}`);
  }

  return parsedPayload.data;
}

function resolveArtifact(payload: PublishRequestPayload): {
  artifactValue: unknown;
  artifactRawForPublish: string;
} {
  if (typeof payload.artifactRaw === 'string') {
    let parsedFromRaw: unknown;

    try {
      parsedFromRaw = JSON.parse(payload.artifactRaw) as unknown;
    } catch {
      throw new Error('INVALID_ARTIFACT_RAW_JSON');
    }

    return {
      artifactValue: parsedFromRaw,
      artifactRawForPublish: payload.artifactRaw,
    };
  }

  const artifactValue = payload.artifact;
  const artifactRawForPublish = `${JSON.stringify(artifactValue, null, 2)}\n`;

  return {
    artifactValue,
    artifactRawForPublish,
  };
}

function buildRelayPublishLogEntry(input: {
  validatedArtifact: PublishableSimulationResult;
  artifactHash: string;
  idempotencyKey: string;
  relayVersion: string;
  sourcePublishMetadata?: OpenJsonObject;
  provenance?: OpenJsonObject;
}): RelayPublishLogEntry {
  const sourcePublishId = input.sourcePublishMetadata
    ? readOptionalString(input.sourcePublishMetadata, 'publish_id')
    : undefined;
  const sourcePublishedAt = input.sourcePublishMetadata
    ? readOptionalString(input.sourcePublishMetadata, 'published_at')
    : undefined;

  const metadata = input.validatedArtifact.report.structuredReport.metadata;
  const publishMetadata = createPublishMetadata(input.artifactHash);

  return {
    ...publishMetadata,
    schema_version: metadata.schemaVersion,
    simulation_type: metadata.simulationType,
    proposal_id: metadata.proposalId,
    chain_id: metadata.chainId,
    idempotency_key: input.idempotencyKey,
    relay_version: input.relayVersion,
    source_publish_id: sourcePublishId,
    source_published_at: sourcePublishedAt,
    provenance: input.provenance,
  };
}

function buildHealthResponse(input: {
  config: RelayConfig;
  completedIdempotencyRecords: Map<string, CompletedIdempotencyRecord>;
  inFlightIdempotencyRecords: Map<string, InFlightIdempotencyRecord>;
}): OpenJsonObject {
  return {
    ok: true,
    service: 'seatbelt-managed-publish-relay',
    relayVersion: input.config.relayVersion,
    rateLimitEnabled: input.config.rateLimitEnabled,
    maxBodyBytes: input.config.maxBodyBytes,
    idempotency: {
      completedKeys: input.completedIdempotencyRecords.size,
      inFlightKeys: input.inFlightIdempotencyRecords.size,
    },
  };
}

function normalizePublishError(error: unknown): RelayExecutionResult {
  if (error instanceof RelayPublishTimeoutError) {
    return {
      status: 504,
      body: {
        error: 'publish_timeout',
        message: error.message,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: 'publish_failed',
      message: error instanceof Error ? error.message : 'Unknown publish error',
    },
  };
}

export function createRelayConfig(
  env: Record<string, string | undefined> = process.env,
): RelayConfig {
  return {
    relayVersion: readNonEmptyEnv(env, 'SEATBELT_RELAY_VERSION') ?? 'phase1c-mvp',
    maxBodyBytes: readPositiveInteger(env, 'SEATBELT_RELAY_MAX_BODY_BYTES', 5 * 1024 * 1024),
    rateLimitEnabled: readBooleanFlag(
      readNonEmptyEnv(env, 'SEATBELT_RELAY_RATE_LIMIT_ENABLED'),
      true,
    ),
    rateLimitWindowMs: readPositiveInteger(env, 'SEATBELT_RELAY_RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMaxRequests: readPositiveInteger(env, 'SEATBELT_RELAY_RATE_LIMIT_MAX_REQUESTS', 30),
    deployTimeoutMs: readPositiveInteger(
      env,
      'SEATBELT_RELAY_DEPLOY_TIMEOUT_MS',
      DEFAULT_DEPLOY_TIMEOUT_MS,
    ),
    port: readPositiveInteger(env, 'PORT', 8787),
  };
}

export function createRelayFetchHandler(
  options: RelayServerOptions = {},
): (request: Request) => Promise<Response> {
  const env = options.env ?? process.env;
  const config = {
    ...createRelayConfig(env),
    ...options.config,
  };

  const runCommand = options.dependencies?.runCommand ?? defaultRunCommand;
  const nowMs = options.dependencies?.nowMs ?? (() => Date.now());

  const publisher = options.dependencies?.publisher
    ? options.dependencies.publisher
    : (input: {
        artifactRaw: string;
        publishLogEntry: RelayPublishLogEntry;
        env: Record<string, string | undefined>;
        deployTimeoutMs: number;
      }) =>
        defaultRelayPublisher({
          ...input,
          runCommand,
        });

  const rateLimitBuckets = new Map<string, RateLimitBucket>();
  const completedIdempotencyRecords = new Map<string, CompletedIdempotencyRecord>();
  const inFlightIdempotencyRecords = new Map<string, InFlightIdempotencyRecord>();

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    if (request.method === 'GET' && pathname === '/api/v1/health') {
      return createJsonResponse(
        200,
        buildHealthResponse({
          config,
          completedIdempotencyRecords,
          inFlightIdempotencyRecords,
        }),
      );
    }

    if (request.method !== 'POST' || pathname !== '/api/v1/publishes') {
      return createJsonResponse(404, {
        error: 'not_found',
        message: 'Endpoint not found.',
      });
    }

    const now = nowMs();
    maybePruneRateLimitBuckets(rateLimitBuckets, now, config.rateLimitWindowMs);

    const clientAddress = extractClientAddress(request);
    const rateLimitResult = ensureRateLimitAllowance({
      key: clientAddress,
      nowMs: now,
      config,
      buckets: rateLimitBuckets,
    });

    if (!rateLimitResult.ok) {
      return createJsonResponse(
        429,
        {
          error: 'rate_limited',
          message: 'Too many publish requests from this client. Please retry later.',
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        },
        {
          'retry-after': String(rateLimitResult.retryAfterSeconds),
        },
      );
    }

    let rawBody: string;

    try {
      rawBody = await readRequestBody(request, config.maxBodyBytes);
    } catch (error) {
      if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
        return createJsonResponse(413, {
          error: 'payload_too_large',
          message: `Publish payload exceeds ${config.maxBodyBytes} bytes.`,
        });
      }

      return createJsonResponse(400, {
        error: 'invalid_request',
        message: 'Failed to read publish payload.',
      });
    }

    let payload: PublishRequestPayload;

    try {
      payload = parsePublishPayload(rawBody);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'INVALID_JSON') {
          return createJsonResponse(400, {
            error: 'invalid_json',
            message: 'Request body must be valid JSON.',
          });
        }

        if (error.message.startsWith('INVALID_REQUEST_SCHEMA:')) {
          return createJsonResponse(400, {
            error: 'invalid_request_schema',
            message: error.message.replace('INVALID_REQUEST_SCHEMA:', ''),
          });
        }
      }

      return createJsonResponse(400, {
        error: 'invalid_request',
        message: 'Publish request payload is invalid.',
      });
    }

    let artifactValue: unknown;
    let artifactRawForPublish: string;

    try {
      const resolvedArtifact = resolveArtifact(payload);
      artifactValue = resolvedArtifact.artifactValue;
      artifactRawForPublish = resolvedArtifact.artifactRawForPublish;
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_ARTIFACT_RAW_JSON') {
        return createJsonResponse(400, {
          error: 'invalid_artifact_raw_json',
          message: 'artifactRaw must be a valid JSON string.',
        });
      }

      return createJsonResponse(400, {
        error: 'invalid_request',
        message: 'Failed to process artifact payload.',
      });
    }

    let validatedArtifact: PublishableSimulationResult;

    try {
      validatedArtifact = validatePublishArtifact(artifactValue);
    } catch (error) {
      if (error instanceof PublishArtifactValidationError) {
        return createJsonResponse(400, {
          error: 'artifact_validation_failed',
          message: error.message,
          issues: error.issues,
        });
      }

      return createJsonResponse(500, {
        error: 'internal_error',
        message: 'Unexpected validation failure.',
      });
    }

    const artifactHash = computeArtifactHash(artifactRawForPublish);
    const idempotencyKey =
      readNonEmptyEnv({ value: request.headers.get('idempotency-key') ?? undefined }, 'value') ??
      artifactHash;

    const completedRecord = completedIdempotencyRecords.get(idempotencyKey);

    if (completedRecord) {
      if (completedRecord.artifactHash !== artifactHash) {
        return createJsonResponse(409, {
          error: 'idempotency_conflict',
          message: 'Idempotency key already exists for a different artifact hash.',
          idempotencyKey,
          existingArtifactHash: completedRecord.artifactHash,
          providedArtifactHash: artifactHash,
        });
      }

      return createJsonResponse(completedRecord.result.status, completedRecord.result.body, {
        'x-idempotent-replay': 'true',
      });
    }

    const inFlightRecord = inFlightIdempotencyRecords.get(idempotencyKey);

    if (inFlightRecord) {
      if (inFlightRecord.artifactHash !== artifactHash) {
        return createJsonResponse(409, {
          error: 'idempotency_conflict',
          message: 'Idempotency key is already in-flight for a different artifact hash.',
          idempotencyKey,
          existingArtifactHash: inFlightRecord.artifactHash,
          providedArtifactHash: artifactHash,
        });
      }

      try {
        const settledResult = await inFlightRecord.promise;
        return createJsonResponse(settledResult.status, settledResult.body, {
          'x-idempotent-replay': 'true',
        });
      } catch (error) {
        const normalizedFailure = normalizePublishError(error);

        return createJsonResponse(normalizedFailure.status, normalizedFailure.body, {
          'x-idempotent-replay': 'true',
        });
      }
    }

    const executionPromise = (async (): Promise<RelayExecutionResult> => {
      const publishLogEntry = buildRelayPublishLogEntry({
        validatedArtifact,
        artifactHash,
        idempotencyKey,
        relayVersion: config.relayVersion,
        sourcePublishMetadata: payload.publishMetadata,
        provenance: payload.provenance,
      });

      const publishResult = await publisher({
        artifactRaw: artifactRawForPublish,
        publishLogEntry,
        env,
        deployTimeoutMs: config.deployTimeoutMs,
      });

      const responseBody: RelaySuccessResponse = {
        publishId: publishLogEntry.publish_id,
        idempotencyKey,
        artifactHash,
        deploymentUrl: publishResult.deploymentUrl,
        artifactUrl: publishResult.artifactUrl,
        metadataUrl: publishResult.metadataUrl,
      };

      const responseBodyRecord: OpenJsonObject = {
        publishId: responseBody.publishId,
        idempotencyKey: responseBody.idempotencyKey,
        artifactHash: responseBody.artifactHash,
        deploymentUrl: responseBody.deploymentUrl,
        artifactUrl: responseBody.artifactUrl,
        metadataUrl: responseBody.metadataUrl,
      };

      console.log(
        `[relay] publish success publish_id=${publishLogEntry.publish_id} idempotency_key=${idempotencyKey} artifact_hash=${artifactHash} deployment_url=${publishResult.deploymentUrl}`,
      );

      return {
        status: 201,
        body: responseBodyRecord,
      };
    })();

    inFlightIdempotencyRecords.set(idempotencyKey, {
      artifactHash,
      promise: executionPromise,
    });

    let settledResult: RelayExecutionResult;

    try {
      settledResult = await executionPromise;
    } catch (error) {
      inFlightIdempotencyRecords.delete(idempotencyKey);

      const normalizedFailure = normalizePublishError(error);
      const errorMessage =
        typeof normalizedFailure.body.message === 'string'
          ? normalizedFailure.body.message
          : 'Unknown publish error';

      console.error(
        `[relay] publish failed idempotency_key=${idempotencyKey} artifact_hash=${artifactHash} status=${normalizedFailure.status} error=${errorMessage}`,
      );

      return createJsonResponse(normalizedFailure.status, normalizedFailure.body);
    }

    inFlightIdempotencyRecords.delete(idempotencyKey);

    completedIdempotencyRecords.set(idempotencyKey, {
      artifactHash,
      result: settledResult,
    });

    if (completedIdempotencyRecords.size > 5_000) {
      const firstKey = completedIdempotencyRecords.keys().next().value;
      if (typeof firstKey === 'string') {
        completedIdempotencyRecords.delete(firstKey);
      }
    }

    return createJsonResponse(settledResult.status, settledResult.body);
  };
}

export function startRelayServer(options: RelayServerOptions = {}): ReturnType<typeof Bun.serve> {
  const env = options.env ?? process.env;
  const baseConfig = createRelayConfig(env);
  const config = {
    ...baseConfig,
    ...options.config,
  };

  const fetchHandler = createRelayFetchHandler({
    ...options,
    env,
    config,
  });

  const server = Bun.serve({
    port: config.port,
    fetch: fetchHandler,
  });

  console.log(`[relay] seatbelt managed publish relay listening on :${server.port}`);
  console.log('[relay] health endpoint: GET /api/v1/health');
  console.log('[relay] publish endpoint: POST /api/v1/publishes');

  return server;
}

if (import.meta.main) {
  startRelayServer();
}
