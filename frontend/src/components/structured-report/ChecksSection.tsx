'use client';

import type {
  SimulationCheck,
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { AlertTriangleIcon, CheckCircleIcon, HelpCircleIcon, SkipForwardIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ExpandableCheckItem } from './ExpandableCheckItem';

interface ChecksSectionProps {
  checks: SimulationCheck[];
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}

export function ChecksSection({ checks, stateChanges, metadata }: ChecksSectionProps) {
  const grouped = useMemo(() => {
    const failed = checks.filter((c) => c.status === 'failed');
    const warning = checks.filter((c) => c.status === 'warning');
    const inconclusive = checks.filter((c) => c.status === 'inconclusive');
    const skipped = checks.filter((c) => c.status === 'skipped');
    const passed = checks.filter((c) => c.status === 'passed');
    return { failed, warning, inconclusive, skipped, passed };
  }, [checks]);

  const failedCount = grouped.failed.length;
  const warningCount = grouped.warning.length;
  const inconclusiveCount = grouped.inconclusive.length;
  const passedCount = grouped.passed.length;
  const skippedCount = grouped.skipped.length;

  const orderedChecks = useMemo(() => {
    return [
      ...grouped.failed,
      ...grouped.warning,
      ...grouped.inconclusive,
      ...grouped.skipped,
      ...grouped.passed,
    ];
  }, [grouped]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <span className="text-sm font-medium text-muted-foreground">Summary:</span>
        {passedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <CheckCircleIcon className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium text-green-700">{passedCount} passed</span>
          </div>
        )}
        {warningCount > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangleIcon className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-700">{warningCount} warning</span>
          </div>
        )}
        {failedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangleIcon className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-red-700">{failedCount} failed</span>
          </div>
        )}
        {inconclusiveCount > 0 && (
          <div className="flex items-center gap-1.5">
            <HelpCircleIcon className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {inconclusiveCount} inconclusive
            </span>
          </div>
        )}
        {skippedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <SkipForwardIcon className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-500">{skippedCount} skipped</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {orderedChecks.map((check, index) => (
          <ExpandableCheckItem
            key={`check-${check.title}-${index}`}
            check={check}
            stateChanges={stateChanges}
            metadata={metadata}
          />
        ))}
      </div>
    </div>
  );
}
