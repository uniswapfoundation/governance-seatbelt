import fs from 'node:fs';
import path from 'node:path';
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

    const normalizedResults = Array.isArray(results) ? results : results ? [results] : null;

    if (!normalizedResults?.length) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    // Return the results directly
    return NextResponse.json(normalizedResults);
  } catch (error) {
    console.error('Error in simulation results API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
