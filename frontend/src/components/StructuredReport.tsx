'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  CheckCoverage,
  Proposal,
  SimulationCheck,
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  InfoIcon,
  SkipForwardIcon,
} from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { AddressLabel, useAddressLabel } from './AddressLabel';
import { CallGroupedView } from './CallGroupedView';
import { DecisionHeader } from './DecisionHeader';

// --- Explorer URL helpers ---

function getExplorerUrl(metadata: StructuredSimulationReport['metadata']): string {
  return metadata.blockExplorerBaseUrl || 'https://etherscan.io';
}

function buildAddressLink(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): string {
  const baseUrl = getExplorerUrl(metadata);
  return `${baseUrl}/address/${address}`;
}

export function buildBlockLink(
  blockNumber: string,
  metadata: StructuredSimulationReport['metadata'],
): string {
  const baseUrl = getExplorerUrl(metadata);
  return `${baseUrl}/block/${blockNumber}`;
}

function isPlaceholderAddress(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): boolean {
  if (!metadata.placeholderAddresses) return false;
  return metadata.placeholderAddresses.some(
    (placeholder) => placeholder.toLowerCase() === address.toLowerCase(),
  );
}

// --- Simulation warning components ---

function SimulationPlaceholderBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`bg-orange-100 text-orange-800 border-orange-300 text-xs ${className || ''}`}
    >
      Simulation Placeholder
    </Badge>
  );
}

interface SimulationWarningBannerProps {
  metadata: StructuredSimulationReport['metadata'];
}

function SimulationWarningBanner({ metadata }: SimulationWarningBannerProps) {
  const hasPlaceholders = metadata.proposerIsPlaceholder || metadata.executorIsPlaceholder;
  const simulationType = metadata.simulationType;

  // Determine the appropriate message based on simulation type
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
    // Fallback for unknown or missing simulation type
    return (
      <span className="leading-relaxed block">
        This report shows simulated execution results.
        {hasPlaceholders && ' Some addresses shown are simulation placeholders.'}
      </span>
    );
  };

  return (
    <Alert className="mb-4 border-orange-300 bg-orange-50 flex flex-row items-start gap-2 p-4">
      <AlertTriangleIcon className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1">
        <AlertTitle className="text-orange-800 font-semibold mb-0 leading-none">
          Simulated Execution
        </AlertTitle>
        <AlertDescription className="text-orange-700 text-sm mt-1">{getMessage()}</AlertDescription>
      </div>
    </Alert>
  );
}

// Create a new StateChanges component for reuse
interface StateChangesProps {
  stateChanges: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}

function StateChanges({ stateChanges, metadata }: StateChangesProps) {
  if (stateChanges.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground border border-muted rounded-md">
        <InfoIcon className="h-4 w-4 mr-2" />
        <span>No state changes found in the report</span>
      </div>
    );
  }

  // Create a default metadata for backwards compatibility
  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

  return (
    <div className="space-y-6">
      {/* Group state changes by contract */}
      {Object.entries(
        stateChanges.reduce<Record<string, SimulationStateChange[]>>((acc, change) => {
          // Contract always exists on change but may be generic
          const contractName = change.contract;

          // We'll keep the original contract name in the key for grouping
          const key = `${contractName}|${change.contractAddress || ''}`;

          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(change);
          return acc;
        }, {}),
      ).map(([contractKey, changes]) => {
        const [contractName, contractAddress] = contractKey.split('|');
        return (
          <div key={contractKey} className="space-y-3">
            {/* Contract header */}
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">
                {contractName === 'balances'
                  ? 'Token Balances'
                  : contractName === 'storage'
                    ? 'Contract Storage'
                    : contractName === 'code'
                      ? 'Contract Code'
                      : contractName}
                {contractAddress && (
                  <span className="ml-2 text-sm font-normal inline-flex items-center gap-2">
                    at{' '}
                    <a
                      href={buildAddressLink(contractAddress, effectiveMetadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                    >
                      {contractAddress}
                      <ExternalLinkIcon className="h-3 w-3 ml-1" />
                    </a>
                    {isPlaceholderAddress(contractAddress, effectiveMetadata) && (
                      <SimulationPlaceholderBadge />
                    )}
                  </span>
                )}
              </h3>
            </div>
            {/* State changes for this contract */}
            <div className="space-y-3 pl-2">
              {changes.map((change, index) => (
                <StateChangeItem
                  key={`state-${change.contract}-${change.key}-${index}`}
                  stateChange={change}
                  metadata={effectiveMetadata}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StructuredReportProps {
  report: StructuredSimulationReport;
  proposal: Proposal;
}

// Helper function for contextual executor labels
function getExecutorLabel(simulationType?: string): string {
  switch (simulationType) {
    case 'new':
      return 'Intended Executor';
    case 'proposed':
      return 'Will Execute';
    case 'executed':
      return 'Executed By';
    default:
      return 'Executor';
  }
}

type CheckOutcome = 'passed' | 'warning' | 'failed' | 'not_applicable' | 'not_run';

function getOutcome(check: SimulationCheck, coverage?: CheckCoverage): CheckOutcome {
  if (check.status === 'failed') return 'failed';
  if (check.status === 'warning') return 'warning';
  if (check.status === 'skipped') return 'not_applicable';

  if (coverage?.status === 'skipped') return 'not_applicable';
  if (coverage?.status === 'failed') return 'not_run';

  return 'passed';
}

function renderMarkdownLinks(text: string) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  match = regex.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const label = match[1];
    const url = match[2];

    parts.push(
      <a
        key={`${url}-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
      >
        {label}
        <ExternalLinkIcon className="h-3 w-3 ml-1" />
      </a>,
    );

    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  const hasLinks = parts.some((part) => typeof part !== 'string');
  if (!hasLinks) return text;

  return <span className="inline-flex flex-wrap items-center gap-1">{parts}</span>;
}

function CoverageSummary({
  report,
  coverageByCheckId,
}: {
  report: StructuredSimulationReport;
  coverageByCheckId: Map<string, CheckCoverage>;
}) {
  const coverage = report.coverage;
  if (!coverage || coverage.checks.length === 0) return null;

  const checksByChain = report.checks.reduce<Record<string, SimulationCheck[]>>((acc, check) => {
    const coverageEntry = check.checkId ? coverageByCheckId.get(check.checkId) : undefined;
    const chainKey = String(coverageEntry?.chainId ?? report.metadata.chainId ?? 'unknown');
    if (!acc[chainKey]) acc[chainKey] = [];
    acc[chainKey].push(check);
    return acc;
  }, {});

  const chainEntries = Object.entries(checksByChain).sort(([a], [b]) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return Number(a) - Number(b);
  });

  const summarize = (checks: SimulationCheck[]) => {
    const counts = {
      passed: 0,
      warning: 0,
      failed: 0,
      notApplicable: 0,
      notRun: 0,
      inferred: 0,
    };

    for (const check of checks) {
      const coverageEntry = check.checkId ? coverageByCheckId.get(check.checkId) : undefined;
      const outcome = getOutcome(check, coverageEntry);
      if (coverageEntry?.wasInferred) counts.inferred += 1;

      if (outcome === 'passed') counts.passed += 1;
      else if (outcome === 'warning') counts.warning += 1;
      else if (outcome === 'failed') counts.failed += 1;
      else if (outcome === 'not_run') counts.notRun += 1;
      else counts.notApplicable += 1;
    }

    return counts;
  };

  const overallSummary = summarize(report.checks);

  return (
    <div className="border border-muted rounded-md p-4 bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-semibold">Coverage</h3>
        <div className="text-sm text-muted-foreground space-y-1 text-right">
          <div>
            {overallSummary.passed} passed • {overallSummary.notApplicable} not applicable •{' '}
            {overallSummary.warning} warnings • {overallSummary.failed} failed
            {overallSummary.notRun > 0 ? ` • ${overallSummary.notRun} not run` : ''}
          </div>
          <div className="text-xs">
            {coverage.summary.ran} ran • {coverage.summary.skipped} skipped •{' '}
            {coverage.summary.failed} failed
            {coverage.summary.inferredSkips > 0
              ? ` • ${coverage.summary.inferredSkips} inferred`
              : ''}
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground mb-3">
        Coverage tracks whether checks executed (ran/skipped/failed). It does not indicate
        pass/fail.
      </div>

      <div className="space-y-3">
        {chainEntries.map(([chainId, chainChecks]) => {
          const chainSummary = summarize(chainChecks);
          const chainLabel =
            chainId !== 'unknown' && Number(chainId) === report.metadata.chainId
              ? `${report.metadata.chainName || 'Chain'} ${chainId}`
              : `Chain ${chainId === 'unknown' ? 'unknown' : chainId}`;

          return (
            <div key={chainId} className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">{chainLabel}</div>
              <div className="text-sm text-muted-foreground">
                {chainSummary.passed} passed • {chainSummary.notApplicable} not applicable •{' '}
                {chainSummary.warning} warnings • {chainSummary.failed} failed
                {chainSummary.notRun > 0 ? ` • ${chainSummary.notRun} not run` : ''}
                {chainSummary.inferred > 0 ? ` • ${chainSummary.inferred} inferred` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StructuredReport({ report, proposal }: StructuredReportProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'checks' | 'calls' | 'state-changes'>(
    'overview',
  );

  const coverageByCheckId = useMemo(() => {
    const map = new Map<string, CheckCoverage>();
    for (const coverageEntry of report.coverage?.checks ?? []) {
      map.set(coverageEntry.checkId, coverageEntry);
    }
    return map;
  }, [report.coverage?.checks]);

  // Get block number with fallback for backwards compatibility
  const blockNumber =
    report.metadata.simulationBlockNumber || report.metadata.blockNumber || 'unknown';
  const timestamp = report.metadata.simulationTimestamp || report.metadata.timestamp || '0';

  const proposerLabel = useAddressLabel(report.metadata.proposer, report.metadata.addressLabels);
  const executorLabel = useAddressLabel(
    report.metadata.executor ?? '',
    report.metadata.addressLabels,
  );
  const governorLabel = useAddressLabel(
    report.metadata.governorAddress ?? '',
    report.metadata.addressLabels,
  );

  return (
    <div className="w-full">
      {/* NEW: Decision Header with key metrics */}
      <DecisionHeader report={report} />

      <div className="border border-muted rounded-md p-6">
        {/* KEPT: Simulation warning banner */}
        <SimulationWarningBanner metadata={report.metadata} />

        {/* REMOVED: Old header section - now in DecisionHeader */}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger className="cursor-pointer" value="overview">
              Overview
            </TabsTrigger>
            <TabsTrigger className="cursor-pointer" value="checks">
              Checks
            </TabsTrigger>
            <TabsTrigger className="cursor-pointer" value="calls">
              Calls
            </TabsTrigger>
            <TabsTrigger className="cursor-pointer" value="state-changes">
              State Changes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6 px-1">
            <div className="space-y-2">
              <CoverageSummary report={report} coverageByCheckId={coverageByCheckId} />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs cursor-pointer"
                  onClick={() => setActiveTab('checks')}
                >
                  View checks
                </Button>
              </div>
            </div>

            {report.proposalText && (
              <div className="border border-muted rounded-md p-6 bg-card">
                <h3 className="text-lg font-semibold mb-3">Proposal Details</h3>
                <div className="bg-muted p-4 rounded-md whitespace-pre-wrap">
                  {report.proposalText}
                </div>
              </div>
            )}

            {report.calldata && (
              <div className="border border-muted rounded-md p-6 bg-card">
                <h3 className="text-lg font-semibold mb-3">Calldata Decoded</h3>
                <div className="bg-muted p-4 rounded-md font-mono text-sm overflow-x-auto">
                  {report.calldata.decoded}
                </div>
              </div>
            )}

            <div className="border border-muted rounded-md p-6 bg-card">
              <h3 className="text-lg font-semibold mb-3">Metadata</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted p-3 rounded-md">
                  <div className="text-sm text-muted-foreground">Block Number</div>
                  <div className="font-medium">
                    <a
                      href={buildBlockLink(blockNumber, report.metadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                    >
                      {blockNumber}
                      <ExternalLinkIcon className="h-3 w-3 ml-1" />
                    </a>
                  </div>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <div className="text-sm text-muted-foreground">Timestamp</div>
                  <div className="font-medium">
                    {new Date(Number.parseInt(timestamp) * 1000).toLocaleString()}
                  </div>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <div className="text-sm text-muted-foreground">Proposal ID</div>
                  <div className="font-medium">{report.metadata.proposalId}</div>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <div className="text-sm text-muted-foreground">Network</div>
                  <div className="font-medium">{report.metadata.chainName || 'Ethereum'}</div>
                </div>
                {/* Proposer with placeholder badge */}
                <div className="bg-muted p-3 rounded-md col-span-2">
                  <div className="text-sm text-muted-foreground">Proposer</div>
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    <AddressLabel
                      address={report.metadata.proposer}
                      label={proposerLabel}
                      blockExplorerUrl={getExplorerUrl(report.metadata)}
                      showLink={false}
                      linkMode="inline"
                      className="text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline"
                    />
                    {report.metadata.proposerIsPlaceholder && <SimulationPlaceholderBadge />}
                  </div>
                </div>
                {/* Executor with placeholder badge (only show if available) */}
                {report.metadata.executor && (
                  <div className="bg-muted p-3 rounded-md col-span-2">
                    <div className="text-sm text-muted-foreground">
                      {getExecutorLabel(report.metadata.simulationType)}
                    </div>
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <AddressLabel
                        address={report.metadata.executor}
                        label={executorLabel}
                        blockExplorerUrl={getExplorerUrl(report.metadata)}
                        showLink={false}
                        linkMode="inline"
                        className="text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline"
                      />
                      {report.metadata.executorIsPlaceholder && <SimulationPlaceholderBadge />}
                    </div>
                  </div>
                )}
                {/* Governor address (only show if available) */}
                {report.metadata.governorAddress && (
                  <div className="bg-muted p-3 rounded-md col-span-2">
                    <div className="text-sm text-muted-foreground">Governor</div>
                    <div className="font-medium">
                      <AddressLabel
                        address={report.metadata.governorAddress}
                        label={governorLabel}
                        blockExplorerUrl={getExplorerUrl(report.metadata)}
                        showLink={false}
                        linkMode="inline"
                        className="text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="checks" className="mt-4 px-1">
            <div className="space-y-4">
              {report.checks.length === 0 ? (
                <div className="flex items-center justify-center p-6 text-muted-foreground border border-muted rounded-md">
                  <InfoIcon className="h-4 w-4 mr-2" />
                  <span>No checks found in the report</span>
                </div>
              ) : (
                report.checks.map((check: SimulationCheck, index: number) => (
                  <ExpandableCheckItem
                    key={`check-${check.title}-${index}`}
                    check={check}
                    coverage={check.checkId ? coverageByCheckId.get(check.checkId) : undefined}
                    stateChanges={report.stateChanges}
                    metadata={report.metadata}
                  />
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="calls" className="mt-4 px-1">
            <CallGroupedView proposal={proposal} report={report} />
          </TabsContent>

          <TabsContent value="state-changes" className="mt-4 px-1">
            <div className="space-y-4">
              <StateChanges stateChanges={report.stateChanges} metadata={report.metadata} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Helper components
function ExpandableCheckItem({
  check,
  coverage,
  stateChanges,
  metadata,
}: {
  check: SimulationCheck;
  coverage?: CheckCoverage;
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const outcome = getOutcome(check, coverage);
  const methodTag = coverage?.wasInferred ? 'Inferred' : null;
  const secondaryLine =
    outcome === 'not_applicable'
      ? (coverage?.skipReason ?? check.skipReason ?? 'Not applicable')
      : outcome === 'not_run'
        ? (coverage?.skipReason ?? 'Not run')
        : coverage?.wasInferred && coverage?.skipReason
          ? `Inferred: ${coverage.skipReason}`
          : null;

  const isExpandable = Boolean(
    check.details || check.skipReason || coverage?.skipReason || check.checkId,
  );

  const getStatusIcon = () => {
    if (outcome === 'warning') {
      return <AlertTriangleIcon className="h-5 w-5 text-yellow-500" />;
    }
    if (outcome === 'failed' || outcome === 'not_run') {
      return <AlertTriangleIcon className="h-5 w-5 text-red-500" />;
    }
    if (outcome === 'not_applicable') {
      return <SkipForwardIcon className="h-5 w-5 text-gray-400" />;
    }
    return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
  };

  const getStatusBadge = () => {
    if (outcome === 'warning') {
      return (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
          Warning
        </Badge>
      );
    }
    if (outcome === 'failed') {
      return <Badge variant="destructive">Failed</Badge>;
    }
    if (outcome === 'not_run') {
      return (
        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">
          Not run
        </Badge>
      );
    }
    if (outcome === 'not_applicable') {
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">
          Not applicable
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
        Passed
      </Badge>
    );
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Check if this is a state changes check
  const isStateChangesCheck = check.title.toLowerCase().includes('state changes');

  // Format the details content as React components
  const FormattedDetails = useMemo(() => {
    if (!check.details) return null;

    // Pre-process the raw details to remove all instances of "**Info**:" and similar patterns
    let preprocessedDetails = check.details;

    // First, handle the specific case of "**Info**: - Uni (Uniswap)"
    preprocessedDetails = preprocessedDetails.replace(
      /\*\*Info\*\*: - ([A-Za-z0-9]+ \([A-Za-z0-9]+\))/g,
      '$1',
    );

    // Then remove all other variations of Info prefixes
    preprocessedDetails = preprocessedDetails
      .replace(/\*\*Info\*\*:/g, '')
      .replace(/\*\*Warnings\*\*:/g, '')
      .replace(/Info:/g, '')
      .replace(/Warnings:/g, '')
      .replace(/^- \*\*Info\*\*:/gm, '')
      .replace(/^-\s*\*\*Info\*\*:/gm, '')
      .replace(/^-\s*Info:/gm, '')
      .replace(/^-\s*/gm, '');

    // Remove all markdown formatting
    const cleanedDetails = preprocessedDetails.replace(/\*\*([^*]+)\*\*:/g, '$1:');

    // Split by lines to process each line
    const lines = cleanedDetails.split('\n').filter((line: string) => line.trim() !== '');

    // Create effective metadata for dynamic explorer links
    const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

    if (isStateChangesCheck) {
      // Only return StateChanges if stateChanges exists and is not empty
      return stateChanges && stateChanges.length > 0 ? (
        <StateChanges stateChanges={stateChanges} metadata={effectiveMetadata} />
      ) : null;
    }

    const normalizeInfoPrefix = (text: string) =>
      text
        .replace(/^\*\*Info\*\*:\s*-\s*/, '')
        .replace(/^\*\*Info\*\*:\s*/, '')
        .replace(/^Info:\s*-\s*/, '')
        .replace(/^Info:\s*/, '')
        .replace(/^Info\s*-\s*/, '');

    return (
      <>
        {lines.map((line: string, index: number) => {
          // Final cleanup for any remaining Info prefixes
          const processedLine = normalizeInfoPrefix(line);

          const markdownLinkedLine = renderMarkdownLinks(processedLine);
          if (typeof markdownLinkedLine !== 'string') {
            return (
              <p key={`mdlink-${processedLine}`} className="mb-2">
                {markdownLinkedLine}
              </p>
            );
          }

          // Check if this is a contract name line (like "Uni (Uniswap) at 0x...")
          if (processedLine.match(/^[A-Za-z0-9]+ \([A-Za-z0-9]+\) at `0x[a-fA-F0-9]{40}`/)) {
            const match = processedLine.match(
              /^([A-Za-z0-9]+ \([A-Za-z0-9]+\)) at `(0x[a-fA-F0-9]{40})`/,
            );
            if (match) {
              const contractName = match[1];
              const contractAddress = match[2];
              return (
                <div key={`contract-header-${contractAddress}`} className="mb-4 mt-2">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    {contractName}
                    <span className="text-sm font-normal inline-flex items-center gap-2">
                      at{' '}
                      <a
                        href={buildAddressLink(contractAddress, effectiveMetadata)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                      >
                        {contractAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1" />
                      </a>
                      {isPlaceholderAddress(contractAddress, effectiveMetadata) && (
                        <SimulationPlaceholderBadge />
                      )}
                    </span>
                  </h3>
                </div>
              );
            }
          }

          // Process line to replace addresses with links
          const parts: React.ReactNode[] = [];
          let lastIndex = 0;
          const addressRegex = /`(0x[a-fA-F0-9]{40})`/g;
          let match: RegExpExecArray | null;

          // Check if this is a target line
          const isTargetLine =
            processedLine.includes('Contract (verified)') ||
            processedLine.includes('EOA (verification not applicable)') ||
            processedLine.includes('Contract (looks safe)') ||
            processedLine.includes('Trusted contract');

          if (isTargetLine) {
            // Extract target address from the line - handle different formats
            const targetMatch =
              processedLine.match(/\[`(0x[a-fA-F0-9]{40})`\]/) ||
              processedLine.match(/at `(0x[a-fA-F0-9]{40})`/);
            if (targetMatch) {
              const address = targetMatch[1];
              // Get the contract status
              let status = 'Unknown';
              if (processedLine.includes('Contract (verified)')) status = 'Contract (verified)';
              else if (processedLine.includes('EOA (verification not applicable)')) status = 'EOA';
              else if (processedLine.includes('Contract (looks safe)'))
                status = 'Contract (looks safe)';
              else if (processedLine.includes('Trusted contract')) status = 'Trusted contract';

              // Format the target with proper styling
              return (
                <div key={`target-${address}`} className="mb-3">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="mr-2">{processedLine.includes('at `') ? '' : 'Target:'}</span>
                    <a
                      href={buildAddressLink(address, effectiveMetadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs bg-muted p-2 rounded hover:underline inline-flex items-center"
                    >
                      {address}
                      <ExternalLinkIcon className="h-3 w-3 ml-1" />
                    </a>
                    {isPlaceholderAddress(address, effectiveMetadata) && (
                      <SimulationPlaceholderBadge />
                    )}
                    <span className="text-muted-foreground text-xs">{status}</span>
                  </div>
                </div>
              );
            }
          }

          // Check if this is an event line
          const isEventLine =
            processedLine.includes('`') &&
            (processedLine.includes('Transfer(') ||
              processedLine.includes('Approval(') ||
              (processedLine.includes('(') &&
                processedLine.includes(')') &&
                processedLine.includes(':')));

          // Check if this is a calldata line
          const isCalldataLine =
            processedLine.includes('transfers') && processedLine.includes('UNI to');

          if (isCalldataLine) {
            // Format calldata as code and remove any backticks
            const formattedLine = processedLine.replace(/`/g, '');

            // Extract addresses from the calldata line
            const fromAddressMatch = formattedLine.match(/(0x[a-fA-F0-9]{40}) transfers/);
            const toAddressMatch = formattedLine.match(/UNI to (0x[a-fA-F0-9]{40})/);

            if (fromAddressMatch && toAddressMatch) {
              const fromAddress = fromAddressMatch[1];
              const toAddress = toAddressMatch[1];
              const amountMatch = formattedLine.match(/transfers ([0-9.]+) UNI/);
              const amount = amountMatch ? amountMatch[1] : '';

              return (
                <div key={`calldata-${index}-${formattedLine.substring(0, 30)}`} className="mb-3">
                  <code className="block font-mono text-xs bg-muted p-3 rounded whitespace-pre-wrap overflow-x-auto">
                    <span className="flex flex-wrap gap-2 items-center">
                      <a
                        href={buildAddressLink(fromAddress, effectiveMetadata)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                      >
                        {fromAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1" />
                      </a>
                      {isPlaceholderAddress(fromAddress, effectiveMetadata) && (
                        <SimulationPlaceholderBadge />
                      )}
                      <span>transfers</span>
                      <span className="font-bold">{amount} UNI</span>
                      <span>to</span>
                      <a
                        href={buildAddressLink(toAddress, effectiveMetadata)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                      >
                        {toAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1" />
                      </a>
                      {isPlaceholderAddress(toAddress, effectiveMetadata) && (
                        <SimulationPlaceholderBadge />
                      )}
                    </span>
                  </code>
                </div>
              );
            }

            // Fallback if we can't parse the addresses
            return (
              <div key={`calldata-${index}-${formattedLine.substring(0, 30)}`} className="mb-3">
                <code className="block font-mono text-xs bg-muted p-3 rounded whitespace-pre-wrap overflow-x-auto">
                  {formattedLine}
                </code>
              </div>
            );
          }

          if (isEventLine) {
            // Format event as code
            const eventMatch = processedLine.match(/`([^`]+)`/);
            if (eventMatch) {
              const eventText = eventMatch[1];

              // Format the event with proper styling
              return (
                <div key={`event-${eventText.substring(0, 30)}-${index}`} className="mb-3">
                  <code className="block font-mono text-xs bg-muted p-3 rounded whitespace-pre-wrap overflow-x-auto">
                    {eventText}
                  </code>
                </div>
              );
            }
          }

          // Use a different approach to avoid assignment in the while condition
          match = addressRegex.exec(processedLine);
          while (match !== null) {
            // Add text before the match
            if (match.index > lastIndex) {
              parts.push(processedLine.substring(lastIndex, match.index));
            }

            // Add the address as a link with optional placeholder badge
            const address = match[1];
            const isPlaceholder = isPlaceholderAddress(address, effectiveMetadata);
            parts.push(
              <span
                key={`address-wrapper-${address}-${match.index}`}
                className="inline-flex items-center gap-1"
              >
                <a
                  href={buildAddressLink(address, effectiveMetadata)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                >
                  {address}
                  <ExternalLinkIcon className="h-3 w-3 ml-1" />
                </a>
                {isPlaceholder && <SimulationPlaceholderBadge />}
              </span>,
            );

            lastIndex = match.index + match[0].length;
            match = addressRegex.exec(processedLine);
          }

          // Add remaining text
          if (lastIndex < processedLine.length) {
            parts.push(processedLine.substring(lastIndex));
          }

          // For simple informational lines like "No ETH is required..."
          if (
            processedLine.includes('No ETH is required') ||
            processedLine.includes('No ETH transfers detected') ||
            (parts.length === 1 && typeof parts[0] === 'string' && !processedLine.includes('`'))
          ) {
            return (
              <div
                key={`info-${index}-${processedLine.substring(0, 30).replace(/\s+/g, '-')}`}
                className="mb-3"
              >
                <p className="text-muted-foreground">{parts.length > 0 ? parts : processedLine}</p>
              </div>
            );
          }

          return (
            <p key={`line-${index}-${processedLine.substring(0, 20)}`} className="mb-2">
              {parts.length > 0 ? parts : processedLine}
            </p>
          );
        })}
      </>
    );
  }, [check.details, isStateChangesCheck, stateChanges, metadata]);

  return (
    <div className="border border-muted rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer flex justify-between items-start"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2">
          {getStatusIcon()}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{check.title}</h4>
              {methodTag && (
                <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">
                  {methodTag}
                </Badge>
              )}
            </div>
            {secondaryLine && (
              <div className="text-xs text-muted-foreground">
                {renderMarkdownLinks(secondaryLine)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          {isExpandable &&
            (isExpanded ? (
              <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
            ))}
        </div>
      </button>
      {isExpanded && isExpandable && (
        <div className="p-5 pt-0 pl-11 text-sm border-t border-muted bg-muted/10">
          {check.checkId && (
            <div className="mt-4 text-xs text-muted-foreground flex flex-wrap gap-4">
              <div>
                Check ID:{' '}
                <span className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded">
                  {check.checkId}
                </span>
              </div>
              {coverage?.wasInferred && <div>Method: Inferred</div>}
              {coverage?.status === 'ran' && <div>Method: Ran</div>}
              {coverage?.status === 'failed' && <div>Method: Not run</div>}
            </div>
          )}
          {outcome === 'not_applicable' && secondaryLine ? (
            <div className="mt-4">
              <p className="text-muted-foreground italic">{secondaryLine}</p>
            </div>
          ) : outcome === 'not_run' && secondaryLine ? (
            <div className="mt-4">
              <p className="text-muted-foreground italic">{secondaryLine}</p>
            </div>
          ) : isStateChangesCheck ? (
            <div className="mt-4">
              {stateChanges && stateChanges.length > 0 ? (
                <StateChanges stateChanges={stateChanges} />
              ) : (
                <div className="flex items-center justify-center p-6 text-muted-foreground">
                  <InfoIcon className="h-4 w-4 mr-2" />
                  <span>No state changes available</span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 whitespace-pre-wrap">{FormattedDetails}</div>
          )}
        </div>
      )}
    </div>
  );
}

function StateChangeItem({
  stateChange,
  metadata,
}: {
  stateChange: SimulationStateChange;
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  // Create a default metadata for backwards compatibility
  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Clean values by removing quotes if they exist
  const cleanValue = (value: string): string => {
    // If the value is wrapped in quotes (like JSON strings often are)
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }
    return value;
  };

  const oldValueCleaned = cleanValue(stateChange.oldValue);
  const newValueCleaned = cleanValue(stateChange.newValue);

  // Determine if the change is a simple value change or a complex one
  const isNumericChange =
    !Number.isNaN(Number(oldValueCleaned)) && !Number.isNaN(Number(newValueCleaned));
  const isAddressChange = oldValueCleaned.startsWith('0x') && newValueCleaned.startsWith('0x');
  const isBooleanChange =
    (oldValueCleaned === 'true' || oldValueCleaned === 'false') &&
    (newValueCleaned === 'true' || newValueCleaned === 'false');

  // Calculate difference for numeric values
  const getDifference = () => {
    if (isNumericChange) {
      try {
        // Parse the values as BigInt to handle very large numbers
        const oldNum = BigInt(oldValueCleaned);
        const newNum = BigInt(newValueCleaned);
        const diff = newNum - oldNum;

        // Determine if the change is positive, negative, or zero
        const isPositive = diff > BigInt(0);
        const isNegative = diff < BigInt(0);
        const absDiff = isNegative ? -diff : diff;

        // Format the difference with commas for readability
        const formattedDiff = absDiff.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        // Calculate percentage for display
        let percentageDisplay = '';

        // Only calculate percentage if old value is not zero
        if (oldNum !== BigInt(0)) {
          try {
            // For very large numbers, use a simplified approach
            // Just use the first few digits for an approximate percentage
            const oldNumDigits = oldNum.toString().length;
            const diffDigits = diff.toString().length;

            // If numbers are too large for JS Number, use a simplified calculation
            if (oldNumDigits > 15 || diffDigits > 15) {
              // Use the first 5 digits for percentage calculation
              const oldNumPrefix = Number(oldNum.toString().substring(0, 5));
              const diffPrefix = Number(diff.toString().substring(0, 5));

              // Calculate an approximate percentage
              const percentChange = Math.abs((diffPrefix / oldNumPrefix) * 100);

              // Only show percentage if it's meaningful
              if (percentChange > 0.1 && percentChange < 10000) {
                percentageDisplay = `${isPositive ? '+' : '-'}${Math.round(percentChange)}%`;
              }
            } else {
              // For smaller numbers, calculate exact percentage
              const percentChange = Math.abs(Number((diff * BigInt(100)) / oldNum));
              if (percentChange > 0 && percentChange < 10000) {
                percentageDisplay = `${isPositive ? '+' : '-'}${percentChange}%`;
              }
            }
          } catch (_) {
            // Silently fail if percentage calculation errors
          }
        }

        return (
          <div className="bg-muted p-3 rounded-md mt-4">
            <div className="text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Change</span>
              <div className="flex flex-col items-end">
                <span
                  className={`font-bold ${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''}`}
                >
                  {isPositive ? '+' : isNegative ? '-' : ''}
                  {formattedDiff}
                </span>
                {percentageDisplay && (
                  <span
                    className={`text-xs ${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''}`}
                  >
                    {percentageDisplay}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      } catch (error) {
        // Fallback for any parsing errors
        console.error('Error calculating difference:', error);
        return (
          <div className="bg-muted p-3 rounded-md mt-4">
            <div className="text-sm text-muted-foreground">Change</div>
            <div className="font-medium text-xs">Value changed</div>
          </div>
        );
      }
    }

    if (isBooleanChange) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Change</span>
            <span
              className={`font-bold ${newValueCleaned === 'true' ? 'text-green-600' : 'text-red-600'}`}
            >
              {oldValueCleaned} → {newValueCleaned}
            </span>
          </div>
        </div>
      );
    }

    if (isAddressChange) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm text-muted-foreground">Address Change</div>
          <div className="font-medium text-xs">
            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-2 flex-wrap">
                From:{' '}
                <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">
                  <a
                    href={buildAddressLink(oldValueCleaned, effectiveMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline inline-flex items-center"
                  >
                    {oldValueCleaned}
                    <ExternalLinkIcon className="h-3 w-3 ml-1" />
                  </a>
                </code>
                {isPlaceholderAddress(oldValueCleaned, effectiveMetadata) && (
                  <SimulationPlaceholderBadge />
                )}
              </span>
              <span className="inline-flex items-center gap-2 flex-wrap">
                To:{' '}
                <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">
                  <a
                    href={buildAddressLink(newValueCleaned, effectiveMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline inline-flex items-center"
                  >
                    {newValueCleaned}
                    <ExternalLinkIcon className="h-3 w-3 ml-1" />
                  </a>
                </code>
                {isPlaceholderAddress(newValueCleaned, effectiveMetadata) && (
                  <SimulationPlaceholderBadge />
                )}
              </span>
            </div>
          </div>
        </div>
      );
    }

    // For other types of changes, show a generic difference indicator
    return (
      <div className="bg-muted p-3 rounded-md mt-4">
        <div className="text-sm text-muted-foreground">Change</div>
        <div className="font-medium text-xs">Value changed</div>
      </div>
    );
  };

  return (
    <div className="border border-muted rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer flex justify-between items-start"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2">
          {stateChange.key.startsWith('0x') && (
            <div className="text-xs bg-muted-foreground/10 px-2 py-1 rounded text-muted-foreground">
              Balance
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted-foreground/20 px-2 py-1 rounded">
            {stateChange.key.startsWith('0x') ? (
              <a
                href={buildAddressLink(stateChange.key, effectiveMetadata)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline inline-flex items-center"
                onClick={(e) => e.stopPropagation()} // Prevent toggling when clicking the link
              >
                {stateChange.key}
                <ExternalLinkIcon className="h-3 w-3 ml-1" />
              </a>
            ) : (
              stateChange.key
            )}
          </code>
          {stateChange.key.startsWith('0x') &&
            isPlaceholderAddress(stateChange.key, effectiveMetadata) && (
              <SimulationPlaceholderBadge />
            )}
          {isExpanded ? (
            <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="p-5 pt-0 pl-11 text-sm border-t border-muted bg-muted/10">
          {getDifference()}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground font-medium">Old Value: </span>
              <div className="font-mono text-xs break-all mt-2 bg-muted p-3 rounded">
                {stateChange.oldValue}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">New Value: </span>
              <div className="font-mono text-xs break-all mt-2 bg-muted p-3 rounded">
                {stateChange.newValue}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
