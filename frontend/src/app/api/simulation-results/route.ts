import fs from 'node:fs';
import path from 'node:path';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';

const DEFAULT_MAX_SIMULATION_RESULTS_BYTES = 25 * 1024 * 1024; // 25MB

function getMaxSimulationResultsBytes(): number {
  const raw = process.env.SIMULATION_RESULTS_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_SIMULATION_RESULTS_BYTES;

  return Math.floor(parsed);
}

// Helper function to read the simulation results file
function readSimulationResults() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'simulation-results.json');
    const maxBytes = getMaxSimulationResultsBytes();
    const stat = fs.statSync(filePath);

    if (stat.size > maxBytes) {
      return { error: 'Simulation results file too large', fileSizeBytes: stat.size, maxBytes };
    }

    const fileContents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContents) as unknown;
  } catch (error) {
    console.error('Error reading simulation results:', error);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    // Read the simulation results file
    const results = readSimulationResults();

    if (
      results &&
      typeof results === 'object' &&
      'error' in results &&
      (results as { error?: unknown }).error === 'Simulation results file too large'
    ) {
      const { error, fileSizeBytes, maxBytes } = results as {
        error: string;
        fileSizeBytes: number;
        maxBytes: number;
      };
      return NextResponse.json({ error, fileSizeBytes, maxBytes }, { status: 413 });
    }

    if (!results) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    const normalizedResults = parseSimulationResultsJson(results);
    if (normalizedResults.length === 0) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const includeMarkdown = url.searchParams.get('includeMarkdown') === '1';

    if (includeMarkdown) return NextResponse.json(normalizedResults);

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
