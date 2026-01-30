'use client';

import type {
  CheckCoverage,
  SimulationCheck,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { ChainLogo } from './ChainLogo';

type CheckOutcome = 'passed' | 'warning' | 'failed' | 'not_applicable' | 'not_run';

export function getOutcome(check: SimulationCheck, coverage?: CheckCoverage): CheckOutcome {
  if (check.status === 'failed') return 'failed';
  if (check.status === 'warning') return 'warning';
  if (check.status === 'skipped') return 'not_applicable';

  if (coverage?.status === 'skipped') return 'not_applicable';
  if (coverage?.status === 'failed') return 'not_run';

  return 'passed';
}

interface CoverageSummaryProps {
  report: StructuredSimulationReport;
  onNavigateToChecks?: () => void;
}

export function CoverageSummary({ report, onNavigateToChecks }: CoverageSummaryProps) {
  const coverage = report.coverage;
  if (!coverage || coverage.checks.length === 0) return null;

  // Group coverage entries by chainId to show per-chain coverage stats
  const coverageByChain = coverage.checks.reduce<Record<string, CheckCoverage[]>>((acc, entry) => {
    const chainKey = String(entry.chainId ?? report.metadata.chainId ?? 'unknown');
    if (!acc[chainKey]) acc[chainKey] = [];
    acc[chainKey].push(entry);
    return acc;
  }, {});

  // Get chain names from chainReports if available
  const chainNames = new Map<number, string>();
  if (report.chainReports) {
    for (const chainReport of report.chainReports) {
      chainNames.set(chainReport.chainId, chainReport.chainName);
    }
  }
  if (report.metadata.chainId && report.metadata.chainName) {
    chainNames.set(report.metadata.chainId, report.metadata.chainName);
  }

  const chainEntries = Object.entries(coverageByChain).sort(([a], [b]) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return Number(a) - Number(b);
  });

  const summarizeCoverage = (entries: CheckCoverage[]) => {
    const counts = { ran: 0, skipped: 0, failed: 0, inferred: 0 };
    for (const entry of entries) {
      if (entry.status === 'ran') counts.ran += 1;
      else if (entry.status === 'skipped') counts.skipped += 1;
      else if (entry.status === 'failed') counts.failed += 1;
      if (entry.wasInferred) counts.inferred += 1;
    }
    return counts;
  };

  const StatsDisplay = ({ stats }: { stats: ReturnType<typeof summarizeCoverage> }) => {
    const content = (
      <span className="text-sm text-muted-foreground">
        {stats.ran} ran • {stats.skipped} skipped • {stats.failed} failed
        {stats.inferred > 0 ? ` • ${stats.inferred} inferred` : ''}
      </span>
    );

    if (onNavigateToChecks) {
      return (
        <button
          type="button"
          onClick={onNavigateToChecks}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
        >
          {stats.ran} ran • {stats.skipped} skipped • {stats.failed} failed
          {stats.inferred > 0 ? ` • ${stats.inferred} inferred` : ''}
        </button>
      );
    }

    return content;
  };

  return (
    <div className="space-y-2">
      {chainEntries.map(([chainId, entries]) => {
        const stats = summarizeCoverage(entries);
        const chainIdNum = chainId !== 'unknown' ? Number(chainId) : null;
        const chainName = chainIdNum ? chainNames.get(chainIdNum) : null;
        const chainLabel = chainName || (chainId === 'unknown' ? 'Unknown' : `Chain ${chainId}`);

        return (
          <div key={chainId} className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {chainIdNum && <ChainLogo chainId={chainIdNum} size={16} />}
              {chainLabel}
            </div>
            <StatsDisplay stats={stats} />
          </div>
        );
      })}
    </div>
  );
}
