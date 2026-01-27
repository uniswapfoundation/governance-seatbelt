import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { ReactNode } from 'react';
import { buildBlockLink } from './StructuredReport';

interface DecisionHeaderProps {
  report: StructuredSimulationReport;
}

export function DecisionHeader({ report }: DecisionHeaderProps) {
  const checks = report.checks ?? [];
  const skippedChecks = checks.filter((check) => check.status === 'skipped');
  const skippedCount = skippedChecks.length;
  const totalChecks = checks.length;
  const ranChecks = Math.max(0, totalChecks - skippedCount);

  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const failureCount = checks.filter((check) => check.status === 'failed').length;

  const timestamp = report.metadata.simulationTimestamp || report.metadata.timestamp || '0';
  const age = formatRelativeTime(timestamp);
  const localTime = formatLocalTime(timestamp);

  const blockNumber = report.metadata.simulationBlockNumber || report.metadata.blockNumber;

  const proposalId = report.metadata.proposalId;
  const showProposalId = proposalId && !report.title.includes(`#${proposalId}`);

  const repoCommit = report.metadata.repoCommit;
  const repoUrl = report.metadata.repoUrl;
  const tenderlyUrl = report.metadata.tenderlyUrl;

  const repoName = repoUrl ? repoUrl.split('/').slice(-2).join('/') : 'Repository';

  const statusExplanation =
    report.status === 'warning' && warningCount > 0
      ? `Warnings in ${warningCount} check${warningCount === 1 ? '' : 's'}`
      : report.status === 'error' && failureCount > 0
        ? `Failed ${failureCount} check${failureCount === 1 ? '' : 's'}`
        : skippedCount > 0
          ? `${skippedCount} check${skippedCount === 1 ? ' was' : 's were'} skipped (not applicable)`
          : null;

  const statusExplanationDetails =
    skippedCount > 0
      ? skippedChecks
          .slice(0, 10)
          .map((c) => `${c.title}${c.skipReason ? ` — ${c.skipReason}` : ''}`)
          .join('\n')
      : null;

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden mb-4">
      {/* Header section */}
      <div className="bg-muted/50 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Top row: Status + Repo link */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={report.status} />
              {showProposalId && (
                <Badge
                  variant="outline"
                  className="font-mono text-xs sm:text-sm text-muted-foreground h-7 sm:h-8 px-2 sm:px-3 bg-background"
                >
                  #{proposalId}
                </Badge>
              )}
            </div>

            {repoCommit && repoUrl && (
              <Button variant="outline" size="sm" className="h-7 sm:h-8 gap-1.5 text-xs" asChild>
                <a
                  href={`${repoUrl}/commit/${repoCommit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GithubIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline font-medium">{repoName}</span>
                </a>
              </Button>
            )}
          </div>

          {/* Title + Summary */}
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold tracking-tight text-foreground leading-tight">
              {report.title}
            </h1>
            {report.summary && (
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-2">
                {report.summary.split('. ')[0]}
              </p>
            )}
            {statusExplanation ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="inline-flex items-center gap-1 text-xs text-muted-foreground w-fit cursor-help">
                      <HelpCircleIcon className="h-3.5 w-3.5" />
                      <span>{statusExplanation}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm whitespace-pre-line">
                    {statusExplanationDetails ??
                      'This status is derived from check results. Skipped checks usually indicate the check was not applicable to this proposal.'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
      </div>

      {/* Stats grid - responsive: 2 cols on mobile, 4 cols on lg+ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border/60">
        {/* Checks */}
        <StatItem icon={<ShieldCheckIcon className="h-4 w-4" />} label="Checks">
          <span className="text-sm font-medium">{ranChecks} executed</span>
          {warningCount > 0 || failureCount > 0 || skippedCount > 0 ? (
            <div className="flex gap-1 flex-wrap">
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
              {skippedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="bg-slate-200 text-slate-800 hover:bg-slate-200 border-slate-300 h-5 px-1.5 text-[10px]"
                >
                  {skippedCount} skipped
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
        </StatItem>

        {/* Time */}
        <StatItem icon={<ClockIcon className="h-4 w-4" />} label="Time">
          <span className="text-sm font-medium">{age}</span>
          <span className="text-xs text-muted-foreground">{localTime}</span>
        </StatItem>

        {/* Network */}
        <StatItem icon={<GlobeIcon className="h-4 w-4" />} label="Network">
          <span className="text-sm font-medium">{report.metadata.chainName || 'Ethereum'}</span>
          {blockNumber && blockNumber !== 'unknown' ? (
            <a
              href={buildBlockLink(blockNumber, report.metadata)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            >
              Block {blockNumber}
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          ) : null}
        </StatItem>

        {/* Simulation */}
        <StatItem icon={<ActivityIcon className="h-4 w-4" />} label="Simulation">
          {tenderlyUrl ? (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1.5 bg-[#646cff] hover:bg-[#646cff]/90 text-white border-transparent"
              asChild
            >
              <a href={tenderlyUrl} target="_blank" rel="noopener noreferrer">
                View on Tenderly
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Not available</span>
          )}
        </StatItem>
      </div>
    </div>
  );
}

// Reusable stat item component
function StatItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="p-3 sm:p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="flex flex-col items-start gap-1">{children}</div>
    </div>
  );
}

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

const STATUS_TOOLTIPS = {
  success: 'All checks passed successfully',
  warning: 'Some checks produced warnings that may need review',
  error: 'One or more checks failed - review required before proceeding',
  inconclusive:
    'Some checks were skipped or could not complete. This may occur when contract verification is unavailable or simulation data is incomplete.',
};

function StatusBadge({ status }: { status: 'success' | 'warning' | 'error' | 'inconclusive' }) {
  const badge = (() => {
    switch (status) {
      case 'success':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100 gap-1 sm:gap-1.5 px-2 sm:px-3 h-7 sm:h-8 text-xs sm:text-sm cursor-help">
            <CheckCircleIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600" />
            PASS
          </Badge>
        );
      case 'warning':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100 gap-1 sm:gap-1.5 px-2 sm:px-3 h-7 sm:h-8 text-xs sm:text-sm cursor-help">
            <AlertTriangleIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-600" />
            WARN
          </Badge>
        );
      case 'inconclusive':
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100 gap-1 sm:gap-1.5 px-2 sm:px-3 h-7 sm:h-8 text-xs sm:text-sm cursor-help">
            <HelpCircleIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-600" />
            <span className="hidden xs:inline">INCONCLUSIVE</span>
            <span className="xs:hidden">N/A</span>
          </Badge>
        );
      case 'error':
        return (
          <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100 gap-1 sm:gap-1.5 px-2 sm:px-3 h-7 sm:h-8 text-xs sm:text-sm cursor-help">
            <XCircleIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-600" />
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
