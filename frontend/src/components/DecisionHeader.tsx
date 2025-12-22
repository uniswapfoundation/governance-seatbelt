import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';
import { 
  CheckCircleIcon, 
  AlertTriangleIcon, 
  XCircleIcon, 
  ExternalLinkIcon,
  GitCommitIcon,
  HelpCircleIcon
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
  const timestamp = report.metadata.simulationTimestamp || 
                   report.metadata.timestamp || 
                   '0';
  const age = formatRelativeTime(timestamp);
  
  // Get block number with fallback for legacy format
  const blockNumber = report.metadata.simulationBlockNumber || 
                     report.metadata.blockNumber;
  
  // Extract proposal ID - check if it's already in the title
  const proposalId = report.metadata.proposalId;
  const showProposalId = proposalId && !report.title.includes(`#${proposalId}`);

  // Get repository and Tenderly information
  const repoCommit = report.metadata.repoCommit;
  const repoUrl = report.metadata.repoUrl;
  const tenderlyUrl = report.metadata.tenderlyUrl;
  
  return (
    <div className="border border-muted rounded-md p-4 mb-4">
      {/* Main header line */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <StatusChip status={report.status} />
          <h1 className="text-xl font-bold">{report.title}</h1>
        </div>
        
        <div className="flex items-center gap-3 text-sm">
          {showProposalId && (
            <span className="text-muted-foreground">#{proposalId}</span>
          )}
          {repoCommit && repoUrl && (
            <a
              href={`${repoUrl}/commit/${repoCommit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:underline inline-flex items-center gap-1"
            >
              <GitCommitIcon className="h-3 w-3" />
              <span className="font-mono text-xs">repo@{repoCommit.slice(0, 8)}</span>
            </a>
          )}
        </div>
      </div>
      
      {/* Info line */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <span>Ran {ranChecks}/{ranChecks} checks</span>
        {(warningCount > 0 || failureCount > 0) && (
          <>
            <span>•</span>
            <div className="flex items-center gap-2">
              {warningCount > 0 && <span>Warnings: {warningCount}</span>}
              {warningCount > 0 && failureCount > 0 && <span>•</span>}
              {failureCount > 0 && <span>Failures: {failureCount}</span>}
            </div>
          </>
        )}
        <span>•</span>
        <span>{age}</span>
        {blockNumber && blockNumber !== 'unknown' && (
          <>
            <span>•</span>
            <a 
              href={buildBlockLink(blockNumber, report.metadata)} 
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center"
            >
              Block {blockNumber}
              <ExternalLinkIcon className="h-3 w-3 ml-1" />
            </a>
          </>
        )}
        <span>•</span>
        <span>{report.metadata.chainName || 'Ethereum'}</span>
        {tenderlyUrl && (
          <>
            <span>•</span>
            <a
              href={tenderlyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center"
            >
              Tenderly
              <ExternalLinkIcon className="h-3 w-3 ml-1" />
            </a>
          </>
        )}
      </div>

      {/* Summary line - preserved from original layout */}
      {report.summary && (
        <p className="text-muted-foreground text-sm mt-2">{report.summary}</p>
      )}
    </div>
  );
}

// Helper: Format relative time (static, not updating)
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = parseInt(timestamp) * 1000;
  const diff = now - then;
  
  if (isNaN(then) || then === 0) {
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

// Helper: Status chip component
function StatusChip({
  status,
}: {
  status: 'success' | 'warning' | 'error' | 'inconclusive';
}) {
  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 border border-green-300 px-3 py-1 text-sm font-semibold">
          <CheckCircleIcon className="h-4 w-4" />
          PASS
        </span>
      );
    case 'warning':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 px-3 py-1 text-sm font-semibold">
          <AlertTriangleIcon className="h-4 w-4" />
          WARN
        </span>
      );
    case 'inconclusive':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-800 border border-gray-300 px-3 py-1 text-sm font-semibold">
          <HelpCircleIcon className="h-4 w-4" />
          INCONCLUSIVE
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 border border-red-300 px-3 py-1 text-sm font-semibold">
          <XCircleIcon className="h-4 w-4" />
          FAIL
        </span>
      );
  }
}