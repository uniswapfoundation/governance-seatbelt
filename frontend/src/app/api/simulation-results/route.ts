import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

// Helper function to read the simulation results file
function readSimulationResults() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'simulation-results.json');
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContents);
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

    // Handle both array and single object formats
    // Return as array for consistency with frontend expectations
    const resultsArray = Array.isArray(results) ? results : [results];

    if (resultsArray.length === 0) {
      return NextResponse.json({ error: 'No simulation results found' }, { status: 404 });
    }

    // Return the results directly
    return NextResponse.json(resultsArray);
  } catch (error) {
    console.error('Error in simulation results API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
