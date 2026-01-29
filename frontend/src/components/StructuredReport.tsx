'use client';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Proposal, StructuredSimulationReport } from '@/hooks/use-simulation-results';
import { ExternalLinkIcon, InfoIcon } from 'lucide-react';
import { DecisionHeader } from './DecisionHeader';
import { ChainLogo } from './structured-report/ChainLogo';
import { ChecksSection } from './structured-report/ChecksSection';
import { CrossChainChecksSummary } from './structured-report/CrossChainChecksSummary';
import { CrossChainPreview } from './structured-report/CrossChainPreview';
import { MetadataItem } from './structured-report/MetadataItem';
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
  proposal?: Proposal;
}

export function StructuredReport({ report }: StructuredReportProps) {
  const blockNumber =
    report.metadata.simulationBlockNumber || report.metadata.blockNumber || 'unknown';
  const timestamp = report.metadata.simulationTimestamp || report.metadata.timestamp || '0';

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

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-10 sm:h-11">
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="checks">
            Checks
          </TabsTrigger>
          <TabsTrigger className="cursor-pointer text-xs sm:text-sm" value="state-changes">
            State Changes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          {report.crossChain?.messages?.length ? (
            <section>
              <h3 className="text-sm sm:text-base font-semibold mb-2">Cross-Chain Preview</h3>
              <CrossChainPreview messages={report.crossChain.messages} />
            </section>
          ) : null}

          {report.proposalText && (
            <section>
              <h3 className="text-sm sm:text-base font-semibold mb-2">Proposal Details</h3>
              <div className="bg-muted p-3 sm:p-4 rounded-lg text-sm whitespace-pre-wrap break-words">
                {report.proposalText}
              </div>
            </section>
          )}

          {report.calldata && (
            <section>
              <h3 className="text-sm sm:text-base font-semibold mb-2">Calldata Decoded</h3>
              <div className="bg-muted p-3 sm:p-4 rounded-lg font-mono text-xs sm:text-sm overflow-x-auto">
                {report.calldata.decoded}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm sm:text-base font-semibold mb-2">Metadata</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <MetadataItem label="Block Number">
                <a
                  href={buildBlockLink(blockNumber, report.metadata)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs hover:underline inline-flex items-center gap-1"
                >
                  {blockNumber}
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </MetadataItem>
              <MetadataItem label="Timestamp">
                {new Date(Number.parseInt(timestamp) * 1000).toLocaleString()}
              </MetadataItem>
              <MetadataItem label="Proposal ID">{report.metadata.proposalId}</MetadataItem>
              <MetadataItem label="Network">{report.metadata.chainName || 'Ethereum'}</MetadataItem>
              <MetadataItem label="Proposer" fullWidth>
                <div className="flex items-center gap-2 flex-wrap">
                  {getAddressLabel(report.metadata.proposer, report.metadata) && (
                    <span className="font-medium text-sm">
                      {getAddressLabel(report.metadata.proposer, report.metadata)}
                    </span>
                  )}
                  <a
                    href={buildAddressLink(report.metadata.proposer, report.metadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs hover:underline inline-flex items-center gap-1 break-all text-muted-foreground"
                  >
                    <span className="hidden sm:inline">
                      {report.metadata.proposer.slice(0, 6)}...{report.metadata.proposer.slice(-4)}
                    </span>
                    <span className="sm:hidden">
                      {report.metadata.proposer.slice(0, 6)}...{report.metadata.proposer.slice(-4)}
                    </span>
                    <ExternalLinkIcon className="h-3 w-3 shrink-0" />
                  </a>
                  {report.metadata.proposerIsPlaceholder && <SimulationPlaceholderBadge />}
                </div>
              </MetadataItem>
              {report.metadata.executor && (
                <MetadataItem label={getExecutorLabel(report.metadata.simulationType)} fullWidth>
                  <div className="flex items-center gap-2 flex-wrap">
                    {getAddressLabel(report.metadata.executor, report.metadata) && (
                      <span className="font-medium text-sm">
                        {getAddressLabel(report.metadata.executor, report.metadata)}
                      </span>
                    )}
                    <a
                      href={buildAddressLink(report.metadata.executor, report.metadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs hover:underline inline-flex items-center gap-1 break-all text-muted-foreground"
                    >
                      <span>
                        {report.metadata.executor.slice(0, 6)}...
                        {report.metadata.executor.slice(-4)}
                      </span>
                      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
                    </a>
                    {report.metadata.executorIsPlaceholder && <SimulationPlaceholderBadge />}
                  </div>
                </MetadataItem>
              )}
              {report.metadata.governorAddress && (
                <MetadataItem label="Governor" fullWidth>
                  <div className="flex items-center gap-2 flex-wrap">
                    {getAddressLabel(report.metadata.governorAddress, report.metadata) && (
                      <span className="font-medium text-sm">
                        {getAddressLabel(report.metadata.governorAddress, report.metadata)}
                      </span>
                    )}
                    <a
                      href={buildAddressLink(report.metadata.governorAddress, report.metadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs hover:underline inline-flex items-center gap-1 break-all text-muted-foreground"
                    >
                      <span>
                        {report.metadata.governorAddress.slice(0, 6)}...
                        {report.metadata.governorAddress.slice(-4)}
                      </span>
                      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                </MetadataItem>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="checks" className="mt-4 space-y-4">
          {report.crossChain?.messages?.length ? (
            <CrossChainChecksSummary messages={report.crossChain.messages} />
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
                  />
                )}
              </section>
            );
          })}
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
