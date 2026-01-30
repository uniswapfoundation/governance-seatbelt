'use client';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  CheckCoverage,
  Proposal,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { ExternalLinkIcon, InfoIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CallGroupedView } from './CallGroupedView';
import { DecisionHeader } from './DecisionHeader';
import { ChainLogo } from './structured-report/ChainLogo';
import { ChecksSection } from './structured-report/ChecksSection';
import { CoverageSummary } from './structured-report/CoverageSummary';
import { CrossChainChecksSummary } from './structured-report/CrossChainChecksSummary';
import { CrossChainPreview } from './structured-report/CrossChainPreview';
import { SimulationPlaceholderBadge } from './structured-report/SimulationPlaceholderBadge';
import { SimulationWarningBanner } from './structured-report/SimulationWarningBanner';
import { StateChanges } from './structured-report/StateChanges';
import {
  buildAddressLink,
  buildBlockLink,
  getAddressLabel,
  getExecutorLabel,
} from './structured-report/explorer';

export { buildBlockLink } from './structured-report/explorer';

interface StructuredReportProps {
  report: StructuredSimulationReport;
  proposal: Proposal;
}

export function StructuredReport({ report, proposal }: StructuredReportProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const blockNumber =
    report.metadata.simulationBlockNumber || report.metadata.blockNumber || 'unknown';
  const timestamp = report.metadata.simulationTimestamp || report.metadata.timestamp || '0';

  const coverageByCheckId = useMemo(() => {
    const map = new Map<string, CheckCoverage>();
    for (const coverageEntry of report.coverage?.checks ?? []) {
      if (coverageEntry.chainId) {
        map.set(`${coverageEntry.chainId}:${coverageEntry.checkId}`, coverageEntry);
      }
      // Back-compat fallback when chainId isn't available.
      map.set(coverageEntry.checkId, coverageEntry);
    }
    return map;
  }, [report.coverage?.checks]);

  const mainChainId = report.metadata.chainId ?? 1;
  const chainReports = report.chainReports?.length
    ? report.chainReports
    : [
        {
          chainId: mainChainId,
          chainName: report.metadata.chainName || 'Ethereum',
          blockExplorerBaseUrl: report.metadata.blockExplorerBaseUrl,
          status:
            report.status === 'error'
              ? 'error'
              : report.status === 'warning'
                ? 'warning'
                : report.status === 'inconclusive'
                  ? 'inconclusive'
                  : 'success',
          checks: report.checks,
          stateChanges: report.stateChanges,
          events: report.events,
        },
      ];

  return (
    <div className="w-full space-y-4">
      <DecisionHeader report={report} />

      <SimulationWarningBanner metadata={report.metadata} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-10 sm:h-11">
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="checks">
            Checks
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="calls">
            Calls
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="state-changes">
            State Changes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          {/* Primary: Execution Summary - Coverage + Cross-Chain in a prominent grid */}
          {(report.coverage?.checks?.length || report.crossChain?.messages?.length) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {report.coverage && report.coverage.checks.length > 0 && (
                <section className="rounded-lg border-2 border-border bg-card p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Check Coverage
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('checks')}
                      className="text-xs text-primary hover:underline"
                    >
                      View all checks →
                    </button>
                  </div>
                  <CoverageSummary
                    report={report}
                    onNavigateToChecks={() => setActiveTab('checks')}
                  />
                </section>
              )}

              {report.crossChain?.messages?.length ? (
                <section className="rounded-lg border-2 border-border bg-card p-4 sm:p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                    Cross-Chain Messages
                  </h3>
                  <CrossChainPreview messages={report.crossChain.messages} />
                </section>
              ) : null}
            </div>
          )}

          {/* Secondary: Proposal Details - Full width, less prominent */}
          {report.proposalText && (
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Proposal Details
              </h3>
              <div className="bg-muted/50 border border-border/50 p-4 rounded-lg text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {report.proposalText}
              </div>
            </section>
          )}

          {/* Tertiary: Technical Details - Collapsible or compact */}
          <div className="border-t border-border/50 pt-4">
            <details className="group">
              <summary className="text-sm font-semibold uppercase tracking-wide text-muted-foreground cursor-pointer select-none flex items-center gap-2 mb-3">
                <span className="transition-transform group-open:rotate-90">▸</span>
                Technical Details
              </summary>

              <div className="space-y-4 pl-4">
                {report.calldata && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">
                      Calldata Decoded
                    </h4>
                    <div className="bg-muted/30 border border-border/30 p-3 rounded font-mono text-xs overflow-x-auto max-h-32 overflow-y-auto">
                      {report.calldata.decoded}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Block</span>
                    <a
                      href={buildBlockLink(blockNumber, report.metadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:underline inline-flex items-center gap-1"
                    >
                      {blockNumber}
                      <ExternalLinkIcon className="h-3 w-3" />
                    </a>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Timestamp</span>
                    <span>{new Date(Number.parseInt(timestamp) * 1000).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Proposal ID</span>
                    <span className="font-mono">{report.metadata.proposalId}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Network</span>
                    <span>{report.metadata.chainName || 'Ethereum'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Proposer</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {getAddressLabel(report.metadata.proposer, report.metadata) && (
                        <span className="font-medium">
                          {getAddressLabel(report.metadata.proposer, report.metadata)}
                        </span>
                      )}
                      <a
                        href={buildAddressLink(report.metadata.proposer, report.metadata)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono hover:underline inline-flex items-center gap-1 text-muted-foreground"
                      >
                        {report.metadata.proposer.slice(0, 6)}...
                        {report.metadata.proposer.slice(-4)}
                        <ExternalLinkIcon className="h-3 w-3" />
                      </a>
                      {report.metadata.proposerIsPlaceholder && <SimulationPlaceholderBadge />}
                    </div>
                  </div>
                  {report.metadata.executor && (
                    <div>
                      <span className="text-muted-foreground block">
                        {getExecutorLabel(report.metadata.simulationType)}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getAddressLabel(report.metadata.executor, report.metadata) && (
                          <span className="font-medium">
                            {getAddressLabel(report.metadata.executor, report.metadata)}
                          </span>
                        )}
                        <a
                          href={buildAddressLink(report.metadata.executor, report.metadata)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono hover:underline inline-flex items-center gap-1 text-muted-foreground"
                        >
                          {report.metadata.executor.slice(0, 6)}...
                          {report.metadata.executor.slice(-4)}
                          <ExternalLinkIcon className="h-3 w-3" />
                        </a>
                        {report.metadata.executorIsPlaceholder && <SimulationPlaceholderBadge />}
                      </div>
                    </div>
                  )}
                  {report.metadata.governorAddress && (
                    <div>
                      <span className="text-muted-foreground block">Governor</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getAddressLabel(report.metadata.governorAddress, report.metadata) && (
                          <span className="font-medium">
                            {getAddressLabel(report.metadata.governorAddress, report.metadata)}
                          </span>
                        )}
                        <a
                          href={buildAddressLink(report.metadata.governorAddress, report.metadata)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono hover:underline inline-flex items-center gap-1 text-muted-foreground"
                        >
                          {report.metadata.governorAddress.slice(0, 6)}...
                          {report.metadata.governorAddress.slice(-4)}
                          <ExternalLinkIcon className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>
        </TabsContent>

        <TabsContent value="checks" className="mt-4 space-y-4">
          {report.crossChain?.messages?.length ? (
            <CrossChainChecksSummary
              messages={report.crossChain.messages}
              onNavigateToChain={(chainId) => {
                const el = document.getElementById(`chain-checks-${chainId}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          ) : null}

          {chainReports.map((chainReport) => {
            const isMainChain = chainReport.chainId === mainChainId;
            const effectiveMetadata = {
              ...report.metadata,
              chainId: chainReport.chainId,
              chainName: chainReport.chainName,
              blockExplorerBaseUrl:
                chainReport.blockExplorerBaseUrl || report.metadata.blockExplorerBaseUrl,
            };

            return (
              <section
                key={`chain-checks-${chainReport.chainId}`}
                id={`chain-checks-${chainReport.chainId}`}
                className="rounded-lg border border-border/60 bg-card/50 p-4 sm:p-6 space-y-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-2 cursor-default">
                          <ChainLogo chainId={chainReport.chainId} size={24} />
                          {chainReport.chainName}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Chain ID: {chainReport.chainId}</TooltipContent>
                    </Tooltip>
                    {isMainChain && (
                      <Badge variant="secondary" className="text-xs font-normal">
                        main chain
                      </Badge>
                    )}
                  </h3>
                  <Badge
                    variant="outline"
                    className={
                      chainReport.status === 'error'
                        ? 'bg-red-100 text-red-800 border-red-300'
                        : chainReport.status === 'warning'
                          ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                          : chainReport.status === 'inconclusive'
                            ? 'bg-slate-100 text-slate-700 border-slate-300'
                            : 'bg-green-100 text-green-800 border-green-300'
                    }
                  >
                    {chainReport.status === 'error'
                      ? 'Errors'
                      : chainReport.status === 'warning'
                        ? 'Warnings'
                        : chainReport.status === 'inconclusive'
                          ? 'Inconclusive'
                          : 'Passed'}
                  </Badge>
                </div>

                {chainReport.checks.length === 0 ? (
                  <div className="flex items-center justify-center p-4 sm:p-6 text-muted-foreground bg-muted/50 rounded-lg text-sm">
                    <InfoIcon className="h-4 w-4 mr-2 shrink-0" />
                    <span>No checks found for this chain</span>
                  </div>
                ) : (
                  <ChecksSection
                    checks={chainReport.checks}
                    stateChanges={chainReport.stateChanges}
                    metadata={effectiveMetadata}
                    coverageByCheckId={coverageByCheckId}
                    permissionsDiff={report.permissionsDiff}
                  />
                )}
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="calls" className="mt-4 space-y-4">
          <CallGroupedView proposal={proposal} report={report} />
        </TabsContent>

        <TabsContent value="state-changes" className="mt-4 space-y-4">
          {chainReports.map((chainReport) => {
            const isMainChain = chainReport.chainId === mainChainId;
            const effectiveMetadata = {
              ...report.metadata,
              chainId: chainReport.chainId,
              chainName: chainReport.chainName,
              blockExplorerBaseUrl:
                chainReport.blockExplorerBaseUrl || report.metadata.blockExplorerBaseUrl,
            };

            return (
              <section
                key={`chain-state-changes-${chainReport.chainId}`}
                className="rounded-lg border border-border/60 bg-card/50 p-4 sm:p-6 space-y-4"
              >
                <h3 className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-2 cursor-default">
                        <ChainLogo chainId={chainReport.chainId} size={24} />
                        {chainReport.chainName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Chain ID: {chainReport.chainId}</TooltipContent>
                  </Tooltip>
                  {isMainChain && (
                    <Badge variant="secondary" className="text-xs font-normal">
                      main chain
                    </Badge>
                  )}
                </h3>
                <StateChanges
                  stateChanges={chainReport.stateChanges}
                  metadata={effectiveMetadata}
                />
              </section>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
