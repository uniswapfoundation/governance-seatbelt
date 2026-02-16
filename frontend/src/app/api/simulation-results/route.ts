import fs from 'node:fs';
import path from 'node:path';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';

const DEFAULT_MAX_SIMULATION_RESULTS_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS = 15_000;
const LOCAL_SIMULATION_RESULTS_FILE = path.join(process.cwd(), 'public', 'simulation-results.json');

type SimulationResultsSourceError = {
  error: string;
  status: number;
  fileSizeBytes?: number;
  maxBytes?: number;
};

function isSimulationResultsSourceError(value: unknown): value is SimulationResultsSourceError {
  if (!value || typeof value !== 'object') return false;
  if (!('error' in value) || !('status' in value)) return false;

  return (
    typeof Reflect.get(value, 'error') === 'string' &&
    typeof Reflect.get(value, 'status') === 'number'
  );
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

function parseArtifactUrl(rawArtifactUrl: string): URL | SimulationResultsSourceError {
  const trimmed = rawArtifactUrl.trim();
  if (!trimmed) {
    return { error: 'Invalid artifact URL', status: 400 };
  }

  try {
    const parsed = new URL(trimmed);

    const protocol = parsed.protocol;
    const hostname = parsed.hostname.toLowerCase();
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    if (!(protocol === 'https:' || (protocol === 'http:' && isLocalhost))) {
      return { error: 'Artifact URL must use https (or http on localhost)', status: 400 };
    }

    if (parsed.username || parsed.password) {
      return { error: 'Artifact URL must not include credentials', status: 400 };
    }

    if (!parsed.pathname.endsWith('/simulation-results.json')) {
      return { error: 'Artifact URL must point to simulation-results.json', status: 400 };
    }

    parsed.hash = '';
    return parsed;
  } catch {
    return { error: 'Invalid artifact URL', status: 400 };
  }
}

async function readSimulationResultsFromArtifactUrl(
  artifactUrl: URL,
  maxBytes: number,
): Promise<unknown | SimulationResultsSourceError> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getArtifactFetchTimeoutMs());

  try {
    const response = await fetch(artifactUrl, {
      cache: 'no-store',
      signal: controller.signal,
    });

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

    const rawBody = await response.text();
    const byteLength = Buffer.byteLength(rawBody, 'utf8');
    if (byteLength > maxBytes) {
      return {
        error: 'Simulation results file too large',
        status: 413,
        fileSizeBytes: byteLength,
        maxBytes,
      };
    }

    const parsedBody: unknown = JSON.parse(rawBody);
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
