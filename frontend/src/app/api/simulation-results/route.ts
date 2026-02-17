import fs from 'node:fs';
import path from 'node:path';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';

const DEFAULT_MAX_SIMULATION_RESULTS_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_ALLOWED_ARTIFACT_HOSTS = [
  'seatbelt-publish.vercel.app',
  'seatbelt-publish-beta.vercel.app',
];
const LOCALHOST_ARTIFACT_HOSTS = ['localhost', '127.0.0.1', '::1'];
const SIMULATION_RESULTS_FILENAME = 'simulation-results.json';
const LOCAL_SIMULATION_RESULTS_FILE = path.join(
  process.cwd(),
  'public',
  SIMULATION_RESULTS_FILENAME,
);

type SimulationResultsSourceError = {
  error: string;
  status: number;
  fileSizeBytes?: number;
  maxBytes?: number;
};

type AllowedArtifactHost = {
  hostname: string;
  isLocalhost: boolean;
};

function isSimulationResultsSourceError(value: unknown): value is SimulationResultsSourceError {
  if (!value || typeof value !== 'object') return false;
  if (!('error' in value) || !('status' in value)) return false;

  return (
    typeof Reflect.get(value, 'error') === 'string' &&
    typeof Reflect.get(value, 'status') === 'number'
  );
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;

    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    octets.push(octet);
  }

  return octets;
}

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = parseIpv4Address(hostname);
  if (!octets) return false;

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized.includes(':')) return false;

  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4Address(normalized.slice('::ffff:'.length));
  }

  return false;
}

function isPrivateNetworkHostname(hostname: string): boolean {
  return isPrivateIpv4Address(hostname) || isPrivateIpv6Address(hostname);
}

function getAllowedArtifactHosts(): Map<string, AllowedArtifactHost> {
  const hosts = new Map<string, AllowedArtifactHost>();
  const localhostHosts = new Set(LOCALHOST_ARTIFACT_HOSTS.map(normalizeHostname));

  const addHost = (hostname: string) => {
    const normalized = normalizeHostname(hostname);
    hosts.set(normalized, {
      hostname: normalized,
      isLocalhost: localhostHosts.has(normalized),
    });
  };

  for (const host of DEFAULT_ALLOWED_ARTIFACT_HOSTS) {
    addHost(host);
  }

  const configuredHosts = process.env.SIMULATION_RESULTS_ALLOWED_ARTIFACT_HOSTS;
  if (configuredHosts) {
    for (const host of configuredHosts.split(',')) {
      const trimmed = host.trim();
      if (trimmed) {
        addHost(trimmed);
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    for (const localhostHost of LOCALHOST_ARTIFACT_HOSTS) {
      addHost(localhostHost);
    }
  }

  return hosts;
}

function getMaxSimulationResultsBytes(): number {
  const raw = process.env.SIMULATION_RESULTS_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  return Math.floor(parsed);
}

function getArtifactFetchTimeoutMs(): number {
  const raw = process.env.SIMULATION_RESULTS_FETCH_TIMEOUT_MS;
  if (!raw) return DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;

  return Math.floor(parsed);
}

function readSimulationResultsFromLocalFile(
  maxBytes: number,
): unknown | SimulationResultsSourceError {
  try {
    const stat = fs.statSync(LOCAL_SIMULATION_RESULTS_FILE);

    if (stat.size > maxBytes) {
      return {
        error: 'Simulation results file too large',
        status: 413,
        fileSizeBytes: stat.size,
        maxBytes,
      };
    }

    const fileContents = fs.readFileSync(LOCAL_SIMULATION_RESULTS_FILE, 'utf8');
    const parsedContents: unknown = JSON.parse(fileContents);
    return parsedContents;
  } catch (error) {
    console.error('Error reading local simulation results:', error);
    return { error: 'No simulation results found', status: 404 };
  }
}

function normalizeArtifactPathname(pathname: string): string | null {
  if (pathname.endsWith(`/${SIMULATION_RESULTS_FILENAME}`)) {
    return pathname;
  }

  const trimmedPathname = pathname.replace(/\/+$/, '');
  const lastSegment = trimmedPathname.split('/').at(-1) ?? '';
  if (lastSegment.includes('.')) {
    return null;
  }

  const basePathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${basePathname}${SIMULATION_RESULTS_FILENAME}`;
}

function buildTrustedArtifactUrl(parsed: URL, allowedHost: AllowedArtifactHost): string {
  const trusted = new URL('https://seatbelt-publish.vercel.app/');
  trusted.protocol = allowedHost.isLocalhost ? parsed.protocol : 'https:';
  trusted.hostname = allowedHost.hostname;
  trusted.port = allowedHost.isLocalhost ? parsed.port : '';

  const normalizedPathname = normalizeArtifactPathname(parsed.pathname);
  if (!normalizedPathname) {
    throw new Error('Artifact URL must point to simulation-results.json');
  }

  trusted.pathname = normalizedPathname;
  trusted.search = parsed.search;
  trusted.hash = '';
  return trusted.toString();
}

function parseArtifactUrl(rawArtifactUrl: string): string | SimulationResultsSourceError {
  const trimmed = rawArtifactUrl.trim();
  if (!trimmed) {
    return { error: 'Invalid artifact URL', status: 400 };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol;
    const hostname = normalizeHostname(parsed.hostname);
    const allowedHosts = getAllowedArtifactHosts();
    const allowedHost = allowedHosts.get(hostname);

    if (!allowedHost) {
      return { error: 'Artifact host is not allowed', status: 400 };
    }

    if (!(protocol === 'https:' || (protocol === 'http:' && allowedHost.isLocalhost))) {
      return { error: 'Artifact URL must use https (or http on localhost)', status: 400 };
    }

    if (parsed.port && !allowedHost.isLocalhost) {
      return { error: 'Artifact URL must not include custom ports', status: 400 };
    }

    if (isPrivateNetworkHostname(allowedHost.hostname) && !allowedHost.isLocalhost) {
      return { error: 'Artifact URL must not target private networks', status: 400 };
    }

    if (parsed.username || parsed.password) {
      return { error: 'Artifact URL must not include credentials', status: 400 };
    }

    try {
      return buildTrustedArtifactUrl(parsed, allowedHost);
    } catch {
      return { error: 'Artifact URL must point to simulation-results.json', status: 400 };
    }
  } catch {
    return { error: 'Invalid artifact URL', status: 400 };
  }
}

async function readResponseTextWithByteLimit(
  response: Response,
  maxBytes: number,
): Promise<{ bodyText: string } | SimulationResultsSourceError> {
  if (!response.body) {
    return { error: 'Failed to read artifact response body', status: 502 };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let totalBytes = 0;
  let bodyText = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    if (!chunk.value) continue;

    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return {
        error: 'Simulation results file too large',
        status: 413,
        fileSizeBytes: totalBytes,
        maxBytes,
      };
    }

    bodyText += decoder.decode(chunk.value, { stream: true });
  }

  bodyText += decoder.decode();
  return { bodyText };
}

async function readSimulationResultsFromArtifactUrl(
  artifactUrl: string,
  maxBytes: number,
): Promise<unknown | SimulationResultsSourceError> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getArtifactFetchTimeoutMs());

  try {
    const response = await fetch(artifactUrl, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        error: 'Artifact URL redirects are not allowed',
        status: 502,
      };
    }

    if (!response.ok) {
      return {
        error: `Failed to fetch artifact (HTTP ${response.status})`,
        status: 502,
      };
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const parsedContentLength = Number(contentLengthHeader);
      if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
        return {
          error: 'Simulation results file too large',
          status: 413,
          fileSizeBytes: parsedContentLength,
          maxBytes,
        };
      }
    }

    const responseBody = await readResponseTextWithByteLimit(response, maxBytes);
    if (isSimulationResultsSourceError(responseBody)) {
      return responseBody;
    }

    const parsedBody: unknown = JSON.parse(responseBody.bodyText);
    return parsedBody;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Artifact fetch timed out', status: 504 };
    }

    console.error('Error fetching simulation artifact:', error);
    return { error: 'Failed to fetch artifact', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const includeMarkdown = requestUrl.searchParams.get('includeMarkdown') === '1';
    const artifactParam = requestUrl.searchParams.get('artifact');
    const maxBytes = getMaxSimulationResultsBytes();

    let results: unknown | SimulationResultsSourceError;

    if (artifactParam) {
      const artifactUrl = parseArtifactUrl(artifactParam);
      if (isSimulationResultsSourceError(artifactUrl)) {
        return NextResponse.json({ error: artifactUrl.error }, { status: artifactUrl.status });
      }

      results = await readSimulationResultsFromArtifactUrl(artifactUrl, maxBytes);
    } else {
      results = readSimulationResultsFromLocalFile(maxBytes);
    }

    if (isSimulationResultsSourceError(results)) {
      const body = {
        error: results.error,
        fileSizeBytes: results.fileSizeBytes,
        maxBytes: results.maxBytes,
      };
      return NextResponse.json(body, { status: results.status });
    }

    const normalizedResults = parseSimulationResultsJson(results);
    if (normalizedResults.length === 0) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    if (includeMarkdown) {
      return NextResponse.json(normalizedResults);
    }

    const withoutMarkdown = normalizedResults.map((result) => ({
      ...result,
      report: {
        ...result.report,
        markdownReport: '',
      },
    }));

    return NextResponse.json(withoutMarkdown);
  } catch (error) {
    if (error instanceof SimulationResultsParseError) {
      console.error('Invalid simulation-results.json:', error.issues);
      return NextResponse.json(
        { error: 'Invalid simulation-results.json', issues: error.summary },
        { status: 500 },
      );
    }

    console.error('Error in simulation results API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
