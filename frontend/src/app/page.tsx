'use client';

import type { SimulationType } from '@/components/ProposalCard';
import { ProposalSummary } from '@/components/ProposalSummary';
import { StructuredReport } from '@/components/StructuredReport';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Toaster } from '@/components/ui/sonner';
import { useSimulationResults } from '@/hooks/use-simulation-results';
import { AlertTriangleIcon, InfoIcon } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error }: { error: Error }) {
  return (
    <Alert variant="destructive" className="w-full max-w-4xl mx-auto">
      <AlertTriangleIcon className="h-4 w-4" />
      <AlertTitle>Error Loading Simulation Data</AlertTitle>
      <AlertDescription>
        {error.message}
        <p className="mt-2">
          Make sure you have run a simulation and the simulation-results.json file exists.
        </p>
      </AlertDescription>
    </Alert>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-5xl xl:max-w-6xl">
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ReportSection />
        </ErrorBoundary>
        <Toaster position="bottom-right" closeButton />
      </div>
    </div>
  );
}

function ReportSection() {
  const { data: simulationData, error: simulationError } = useSimulationResults();

  if (simulationError) {
    return (
      <Alert variant="destructive" className="w-full">
        <AlertTriangleIcon className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          {simulationError.message}
          <p className="mt-2">
            Make sure you have run a simulation and the simulation-results.json file exists in the
            public directory.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (!simulationData) {
    return (
      <Alert className="w-full">
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>No Simulation Data Found</AlertTitle>
        <AlertDescription>
          <p>Run a simulation first to generate proposal data.</p>
          <code className="block mt-2 p-2 bg-gray-100 rounded text-sm">
            bun run sim [simulation-name]
          </code>
        </AlertDescription>
      </Alert>
    );
  }

  const { proposalData, report } = simulationData;
  const simulationType: SimulationType = report.structuredReport?.metadata.simulationType || 'new';

  return (
    <div className="w-full space-y-4">
      <ProposalSummary proposal={proposalData} simulationType={simulationType} />

      {report.structuredReport ? (
        <StructuredReport report={report.structuredReport} />
      ) : (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertTitle>No Report Available</AlertTitle>
          <AlertDescription>No detailed report is available for this simulation.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
