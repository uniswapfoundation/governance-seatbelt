import fs from 'node:fs';
import path from 'node:path';
import { SimulationResultsParseError, parseSimulationResultsJson } from '@/lib/simulation-results';
import { NextResponse } from 'next/server';

// Helper function to read the simulation results file
function readSimulationResults() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'simulation-results.json');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContents) as unknown;
  } catch (error) {
    console.error('Error reading simulation results:', error);
    return null;
  }
}

export async function GET() {
  try {
    // Read the simulation results file
    const results = readSimulationResults();

    if (!results) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    const normalizedResults = parseSimulationResultsJson(results);
    if (normalizedResults.length === 0) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    return NextResponse.json(normalizedResults);
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
