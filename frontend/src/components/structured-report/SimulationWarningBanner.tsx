import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';
import { AlertTriangleIcon } from 'lucide-react';

interface SimulationWarningBannerProps {
  metadata: StructuredSimulationReport['metadata'];
}

export function SimulationWarningBanner({ metadata }: SimulationWarningBannerProps) {
  const hasPlaceholders = metadata.proposerIsPlaceholder || metadata.executorIsPlaceholder;
  const simulationType = metadata.simulationType;

  const getMessage = () => {
    if (simulationType === 'new') {
      return (
        <span className="leading-relaxed block">
          This is a simulation of a <strong>new proposal</strong> that has not been submitted
          on-chain yet.
          {hasPlaceholders && ' Placeholder addresses are being used for the proposer/executor.'}
        </span>
      );
    }
    if (simulationType === 'proposed') {
      return (
        <span className="leading-relaxed block">
          This is a simulation of a <strong>proposed</strong> governance action that has not yet
          been executed on-chain.
          {hasPlaceholders && ' Some addresses shown are simulation placeholders.'}
        </span>
      );
    }
    if (simulationType === 'executed') {
      return (
        <span className="leading-relaxed block">
          This is a <strong>re-simulation</strong> of an already executed proposal. Results shown
          reflect what the simulation produced, which may differ from actual on-chain execution.
        </span>
      );
    }
    return (
      <span className="leading-relaxed block">
        This report shows simulated execution results.
        {hasPlaceholders && ' Some addresses shown are simulation placeholders.'}
      </span>
    );
  };

  return (
    <Alert className="border-orange-300 bg-orange-50 flex flex-row items-start gap-2 p-3 sm:p-4">
      <AlertTriangleIcon className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <AlertTitle className="text-orange-800 font-semibold mb-0 leading-none text-sm">
          Simulated Execution
        </AlertTitle>
        <AlertDescription className="text-orange-700 text-xs sm:text-sm mt-0.5">
          {getMessage()}
        </AlertDescription>
      </div>
    </Alert>
  );
}
