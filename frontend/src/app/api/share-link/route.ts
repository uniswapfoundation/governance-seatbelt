import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';

const DEFAULT_MAX_SIMULATION_RESULTS_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_RELAY_TIMEOUT_MS = 120_000;
const DEFAULT_RELAY_URL = 'https://seatbelt-relay-beta.vercel.app';
const DEFAULT_SHARE_LINK_RATE_LIMIT_MAX_REQUESTS = 5;
const DEFAULT_SHARE_LINK_RATE_LIMIT_WINDOW_MS = 60_000;
const LOCAL_SIMULATION_RESULTS_FILE = path.join(process.cwd(), 'public', 'simulation-results.json');

const shareLinkRequestTimestampsByClient = new Map<string, number[]>();

type ShareLinkResult =
  | {
      artifactUrl: string;
    }
  | {
      error: string;
      status: number;
    };

function getMaxSimulationResultsBytes(): number {
  const raw = process.env.SIMULATION_RESULTS_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  return Math.floor(parsed);
}

function getRelayTimeoutMs(): number {
  const raw = process.env.SEATBELT_RELAY_TIMEOUT_MS;
  if (!raw) return DEFAULT_RELAY_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RELAY_TIMEOUT_MS;

  return Math.floor(parsed);
}

function getRelayUrl(): string {
  const fromEnv = process.env.SEATBELT_RELAY_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }

  return DEFAULT_RELAY_URL;
}

function getShareLinkRateLimitMaxRequests(): number {
  const raw = process.env.SHARE_LINK_RATE_LIMIT_MAX_REQUESTS;
  if (!raw) return DEFAULT_SHARE_LINK_RATE_LIMIT_MAX_REQUESTS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHARE_LINK_RATE_LIMIT_MAX_REQUESTS;
  }

  return Math.floor(parsed);
}

function getShareLinkRateLimitWindowMs(): number {
  const raw = process.env.SHARE_LINK_RATE_LIMIT_WINDOW_MS;
  if (!raw) return DEFAULT_SHARE_LINK_RATE_LIMIT_WINDOW_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHARE_LINK_RATE_LIMIT_WINDOW_MS;
  }

  return Math.floor(parsed);
}

function readClientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstForwardedIp = forwardedFor.split(',')[0]?.trim();
    if (firstForwardedIp) {
      return firstForwardedIp;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

function enforceShareLinkRateLimit(
  request: Request,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const rateLimitWindowMs = getShareLinkRateLimitWindowMs();
  const maxRequests = getShareLinkRateLimitMaxRequests();
  const cutoff = now - rateLimitWindowMs;
  const clientIdentifier = readClientIdentifier(request);

  const previousTimestamps = shareLinkRequestTimestampsByClient.get(clientIdentifier) ?? [];
  const recentTimestamps = previousTimestamps.filter((timestamp) => timestamp > cutoff);

  if (recentTimestamps.length >= maxRequests) {
    shareLinkRequestTimestampsByClient.set(clientIdentifier, recentTimestamps);

    const oldestTimestamp = recentTimestamps[0] ?? now;
    const retryAfterMs = Math.max(oldestTimestamp + rateLimitWindowMs - now, 1);

    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  recentTimestamps.push(now);
  shareLinkRequestTimestampsByClient.set(clientIdentifier, recentTimestamps);

  return { allowed: true };
}

function appendPathToUrl(baseUrl: string, pathSegment: string): string {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  parsed.pathname = `${basePath}${pathSegment.replace(/^\//, '')}`;
  return parsed.toString();
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  if (!(key in value)) return null;

  const propertyValue = Reflect.get(value, key);
  return typeof propertyValue === 'string' ? propertyValue : null;
}

function readRawArtifact(
  maxBytes: number,
): { artifactRaw: string } | { error: string; status: number } {
  try {
    const stat = fs.statSync(LOCAL_SIMULATION_RESULTS_FILE);
    if (stat.size > maxBytes) {
      return { error: 'Simulation results file too large', status: 413 };
    }

    const artifactRaw = fs.readFileSync(LOCAL_SIMULATION_RESULTS_FILE, 'utf8');
    const rawSize = Buffer.byteLength(artifactRaw, 'utf8');
    if (rawSize > maxBytes) {
      return { error: 'Simulation results file too large', status: 413 };
    }

    return { artifactRaw };
  } catch (error) {
    console.error('Error reading simulation results for publish:', error);
    return { error: 'No simulation results found', status: 404 };
  }
}

async function publishViaManagedRelay(
  artifactRaw: string,
  artifactHash: string,
): Promise<ShareLinkResult> {
  const relayEndpoint = `${getRelayUrl()}/api/v1/publishes`;
  const requestBody = JSON.stringify({ artifactRaw });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getRelayTimeoutMs());

  try {
    const response = await fetch(relayEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': artifactHash,
      },
      body: requestBody,
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        error: `Relay publish failed (HTTP ${response.status}): ${responseText.slice(0, 300)}`,
        status: 502,
      };
    }

    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      return {
        error: 'Relay publish returned an invalid response payload',
        status: 502,
      };
    }

    const directArtifactUrl = readStringProperty(parsedResponse, 'artifactUrl');
    if (directArtifactUrl) {
      return { artifactUrl: directArtifactUrl };
    }

    const deploymentUrl = readStringProperty(parsedResponse, 'deploymentUrl');
    if (!deploymentUrl) {
      return { error: 'Relay publish response is missing deploymentUrl', status: 502 };
    }

    return {
      artifactUrl: appendPathToUrl(deploymentUrl, 'simulation-results.json'),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Relay publish timed out', status: 504 };
    }

    console.error('Error publishing via managed relay:', error);
    return { error: 'Could not publish simulation artifact', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const rateLimitResult = enforceShareLinkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: {
            'retry-after': String(rateLimitResult.retryAfterSeconds),
          },
        },
      );
    }

    const maxBytes = getMaxSimulationResultsBytes();
    const readResult = readRawArtifact(maxBytes);

    if ('error' in readResult) {
      return NextResponse.json({ error: readResult.error }, { status: readResult.status });
    }

    const parsedArtifact: unknown = JSON.parse(readResult.artifactRaw);
    parseSimulationResultsJson(parsedArtifact);

    const artifactHash = createHash('sha256').update(readResult.artifactRaw).digest('hex');
    const publishResult = await publishViaManagedRelay(readResult.artifactRaw, artifactHash);

    if ('error' in publishResult) {
      return NextResponse.json({ error: publishResult.error }, { status: publishResult.status });
    }

    return NextResponse.json({ artifactUrl: publishResult.artifactUrl });
  } catch (error) {
    if (error instanceof SimulationResultsParseError) {
      console.error('Invalid simulation-results.json for publish:', error.issues);
      return NextResponse.json({ error: 'Invalid simulation-results.json' }, { status: 500 });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid simulation-results.json' }, { status: 500 });
    }

    console.error('Error generating share link:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
