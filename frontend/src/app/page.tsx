'use client';
import { StructuredReport } from '@/components/StructuredReport';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { type Proposal, useSimulationResults } from '@/hooks/use-simulation-results';
import { useWriteProposeNew } from '@/hooks/use-write-propose-new';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon } from 'lucide-react';
import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

// Fallback component for when the query fails
function ErrorFallback({ error }: { error: Error }) {
  return (
    <Alert variant="destructive" className="w-full">
      <AlertTriangleIcon className="h-4 w-4" />
      <AlertTitle>Error Loading Simulation Data</AlertTitle>
      <AlertDescription>
        {error.message}
        <p className="mt-2">
          Make sure you have run a simulation and the simulation-results.json file exists in the
          public directory.
        </p>
      </AlertDescription>
    </Alert>
  );
}

// Main component with proper error handling
export default function Home() {
  const { isConnected } = useAccount();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 gap-6 max-w-7xl mx-auto">
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <ProposalSection isConnected={isConnected} />
      </ErrorBoundary>

      <Toaster position="bottom-right" closeButton />
    </div>
  );
}

// Separate component for the proposal section
function ProposalSection({ isConnected }: { isConnected: boolean }) {
  const { data: simulationData, error: simulationError } = useSimulationResults();
  const { mutate: proposeNew, isPending, isPendingConfirmation } = useWriteProposeNew();

  const handlePropose = () => {
    if (!simulationData) {
      toast.error('No simulation data available');
      return;
    }

    proposeNew();
  };

  // Show error if there is one
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

  // Show loading or no data message if there's no simulation data
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

  // Show proposal and report if we have data
  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        {/* Proposal Card - Right on desktop, Top on mobile */}
        <div className="md:col-span-2 md:order-2 order-1 flex flex-col h-fit">
          <ProposalCard
            proposal={proposalData}
            onPropose={handlePropose}
            isPending={isPending}
            isPendingConfirmation={isPendingConfirmation}
            isConnected={isConnected}
            className="md:sticky md:top-4 self-start w-full"
          />
        </div>

        {/* Report Card - Left on desktop, Bottom on mobile */}
        <div className="md:col-span-3 md:order-1 order-2 md:sticky md:top-4 h-fit">
          {report.structuredReport ? (
            <StructuredReport report={report.structuredReport} proposal={proposalData} />
          ) : (
            <Alert>
              <InfoIcon className="h-4 w-4" />
              <AlertTitle>No Report Available</AlertTitle>
              <AlertDescription>
                No detailed report is available for this simulation.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onPropose,
  isPending,
  isPendingConfirmation,
  isConnected,
  className,
}: {
  proposal: Proposal;
  onPropose: () => void;
  isPending: boolean;
  isPendingConfirmation: boolean;
  isConnected: boolean;
  className?: string;
}) {
  // State to track which call is currently being viewed
  const [selectedCallIndex, setSelectedCallIndex] = React.useState(0);

  // Check if we have multiple calls
  const hasMultipleCalls = proposal.targets.length > 1;

  // Get the current call data
  const currentTarget = hasMultipleCalls
    ? proposal.targets[selectedCallIndex]
    : proposal.targets[0];
  const currentValue = hasMultipleCalls
    ? proposal.values[selectedCallIndex].toString()
    : proposal.values[0].toString();
  const currentSignature = hasMultipleCalls
    ? proposal.signatures[selectedCallIndex]
    : proposal.signatures[0];
  const currentCalldata = hasMultipleCalls
    ? proposal.calldatas[selectedCallIndex]
    : proposal.calldatas[0];

  return (
    <Card className={`w-full ${className || ''} border border-muted`}>
      <CardHeader className="px-6">
        <CardTitle>Proposal Creation</CardTitle>
        <CardDescription>Transaction Parameters</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 px-6">
        {hasMultipleCalls && (
          <div className="mb-4">
            <h3 className="font-medium text-sm mb-2">Select Call</h3>
            <div className="flex flex-wrap gap-2">
              {proposal.targets.map((_: string, index: number) => (
                <Button
                  key={`call-target-${proposal.targets[index]}-${index}`}
                  variant={selectedCallIndex === index ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCallIndex(index)}
                  className="cursor-pointer"
                >
                  Call {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="font-medium text-sm mb-2">Target Contract</h3>
          <p className="font-mono text-sm break-all bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentTarget}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">ETH Value</h3>
          <p className="font-mono text-sm bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentValue}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">Function Signature</h3>
          <p className="font-mono text-sm bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentSignature || '(empty)'}
          </p>
        </div>

        <div>
          <h3 className="font-medium text-sm mb-2">Encoded Function Data</h3>
          <p className="font-mono text-sm break-all bg-muted p-3 rounded-md min-h-[40px] flex items-center">
            {currentCalldata}
          </p>
        </div>

        {hasMultipleCalls && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing call {selectedCallIndex + 1} of {proposal.targets.length}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between items-center border-t py-4 px-6 mt-auto">
        <div className="flex items-center text-sm text-muted-foreground">
          <CheckCircleIcon className="h-4 w-4 mr-2 text-green-500" />
          Ready to propose
        </div>
        <Button
          onClick={onPropose}
          disabled={isPending || isPendingConfirmation || !isConnected}
          size="lg"
          className="ml-6 px-6 font-medium cursor-pointer"
        >
          {!isConnected
            ? 'Connect Wallet'
            : isPendingConfirmation
              ? 'Confirming...'
              : isPending
                ? 'Creating...'
                : 'Propose'}
        </Button>
      </CardFooter>
    </Card>
  );
}
