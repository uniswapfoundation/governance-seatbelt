import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  GithubIcon,
  GlobeIcon,
  HelpCircleIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from 'lucide-react';
import { buildBlockLink } from './StructuredReport';

interface DecisionHeaderProps {
  report: StructuredSimulationReport;
}

export function DecisionHeader({ report }: DecisionHeaderProps) {
  const checks = report.checks ?? [];
  const ranChecks = checks.length;

  // Count warnings and failures for display
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const failureCount = checks.filter((check) => check.status === 'failed').length;

  // Get timestamp with fallback for legacy format
  const timestamp = report.metadata.simulationTimestamp || report.metadata.timestamp || '0';
  const age = formatRelativeTime(timestamp);
  const localTime = formatLocalTime(timestamp);

  // Get block number with fallback for legacy format
  const blockNumber = report.metadata.simulationBlockNumber || report.metadata.blockNumber;

  // Extract proposal ID - check if it's already in the title
  const proposalId = report.metadata.proposalId;
  const showProposalId = proposalId && !report.title.includes(`#${proposalId}`);

  // Get repository and Tenderly information
  const repoCommit = report.metadata.repoCommit;
  const repoUrl = report.metadata.repoUrl;
  const tenderlyUrl = report.metadata.tenderlyUrl;

  // Extract repo name if available
  const repoName = repoUrl ? repoUrl.split('/').slice(-2).join('/') : 'Repository';

  return (
    <Card className="mb-6 overflow-hidden border-border/60 shadow-none p-0 gap-0">
      <div className="border-b bg-slate-100 dark:bg-muted/80 px-6 py-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge status={report.status} />
              {showProposalId && (
                <Badge
                  variant="outline"
                  className="font-mono text-sm text-muted-foreground h-8 px-3 bg-background"
                >
                  #{proposalId}
                </Badge>
              )}
            </div>

            {repoCommit && repoUrl && (
              <Button variant="outline" size="sm" className="h-8 gap-2" asChild>
                <a
                  href={`${repoUrl}/commit/${repoCommit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-4 w-4" />
                  <span className="font-medium text-xs">{repoName}</span>
                </a>
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{report.title}</h1>
            {report.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {report.summary.split('. ')[0]}
                {/* Show only the action summary, not the simulation status */}
              </p>
            )}
          </div>
        </div>
      </div>

      <CardContent className="grid grid-cols-1 divide-y md:grid-cols-4 md:divide-x md:divide-y-0 p-0">
        {/* Checks Column */}
        <div className="p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <ShieldCheckIcon className="h-4 w-4" />
            Checks
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium">{ranChecks} executed</span>
            {warningCount > 0 || failureCount > 0 ? (
              <div className="flex gap-1.5">
                {warningCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200 h-5 px-1.5 text-[10px]"
                  >
                    {warningCount} warn
                  </Badge>
                )}
                {failureCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200 h-5 px-1.5 text-[10px]"
                  >
                    {failureCount} fail
                  </Badge>
                )}
              </div>
            ) : (
              <Badge
                variant="outline"
                className="text-green-600 border-green-200 bg-green-50 h-5 px-1.5 text-[10px]"
              >
                All Passed
              </Badge>
            )}
          </div>
        </div>

        {/* Time Column */}
        <div className="p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <ClockIcon className="h-4 w-4" />
            Time
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <div className="text-sm font-medium">{age}</div>
            <div className="text-xs text-muted-foreground">{localTime}</div>
          </div>
        </div>

        {/* Network Column */}
        <div className="p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <GlobeIcon className="h-4 w-4" />
            Network
          </div>
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium">{report.metadata.chainName || 'Ethereum'}</span>
            {blockNumber && blockNumber !== 'unknown' && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 !px-0 text-xs text-muted-foreground hover:text-primary justify-start text-left"
                asChild
              >
                <a
                  href={buildBlockLink(blockNumber, report.metadata)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-1"
                >
                  Block {blockNumber}
                  <ExternalLinkIcon className="hidden group-hover:block h-3.5 w-3.5 ml-1" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Simulation Column */}
        <div className="p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <ActivityIcon className="h-4 w-4" />
            Simulation
          </div>
          <div>
            {tenderlyUrl ? (
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1.5 bg-[#646cff] hover:bg-[#646cff]/90 text-white border-transparent"
                asChild
              >
                <a href={tenderlyUrl} target="_blank" rel="noopener noreferrer">
                  View on Tenderly
                  <ExternalLinkIcon className="h-4 w-4" />
                </a>
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Not available</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper: Format relative time (static, not updating)
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = Number.parseInt(timestamp) * 1000;
  const diff = now - then;

  if (Number.isNaN(then) || then === 0) {
    return 'Unknown time';
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// Helper: Format local time
function formatLocalTime(timestamp: string): string {
  const ts = Number.parseInt(timestamp) * 1000;
  if (Number.isNaN(ts) || ts === 0) return '';

  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Status badge tooltip descriptions
const STATUS_TOOLTIPS = {
  success: 'All checks passed successfully',
  warning: 'Some checks produced warnings that may need review',
  error: 'One or more checks failed - review required before proceeding',
  inconclusive:
    'Some checks were skipped or could not complete. This may occur when contract verification is unavailable or simulation data is incomplete.',
};

// Helper: Status badge component with tooltip
function StatusBadge({
  status,
}: {
  status: 'success' | 'warning' | 'error' | 'inconclusive';
}) {
  const badge = (() => {
    switch (status) {
      case 'success':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 gap-1.5 px-3 h-8 text-sm cursor-help">
            <CheckCircleIcon className="h-4 w-4 text-green-600" />
            PASS
          </Badge>
        );
      case 'warning':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 gap-1.5 px-3 h-8 text-sm cursor-help">
            <AlertTriangleIcon className="h-4 w-4 text-yellow-600" />
            WARN
          </Badge>
        );
      case 'inconclusive':
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100 gap-1.5 px-3 h-8 text-sm cursor-help">
            <HelpCircleIcon className="h-4 w-4 text-gray-600" />
            INCONCLUSIVE
          </Badge>
        );
      case 'error':
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 gap-1.5 px-3 h-8 text-sm cursor-help">
            <XCircleIcon className="h-4 w-4 text-red-600" />
            FAIL
          </Badge>
        );
    }
  })();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{STATUS_TOOLTIPS[status]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
