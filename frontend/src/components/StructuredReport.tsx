'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  CrossChainMessagePreview,
  Proposal,
  SimulationCheck,
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  InfoIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  UserIcon,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DecisionHeader } from './DecisionHeader';
import {
  TreasuryMovementCheck,
  isTreasuryMovementCheckDataV1,
  parseTreasuryMovementDetails,
  treasuryMovementDataToViewModel,
} from './TreasuryMovementCheck';

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

function buildAddressLinkForExplorer(address: string, baseUrl: string): string {
  return `${baseUrl || 'https://etherscan.io'}/address/${address}`;
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

function getAddressLabel(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): string | null {
  if (!metadata.addressLabels) return null;
  const normalizedAddress = address.toLowerCase();
  for (const [addr, labelInfo] of Object.entries(metadata.addressLabels)) {
    if (addr.toLowerCase() === normalizedAddress) {
      return labelInfo.label;
    }
  }
  return null;
}

// --- Simulation warning components ---

function SimulationPlaceholderBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`bg-slate-100 text-slate-600 border-slate-300 text-xs ${className || ''}`}
    >
      Simulation Placeholder
    </Badge>
  );
}

// --- Chain Logo Component ---
// Official logos stored in /public/chain-logos/
// Sources:
// - Ethereum: https://github.com/0xa3k5/web3icons
// - Optimism: https://github.com/0xa3k5/web3icons
// - Base: https://github.com/base/brand-kit (The Square)
// - Arbitrum: https://github.com/0xa3k5/web3icons

function ChainLogo({ chainId, size = 20 }: { chainId: number; size?: number }) {
  // Map chain IDs to logo file paths
  const logoFiles: Record<number, string> = {
    1: '/chain-logos/ethereum.svg',
    10: '/chain-logos/optimism.svg',
    8453: '/chain-logos/base.svg',
    42161: '/chain-logos/arbitrum.svg',
  };

  const logoPath = logoFiles[chainId];

  if (!logoPath) {
    // Fallback: generic chain icon with chain ID
    return (
      <div
        className="rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {chainId}
      </div>
    );
  }

  return (
    <img
      src={logoPath}
      alt={`Chain ${chainId} logo`}
      width={size}
      height={size}
      className="shrink-0"
    />
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

// --- Proxy Resolution Display Component ---
interface ProxyItem {
  type: 'eip1967' | 'beacon';
  proxy: string;
  beacon?: string;
  implementation: string;
  verification: string;
}

function parseProxyDetails(details: string): ProxyItem[] {
  const items: ProxyItem[] = [];
  const lines = details.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    // Parse markdown links: [address](url)
    const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
    const addresses: string[] = [];
    let match: RegExpExecArray | null;
    match = linkRegex.exec(line);
    while (match !== null) {
      addresses.push(match[1]);
      match = linkRegex.exec(line);
    }

    // Extract verification status from parentheses at end
    const verificationMatch = line.match(/\(([^)]+)\)$/);
    const verification = verificationMatch ? verificationMatch[1] : '';

    if (line.includes('EIP-1967 proxy') && addresses.length >= 2) {
      items.push({
        type: 'eip1967',
        proxy: addresses[0],
        implementation: addresses[1],
        verification,
      });
    } else if (line.includes('Beacon proxy') && addresses.length >= 3) {
      items.push({
        type: 'beacon',
        proxy: addresses[0],
        beacon: addresses[1],
        implementation: addresses[2],
        verification,
      });
    }
  }

  return items;
}

function ProxyResolutionDetails({ details }: { details: string }) {
  const items = useMemo(() => parseProxyDetails(details), [details]);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {details.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div
          key={`${item.proxy}-${idx}`}
          className="border border-border/50 rounded-lg bg-card/50 overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
              {item.type === 'eip1967' ? 'EIP-1967 Proxy' : 'Beacon Proxy'}
            </span>
          </div>

          {/* Content */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Proxy */}
              <AddressChip address={item.proxy} label="Proxy" />

              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />

              {/* Beacon (if present) */}
              {item.beacon && (
                <>
                  <AddressChip address={item.beacon} label="Beacon" />
                  <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                </>
              )}

              {/* Implementation */}
              <AddressChip address={item.implementation} label="Impl" />
            </div>

            {/* Verification Badge */}
            {item.verification && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs text-muted-foreground">{item.verification}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddressChip({ address, label }: { address: string; label?: string }) {
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <a
      href={`https://etherscan.io/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/60 hover:bg-muted transition-colors"
      title={address}
    >
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
      )}
      <code className="text-xs font-mono text-foreground/80 group-hover:text-foreground">
        {truncated}
      </code>
      <ExternalLinkIcon className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
    </a>
  );
}

// Create a new StateChanges component for reuse
interface StateChangesProps {
  stateChanges: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}

const MemoStateChangeItem = React.memo(StateChangeItem);

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

  // Calculate summary stats
  const groupedChanges = stateChanges.reduce<Record<string, SimulationStateChange[]>>(
    (acc, change) => {
      const contractName = change.contract;
      const key = `${contractName}|${change.contractAddress || ''}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(change);
      return acc;
    },
    {},
  );

  const contractCount = Object.keys(groupedChanges).length;
  const slotCount = stateChanges.length;

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground pb-2 border-b border-muted">
        <span>
          <strong className="text-foreground">{contractCount}</strong>{' '}
          {contractCount === 1 ? 'contract' : 'contracts'} modified
        </span>
        <span>•</span>
        <span>
          <strong className="text-foreground">{slotCount}</strong>{' '}
          {slotCount === 1 ? 'storage slot' : 'storage slots'} changed
        </span>
      </div>

      {/* Group state changes by contract */}
      {Object.entries(groupedChanges).map(([contractKey, changes]) => {
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
                <MemoStateChangeItem
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

// Types for contract verification
type VerificationStatus = 'verified' | 'unverified' | 'eoa' | 'unknown';

interface ParsedContract {
  address: string;
  status: VerificationStatus;
  statusLabel: string;
  isPlaceholder: boolean;
}

// Parse verification info lines into structured data
function parseVerificationLine(line: string): ParsedContract | null {
  // Match address from markdown link format: [address](url) or just address
  const addressMatch = line.match(/\[(0x[a-fA-F0-9]{40})\]/) || line.match(/(0x[a-fA-F0-9]{40})/);
  if (!addressMatch) return null;

  const address = addressMatch[1];
  const isPlaceholder = line.includes('simulation placeholder');

  let status: VerificationStatus = 'unknown';
  let statusLabel = 'Unknown';

  if (line.includes('Contract (verified)')) {
    status = 'verified';
    statusLabel = 'Verified';
  } else if (line.includes('Contract (unverified)')) {
    status = 'unverified';
    statusLabel = 'Unverified';
  } else if (line.includes('EOA') || line.includes('verification not applicable')) {
    status = 'eoa';
    statusLabel = isPlaceholder ? 'Placeholder' : 'EOA';
  } else if (line.includes('Contract (looks safe)')) {
    status = 'verified';
    statusLabel = 'Looks Safe';
  } else if (line.includes('Trusted contract')) {
    status = 'verified';
    statusLabel = 'Trusted';
  }

  return { address, status, statusLabel, isPlaceholder };
}

// Contract verification list component with grouping
interface ContractVerificationListProps {
  details: string;
  info?: string[];
}

function ContractVerificationList({ details, info }: ContractVerificationListProps) {
  // Parse all contracts from info array or details string
  const contracts = useMemo(() => {
    const lines = info || details.split('\n').filter((l) => l.trim());
    return lines.map(parseVerificationLine).filter((c): c is ParsedContract => c !== null);
  }, [details, info]);

  // Group contracts by status
  const grouped = useMemo(() => {
    const unverified = contracts.filter((c) => c.status === 'unverified');
    const verified = contracts.filter((c) => c.status === 'verified');
    const eoa = contracts.filter((c) => c.status === 'eoa');
    const unknown = contracts.filter((c) => c.status === 'unknown');
    return { unverified, verified, eoa, unknown };
  }, [contracts]);

  const totalCount = contracts.length;
  const verifiedCount = grouped.verified.length;
  const unverifiedCount = grouped.unverified.length;

  if (contracts.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground border border-muted rounded-md">
        <InfoIcon className="h-4 w-4 mr-2" />
        <span>No contracts found</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-3 pb-3 border-b border-muted">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-semibold">{totalCount}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheckIcon className="h-4 w-4 text-green-600" />
          <span className="text-green-700 font-medium">{verifiedCount} verified</span>
        </div>
        {unverifiedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlertIcon className="h-4 w-4 text-red-500" />
            <span className="text-red-600 font-medium">{unverifiedCount} unverified</span>
          </div>
        )}
        {grouped.eoa.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <UserIcon className="h-4 w-4 text-gray-500" />
            <span className="text-muted-foreground">{grouped.eoa.length} EOA/Other</span>
          </div>
        )}
      </div>

      {/* Unverified contracts - shown first with warning styling */}
      {grouped.unverified.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-red-600 flex items-center gap-2">
            <ShieldAlertIcon className="h-4 w-4" />
            Unverified Contracts
          </h4>
          <div className="space-y-2">
            {grouped.unverified.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="danger" />
            ))}
          </div>
        </div>
      )}

      {/* Verified contracts */}
      {grouped.verified.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-green-700 flex items-center gap-2">
            <ShieldCheckIcon className="h-4 w-4" />
            Verified Contracts
          </h4>
          <div className="space-y-2">
            {grouped.verified.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="success" />
            ))}
          </div>
        </div>
      )}

      {/* EOA / Other addresses */}
      {grouped.eoa.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <UserIcon className="h-4 w-4" />
            EOA / Other Addresses
          </h4>
          <div className="space-y-2">
            {grouped.eoa.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="neutral" />
            ))}
          </div>
        </div>
      )}

      {/* Unknown status */}
      {grouped.unknown.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <InfoIcon className="h-4 w-4" />
            Unknown Status
          </h4>
          <div className="space-y-2">
            {grouped.unknown.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="neutral" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Individual contract card component
interface ContractCardProps {
  contract: ParsedContract;
  variant: 'success' | 'danger' | 'neutral';
}

function ContractCard({ contract, variant }: ContractCardProps) {
  const variantStyles = {
    success: {
      card: 'bg-green-50 border-green-200 hover:border-green-300',
      badge: 'bg-green-100 text-green-800 border-green-300',
      icon: <ShieldCheckIcon className="h-4 w-4 text-green-600" />,
    },
    danger: {
      card: 'bg-red-50 border-red-200 hover:border-red-300',
      badge: 'bg-red-100 text-red-700 border-red-300',
      icon: <ShieldAlertIcon className="h-4 w-4 text-red-500" />,
    },
    neutral: {
      card: 'bg-gray-50 border-gray-200 hover:border-gray-300',
      badge: 'bg-gray-100 text-gray-600 border-gray-300',
      icon: <UserIcon className="h-4 w-4 text-gray-500" />,
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${styles.card}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {styles.icon}
        <a
          href={`https://etherscan.io/address/${contract.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm truncate hover:underline inline-flex items-center gap-1 group"
        >
          <span className="truncate">{contract.address}</span>
          <ExternalLinkIcon className="h-3 w-3 opacity-50 group-hover:opacity-100 flex-shrink-0" />
        </a>
      </div>
      <Badge variant="outline" className={`text-xs font-medium flex-shrink-0 ${styles.badge}`}>
        {contract.statusLabel}
        {contract.isPlaceholder && ' (Sim)'}
      </Badge>
    </div>
  );
}

interface StructuredReportProps {
  report: StructuredSimulationReport;
  proposal?: Proposal;
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

function formatCrossChainCall(message: CrossChainMessagePreview): string {
  if (message.call?.signature) return message.call.signature;
  if (message.call?.selector) return message.call.selector;
  if (message.l2InputData) return message.l2InputData.slice(0, 10);
  return '(unknown)';
}

type CrossChainChainSummary = {
  chainId: number;
  chainName: string;
  explorerBaseUrl: string;
  bridgeType?: string;
  total: number;
  successCount: number;
  failureCount: number;
  failures: Array<{
    index: number;
    call: string;
    targetLabel?: string;
    target?: string;
  }>;
};

function summarizeCrossChainMessages(messages: CrossChainMessagePreview[]): {
  total: number;
  successCount: number;
  failureCount: number;
  chains: CrossChainChainSummary[];
} {
  const byChain = new Map<number, CrossChainMessagePreview[]>();
  for (const msg of messages) {
    const list = byChain.get(msg.chainId) ?? [];
    list.push(msg);
    byChain.set(msg.chainId, list);
  }

  const chains: CrossChainChainSummary[] = Array.from(byChain.entries())
    .sort(([a], [b]) => a - b)
    .map(([chainId, chainMessages]) => {
      const chainName = chainMessages[0]?.chainName || `Chain ${chainId}`;
      const explorerBaseUrl = chainMessages[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
      const bridgeType = chainMessages[0]?.bridgeType;
      const successCount = chainMessages.filter((m) => m.status === 'success').length;
      const failureCount = chainMessages.length - successCount;

      return {
        chainId,
        chainName,
        explorerBaseUrl,
        bridgeType,
        total: chainMessages.length,
        successCount,
        failureCount,
        failures: chainMessages
          .map((m, index) => ({
            index,
            call: formatCrossChainCall(m),
            targetLabel: m.targetLabel,
            target: m.l2TargetAddress,
            status: m.status,
          }))
          .filter((m) => m.status === 'failure')
          .map(({ index, call, targetLabel, target }) => ({ index, call, targetLabel, target })),
      };
    });

  const total = chains.reduce((acc, c) => acc + c.total, 0);
  const successCount = chains.reduce((acc, c) => acc + c.successCount, 0);
  const failureCount = total - successCount;

  return { total, successCount, failureCount, chains };
}

function CrossChainChecksSummary({ messages }: { messages: CrossChainMessagePreview[] }) {
  const summary = useMemo(() => summarizeCrossChainMessages(messages), [messages]);
  const hasFailures = summary.failureCount > 0;

  return (
    <div className="border border-muted rounded-md p-4 bg-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {hasFailures ? (
            <AlertTriangleIcon className="h-5 w-5 text-yellow-500 mt-0.5" />
          ) : (
            <CheckCircleIcon className="h-5 w-5 text-green-500 mt-0.5" />
          )}
          <div>
            <div className="font-semibold">Cross-chain messages</div>
            <div className="text-xs text-muted-foreground">
              L2 message execution can fail independently of the main-chain checks.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300">
            {summary.successCount}/{summary.total} succeeded
          </Badge>
          {hasFailures ? (
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
              {summary.failureCount} failed
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {summary.chains.map((chain) => (
          <div key={chain.chainId} className="border border-border/50 rounded-md p-3 bg-muted/20">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ChainLogo chainId={chain.chainId} size={18} />
                {chain.chainName}
              </div>
              <div className="flex items-center gap-2">
                {chain.bridgeType ? (
                  <Badge variant="outline" className="text-xs">
                    {chain.bridgeType}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-xs bg-muted-foreground/10">
                  {chain.successCount}/{chain.total} succeeded
                </Badge>
                {chain.failureCount > 0 ? (
                  <Badge variant="destructive" className="text-xs">
                    {chain.failureCount} failed
                  </Badge>
                ) : null}
              </div>
            </div>

            {chain.failures.length ? (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {chain.failures.map((m) => (
                  <div
                    key={`${chain.chainId}-${m.index}`}
                    className="flex items-center gap-2 flex-wrap"
                  >
                    <span className="text-red-600 font-medium">Message {m.index + 1} failed:</span>
                    <code className="font-mono bg-muted-foreground/10 px-1 py-0.5 rounded">
                      {m.call}
                    </code>
                    {m.targetLabel ? <span>{m.targetLabel}</span> : null}
                    {m.target ? (
                      <a
                        href={buildAddressLinkForExplorer(m.target, chain.explorerBaseUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                        title={m.target}
                      >
                        {m.target.slice(0, 6)}...{m.target.slice(-4)}
                        <ExternalLinkIcon className="h-3 w-3 ml-1" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossChainPreview({ messages }: { messages: CrossChainMessagePreview[] }) {
  const groups = useMemo(() => {
    const byChain = new Map<number, CrossChainMessagePreview[]>();
    for (const msg of messages) {
      const list = byChain.get(msg.chainId) ?? [];
      list.push(msg);
      byChain.set(msg.chainId, list);
    }
    return Array.from(byChain.entries()).sort(([a], [b]) => a - b);
  }, [messages]);

  return (
    <div className="space-y-4">
      {groups.map(([chainId, chainMessages]) => {
        const chainName = chainMessages[0]?.chainName || `Chain ${chainId}`;
        const explorerBaseUrl = chainMessages[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
        const bridgeType = chainMessages[0]?.bridgeType;

        return (
          <div key={chainId} className="border border-muted rounded-md p-4 bg-card">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 font-semibold">
                <ChainLogo chainId={chainId} size={20} />
                {chainName}
              </div>
              {bridgeType ? (
                <Badge variant="outline" className="text-xs">
                  {bridgeType}
                </Badge>
              ) : null}
            </div>

            <div className="mt-3 space-y-3">
              {chainMessages.map((message, index) => {
                const messageKey = `${message.chainId}-${message.bridgeType}-${message.l2FromAddress ?? 'unknown'}-${message.l2TargetAddress ?? 'unknown'}-${message.l2InputData ?? 'unknown'}-${message.status}`;
                const target = message.l2TargetAddress;
                const targetLabel = message.targetLabel;
                const call = formatCrossChainCall(message);

                const statusBadge =
                  message.status === 'success' ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                      Succeeded
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">
                      Failed
                    </Badge>
                  );

                return (
                  <div
                    key={messageKey}
                    className="border border-border/50 rounded-md bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-sm font-medium">Message {index + 1}</div>
                      {statusBadge}
                    </div>

                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">Target:</span>
                        {targetLabel ? <span>{targetLabel}</span> : null}
                        {target ? (
                          <a
                            href={buildAddressLinkForExplorer(target, explorerBaseUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                            title={target}
                          >
                            {target.slice(0, 6)}...{target.slice(-4)}
                            <ExternalLinkIcon className="h-3 w-3 ml-1" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">(unknown)</span>
                        )}
                      </div>

                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="text-muted-foreground">Call:</span>
                        <code className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded">
                          {call}
                        </code>
                      </div>

                      {message.error ? (
                        <div className="text-xs text-red-700 mt-1">{message.error}</div>
                      ) : message.status === 'failure' ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          Failed (no error details captured)
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StructuredReport({ report }: StructuredReportProps) {
  // Get block number with fallback for backwards compatibility
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
                          : 'bg-green-100 text-green-800 border-green-300'
                    }
                  >
                    {chainReport.status === 'error'
                      ? 'Errors'
                      : chainReport.status === 'warning'
                        ? 'Warnings'
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

// Helper component for metadata items
function MetadataItem({
  label,
  children,
  fullWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={`bg-muted/50 p-2.5 sm:p-3 rounded-lg ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

// Checks section with grouping and summary
interface ChecksSectionProps {
  checks: SimulationCheck[];
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}

const MemoExpandableCheckItem = React.memo(ExpandableCheckItem);

function ChecksSection({ checks, stateChanges, metadata }: ChecksSectionProps) {
  // Group checks by status
  const grouped = useMemo(() => {
    const failed = checks.filter((c) => c.status === 'failed');
    const warning = checks.filter((c) => c.status === 'warning');
    const skipped = checks.filter((c) => c.status === 'skipped');
    const passed = checks.filter((c) => c.status === 'passed');
    return { failed, warning, skipped, passed };
  }, [checks]);

  const failedCount = grouped.failed.length;
  const warningCount = grouped.warning.length;
  const passedCount = grouped.passed.length;
  const skippedCount = grouped.skipped.length;

  // Render checks in priority order: failed, warning, skipped, passed
  const orderedChecks = useMemo(() => {
    return [...grouped.failed, ...grouped.warning, ...grouped.skipped, ...grouped.passed];
  }, [grouped]);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
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
        {skippedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <SkipForwardIcon className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-500">{skippedCount} skipped</span>
          </div>
        )}
      </div>

      {/* Checks list */}
      <div className="space-y-2">
        {orderedChecks.map((check, index) => (
          <MemoExpandableCheckItem
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

// Security analysis output parser for Slither/Solc
interface ParsedSecurityFinding {
  severity: 'high' | 'medium' | 'low' | 'info' | 'optimization';
  title: string;
  description: string;
  location?: string;
}

interface ParsedSecurityOutput {
  summary: {
    contractsAnalyzed: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
  };
  findings: ParsedSecurityFinding[];
  rawOutput: string;
}

function parseSecurityOutput(details: string): ParsedSecurityOutput {
  const findings: ParsedSecurityFinding[] = [];
  const lines = details.split('\n');

  // Count contracts analyzed - look for "Compiler warnings for" pattern
  const contractMatches = details.match(/Compiler warnings for/g);
  const contractsAnalyzed = contractMatches?.length || 0;

  // Find actual slither findings (they have patterns like "Reference:" or detector names)
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let infoCount = 0;

  // Look for severity indicators in slither output
  const highPattern = /Impact: High|severity: High/gi;
  const mediumPattern = /Impact: Medium|severity: Medium/gi;
  const lowPattern = /Impact: Low|severity: Low/gi;

  highCount = (details.match(highPattern) || []).length;
  mediumCount = (details.match(mediumPattern) || []).length;
  lowCount = (details.match(lowPattern) || []).length;

  // Count INFO messages (excluding CryticCompile noise)
  const infoLines = lines.filter(
    (line) =>
      line.includes('INFO:') &&
      !line.includes('CryticCompile') &&
      !line.includes('Slither:') &&
      !line.includes('Detectors:'),
  );
  infoCount = infoLines.length;

  return {
    summary: {
      contractsAnalyzed,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
    },
    findings,
    rawOutput: details,
  };
}

function SecurityAnalysisOutput({
  details,
  checkTitle,
}: {
  details: string;
  checkTitle: string;
}) {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const parsed = useMemo(() => parseSecurityOutput(details), [details]);

  const isSlither = checkTitle.toLowerCase().includes('slither');
  const isSolc = checkTitle.toLowerCase().includes('solc');
  const toolName = isSlither ? 'Slither' : isSolc ? 'Solc' : 'Security Analysis';

  const { summary } = parsed;
  const hasFindings = summary.highCount + summary.mediumCount + summary.lowCount > 0;

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{toolName} Analysis</span>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">
              {summary.contractsAnalyzed} contract{summary.contractsAnalyzed !== 1 ? 's' : ''}{' '}
              analyzed
            </span>
            {!hasFindings && (
              <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                No issues found
              </Badge>
            )}
            {summary.highCount > 0 && <Badge variant="destructive">{summary.highCount} High</Badge>}
            {summary.mediumCount > 0 && (
              <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
                {summary.mediumCount} Medium
              </Badge>
            )}
            {summary.lowCount > 0 && (
              <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                {summary.lowCount} Low
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Raw Output Toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowRawOutput(!showRawOutput)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRawOutput ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
          <span>{showRawOutput ? 'Hide' : 'View'} raw output</span>
        </button>
        {showRawOutput && (
          <div className="mt-3 max-h-96 overflow-auto rounded-md bg-muted/50 p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
              {parsed.rawOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// Events display component for cleaner event rendering
interface ParsedEvent {
  contractName: string;
  contractAddress?: string;
  events: Array<{
    name: string;
    params: Array<{ name: string; value: string }>;
  }>;
}

function parseEventsFromDetails(details: string): ParsedEvent[] {
  const lines = details.split('\n').filter((line) => line.trim());
  const result: ParsedEvent[] = [];
  let currentContract: ParsedEvent | null = null;

  for (const line of lines) {
    // Remove **Info**: prefix if present
    const cleanLine = line.replace(/^\*\*Info\*\*:\s*/, '').trim();

    // Check if this is a contract header (e.g., "Proxy at `0x...`" or "ContractName at 0x...")
    const contractMatch = cleanLine.match(
      /^([A-Za-z0-9_]+(?:\s*\([^)]+\))?)\s+at\s+[`']?(0x[a-fA-F0-9]{40})[`']?/,
    );
    if (contractMatch) {
      if (currentContract) {
        result.push(currentContract);
      }
      currentContract = {
        contractName: contractMatch[1].trim(),
        contractAddress: contractMatch[2],
        events: [],
      };
      continue;
    }

    // Check if this is an event line (e.g., "    `EventName(param: value, ...)`")
    // Handles both backtick-wrapped and plain formats
    const eventMatch = cleanLine.match(/^\s*`?(\w+)\((.+)\)`?\s*$/);
    if (eventMatch && currentContract) {
      const eventName = eventMatch[1];
      const paramsString = eventMatch[2];

      // Parse parameters - handle comma-separated key:value pairs
      const params: Array<{ name: string; value: string }> = [];
      if (paramsString.trim()) {
        // Split by comma followed by a parameter name (word followed by colon)
        const paramParts = paramsString.split(/,\s*(?=[a-zA-Z_]\w*:)/);
        for (const part of paramParts) {
          const paramMatch = part.match(/^(\w+):\s*(.+)$/);
          if (paramMatch) {
            params.push({ name: paramMatch[1], value: paramMatch[2].trim() });
          }
        }
      }

      currentContract.events.push({ name: eventName, params });
    }
  }

  if (currentContract) {
    result.push(currentContract);
  }

  return result;
}

function truncateHex(value: string, maxLength = 20): string {
  if (!value.startsWith('0x') || value.length <= maxLength) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function isHexValue(value: string): boolean {
  return /^0x[a-fA-F0-9]+$/.test(value);
}

function EventsDisplay({
  details,
  metadata,
}: {
  details: string;
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const parsedEvents = useMemo(() => parseEventsFromDetails(details), [details]);
  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

  if (parsedEvents.length === 0) {
    return <p className="text-muted-foreground text-sm">No events to display</p>;
  }

  return (
    <div className="space-y-4">
      {parsedEvents.map((contract, contractIndex) => (
        <div key={`contract-${contract.contractAddress || contractIndex}`} className="space-y-3">
          {/* Contract Header */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{contract.contractName}</span>
            {contract.contractAddress && (
              <a
                href={buildAddressLink(contract.contractAddress, effectiveMetadata)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs bg-muted/50 px-2 py-0.5 rounded hover:underline inline-flex items-center gap-1 text-muted-foreground"
              >
                {contract.contractAddress.slice(0, 6)}...{contract.contractAddress.slice(-4)}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Events */}
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            {contract.events.map((event, eventIndex) => (
              <div
                key={`event-${contractIndex}-${eventIndex}`}
                className="bg-muted/30 rounded-md p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {event.name}
                  </Badge>
                </div>
                {event.params.length > 0 && (
                  <div className="space-y-1">
                    {event.params.map((param, paramIndex) => {
                      const isLongHex = isHexValue(param.value) && param.value.length > 42;
                      const displayValue = isLongHex ? truncateHex(param.value) : param.value;
                      const isAddress = isHexValue(param.value) && param.value.length === 42;

                      return (
                        <div
                          key={`param-${contractIndex}-${eventIndex}-${paramIndex}`}
                          className="flex items-start gap-2 text-sm"
                        >
                          <span className="text-muted-foreground min-w-[100px] flex-shrink-0">
                            {param.name}:
                          </span>
                          {isAddress ? (
                            <a
                              href={buildAddressLink(param.value, effectiveMetadata)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs hover:underline inline-flex items-center gap-1 text-blue-600"
                            >
                              {truncateHex(param.value, 16)}
                              <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          ) : (
                            <span
                              className={`font-mono text-xs break-all ${isLongHex ? 'text-muted-foreground' : ''}`}
                              title={isLongHex ? param.value : undefined}
                            >
                              {displayValue}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Helper components
function ExpandableCheckItem({
  check,
  stateChanges,
  metadata,
}: {
  check: SimulationCheck;
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [formattedDetails, setFormattedDetails] = useState<React.ReactNode | null>(null);
  const [hasComputedFormattedDetails, setHasComputedFormattedDetails] = useState(false);

  const getStatusIcon = () => {
    if (check.status === 'warning') {
      return <AlertTriangleIcon className="h-5 w-5 text-yellow-500" />;
    }
    if (check.status === 'failed') {
      return <AlertTriangleIcon className="h-5 w-5 text-red-500" />;
    }
    if (check.status === 'skipped') {
      return <SkipForwardIcon className="h-5 w-5 text-gray-400" />;
    }
    return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
  };

  const getStatusBadge = () => {
    if (check.status === 'warning') {
      const hasWarningMessages = check.warnings && check.warnings.length > 0;
      const warningBadge = (
        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
          Warning
        </Badge>
      );

      // If there are warning messages, wrap in tooltip
      if (hasWarningMessages) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>{warningBadge}</TooltipTrigger>
            <TooltipContent
              side="left"
              className="max-w-xs bg-yellow-50 text-yellow-900 border-yellow-200"
            >
              <ul className="list-disc list-inside space-y-1 text-xs">
                {check.warnings!.map((warning, idx) => (
                  <li key={`tooltip-warning-${idx}`}>{warning}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      }

      return warningBadge;
    }
    if (check.status === 'failed') {
      const hasErrorMessages = check.errors && check.errors.length > 0;
      const failedBadge = <Badge variant="destructive">Failed</Badge>;

      // If there are error messages, wrap in tooltip
      if (hasErrorMessages) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>{failedBadge}</TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs bg-red-50 text-red-900 border-red-200">
              <ul className="list-disc list-inside space-y-1 text-xs">
                {check.errors!.map((error, idx) => (
                  <li key={`tooltip-error-${idx}`}>{error}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      }

      return failedBadge;
    }
    if (check.status === 'skipped') {
      return (
        <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">
          Skipped
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
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);

    if (nextExpanded && !hasComputedFormattedDetails && shouldComputeFormattedDetails) {
      setFormattedDetails(computeFormattedDetails());
      setHasComputedFormattedDetails(true);
    }
  };

  // Check if this is a state changes check
  const isStateChangesCheck = check.title.toLowerCase().includes('state changes');

  // Check if this is a verification check (touched or targets verified on Sourcify/block explorer)
  const isVerificationCheck =
    check.title.toLowerCase().includes('verified on sourcify') ||
    check.title.toLowerCase().includes('verified on block explorer');
  // Check if this is a proxy resolution check
  const isProxyResolutionCheck = check.title.toLowerCase().includes('proxy implementation');

  // Check if this is a treasury movement check
  const isTreasuryMovementCheck = check.title.toLowerCase().includes('treasury movement');

  // Check if this is a security analysis check (slither/solc)
  const isSecurityCheck =
    check.title.toLowerCase().includes('slither') || check.title.toLowerCase().includes('solc');

  // Check if this is an events check
  const isEventsCheck = check.title.toLowerCase().includes('events emitted');

  // Parse treasury movement data if applicable
  const treasuryData = useMemo(() => {
    if (!isTreasuryMovementCheck) return null;

    const warnings = check.warnings ?? [];

    if (isTreasuryMovementCheckDataV1(check.data)) {
      return treasuryMovementDataToViewModel(check.data, warnings);
    }

    if (!check.details) return null;
    return parseTreasuryMovementDetails(check.details);
  }, [isTreasuryMovementCheck, check.data, check.details, check.warnings]);

  const shouldComputeFormattedDetails =
    !!check.details &&
    !isStateChangesCheck &&
    !(isVerificationCheck && !!check.details) &&
    !(isProxyResolutionCheck && !!check.details) &&
    !(isTreasuryMovementCheck && !!treasuryData);

  const stateChangesSignature = useMemo(() => {
    if (!stateChanges || stateChanges.length === 0) return 'none';
    const first = stateChanges[0];
    const last = stateChanges[stateChanges.length - 1];
    return `${stateChanges.length}:${first.contract}:${first.key}:${last.contract}:${last.key}`;
  }, [stateChanges]);

  const metadataSignature = useMemo(() => {
    if (!metadata) return 'none';
    const placeholderCount = metadata.placeholderAddresses?.length ?? 0;
    const addressLabelCount = metadata.addressLabels
      ? Object.keys(metadata.addressLabels).length
      : 0;
    return `${metadata.proposalId}:${metadata.chainId ?? ''}:${metadata.blockExplorerBaseUrl ?? ''}:${placeholderCount}:${addressLabelCount}`;
  }, [metadata]);

  const detailsSignature = useMemo(() => {
    if (!check.details) return 'none';
    const length = check.details.length;
    const head = check.details.slice(0, 64);
    const tail = check.details.slice(-64);
    return `${length}:${head}:${tail}`;
  }, [check.details]);

  const formattedDetailsResetKey = useMemo(() => {
    return [
      shouldComputeFormattedDetails ? '1' : '0',
      check.title,
      detailsSignature,
      isStateChangesCheck ? '1' : '0',
      isSecurityCheck ? '1' : '0',
      isEventsCheck ? '1' : '0',
      stateChangesSignature,
      metadataSignature,
    ].join('|');
  }, [
    shouldComputeFormattedDetails,
    check.title,
    detailsSignature,
    isStateChangesCheck,
    isSecurityCheck,
    isEventsCheck,
    stateChangesSignature,
    metadataSignature,
  ]);

  useEffect(() => {
    if (!formattedDetailsResetKey) return;
    setFormattedDetails(null);
    setHasComputedFormattedDetails(false);
  }, [formattedDetailsResetKey]);

  // Format the details content as React components (computed lazily on first expand)
  const computeFormattedDetails = useCallback((): React.ReactNode | null => {
    if (!check.details) return null;

    // Use SecurityAnalysisOutput for slither/solc checks
    if (isSecurityCheck) {
      return <SecurityAnalysisOutput details={check.details} checkTitle={check.title} />;
    }

    // Use EventsDisplay for events checks
    if (isEventsCheck) {
      return <EventsDisplay details={check.details} metadata={metadata} />;
    }

    // Pre-process the raw details to remove all instances of "**Info**:" and similar patterns
    let preprocessedDetails = check.details;

    // First, handle the specific case of "**Info**: - Uni (Uniswap)"
    preprocessedDetails = preprocessedDetails.replace(
      /\*\*Info\*\*: - ([A-Za-z0-9]+ \([A-Za-z0-9]+\))/g,
      '$1',
    );

    // Then remove all other variations of Info/Warning prefixes
    preprocessedDetails = preprocessedDetails
      .replace(/\*\*Info\*\*:/g, '')
      .replace(/\*\*Warnings\*\*:/g, '')
      .replace(/Info:/g, '')
      .replace(/Warnings:/g, '')
      .replace(/^- \*\*Info\*\*:/gm, '')
      .replace(/^-\s*\*\*Info\*\*:/gm, '')
      .replace(/^-\s*Info:/gm, '')
      .replace(/^-\s*/gm, '')
      // Remove "Warning:" prefix from lines (we show warning status via badge)
      .replace(/^Warning:\s*/gm, '')
      // Remove redundant "(simulation placeholder)" text since we show the badge
      .replace(/\s*\(simulation placeholder\)/g, '');

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

    return (
      <>
        {lines.map((line: string, index: number) => {
          // Final cleanup for any remaining Info/Warning prefixes
          let processedLine = line
            .replace(/^\*\*Info\*\*:\s*/, '')
            .replace(/^\*\*Info\*\*:\s*-\s*/, '')
            .replace(/^Info:\s*/, '')
            .replace(/^Info\s*-\s*/, '')
            .replace(/^Warning:\s*/, '')
            .replace(/\s*\(simulation placeholder\)/g, '');

          // Remove "Info:" if it appears at the beginning of a line
          processedLine = processedLine
            .replace(/^\*\*Info\*\*:\s*/, '')
            .replace(/^\*\*Info\*\*:\s*-\s*/, '');

          // Special case for "**Info**: - Uni (Uniswap)"
          if (processedLine.match(/^\*\*Info\*\*:\s*-\s*[A-Za-z0-9]+ \([A-Za-z0-9]+\)/)) {
            processedLine = processedLine.replace(/^\*\*Info\*\*:\s*-\s*/, '');
          }

          // Direct check for the exact pattern "**Info**: - Uni (Uniswap)"
          const uniMatch = processedLine.match(/^\*\*Info\*\*: - ([A-Za-z0-9]+ \([A-Za-z0-9]+\))/);
          if (uniMatch) {
            processedLine = uniMatch[1];
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

          // Check if this is a target line with contract status (verification or selfdestruct checks)
          const isTargetLine =
            processedLine.includes('Contract (verified)') ||
            processedLine.includes('EOA (verification not applicable)') ||
            processedLine.includes('Contract (looks safe)') ||
            processedLine.includes('Contract (unverified)') ||
            processedLine.includes('Trusted contract') ||
            processedLine.includes('Contract (with DELEGATECALL)') ||
            processedLine.includes('Contract (with SELFDESTRUCT)') ||
            processedLine.includes('EOA (may have code later)') ||
            processedLine.includes(': EOA') ||
            processedLine.includes('Trusted contract (not checked)');

          if (isTargetLine) {
            // Extract target address from markdown link format [address](url) or backtick format
            const markdownLinkMatch = processedLine.match(
              /\[(0x[a-fA-F0-9]{40})\]\(https?:\/\/[^)]+\)/,
            );
            const backtickMatch =
              processedLine.match(/\[`(0x[a-fA-F0-9]{40})`\]/) ||
              processedLine.match(/at `(0x[a-fA-F0-9]{40})`/);
            const targetMatch = markdownLinkMatch || backtickMatch;

            if (targetMatch) {
              const address = targetMatch[1];
              // Get the contract status - handle both verification and selfdestruct checks
              let status = 'Unknown';
              if (processedLine.includes('Contract (verified)')) status = 'Verified';
              else if (processedLine.includes('Contract (unverified)')) status = 'Unverified';
              else if (processedLine.includes('EOA (verification not applicable)')) status = 'EOA';
              else if (processedLine.includes('Contract (looks safe)')) status = 'Looks Safe';
              else if (processedLine.includes('Trusted contract (not checked)')) status = 'Trusted';
              else if (processedLine.includes('Trusted contract')) status = 'Trusted';
              else if (processedLine.includes('Contract (with DELEGATECALL)'))
                status = 'Contract (with DELEGATECALL)';
              else if (processedLine.includes('Contract (with SELFDESTRUCT)'))
                status = 'Contract (with SELFDESTRUCT)';
              else if (processedLine.includes('EOA (may have code later)'))
                status = 'EOA (may have code later)';
              else if (processedLine.includes(': EOA')) status = 'EOA';

              // Determine status badge color
              const statusColor =
                status === 'Verified' || status === 'Looks Safe' || status === 'Trusted'
                  ? 'bg-green-100 text-green-800 border-green-300'
                  : status === 'Unverified' || status === 'Contract (with SELFDESTRUCT)'
                    ? 'bg-red-100 text-red-800 border-red-300'
                    : status === 'Contract (with DELEGATECALL)' ||
                        status === 'EOA (may have code later)'
                      ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                      : 'bg-gray-100 text-gray-700 border-gray-300';

              // Format the target with proper styling - badges right-aligned
              return (
                <div key={`target-${address}-${index}`} className="mb-2">
                  <div className="flex items-center justify-between gap-2 p-2 bg-muted/30 rounded-md">
                    <a
                      href={buildAddressLink(address, effectiveMetadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs hover:underline inline-flex items-center gap-1 min-w-0 truncate"
                    >
                      {address}
                      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
                    </a>
                    <div className="flex items-center gap-2 shrink-0">
                      {isPlaceholderAddress(address, effectiveMetadata) && (
                        <SimulationPlaceholderBadge />
                      )}
                      <Badge variant="outline" className={`text-xs ${statusColor}`}>
                        {status}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            }
          }

          // Check if this is a decoded calldata line (from check-decode-calldata)
          const isDecodedCalldataLine =
            processedLine.includes('calls `') &&
            processedLine.includes('` on ') &&
            (processedLine.includes('(decoded from ABI)') ||
              processedLine.includes('(decoded from signature)'));

          if (isDecodedCalldataLine) {
            // Parse the line: `0xAddress` calls `functionName(args)` on ContractName at `0xTarget` (decoded from ...)
            const callerMatch = processedLine.match(/`(0x[a-fA-F0-9]{40})`\s*calls/);
            const functionMatch = processedLine.match(/calls\s*`([^`]+)`\s*on/);
            const targetMatch = processedLine.match(/on\s+(\S+)\s+at\s+`(0x[a-fA-F0-9]{40})`/);
            const decodedFromMatch = processedLine.match(/\((decoded from [^)]+)\)/);

            const caller = callerMatch?.[1];
            const functionCall = functionMatch?.[1];
            const contractName = targetMatch?.[1];
            const targetAddress = targetMatch?.[2];
            const decodedFrom = decodedFromMatch?.[1] || 'decoded';

            // Truncate long function calls (especially hex args)
            const truncateFunctionCall = (fn: string) => {
              if (fn.length <= 60) return fn;
              // Find the function name and opening paren
              const parenIndex = fn.indexOf('(');
              if (parenIndex === -1) return `${fn.slice(0, 60)}...`;
              const fnName = fn.slice(0, parenIndex);
              const args = fn.slice(parenIndex + 1, -1);
              // Truncate each arg if it's a long hex string
              const truncatedArgs = args.split(', ').map((arg) => {
                if (arg.startsWith('0x') && arg.length > 20) {
                  return `${arg.slice(0, 10)}...${arg.slice(-6)}`;
                }
                return arg;
              });
              return `${fnName}(${truncatedArgs.join(', ')})`;
            };

            return (
              <div key={`calldata-${index}`} className="mb-2">
                <div className="flex items-start justify-between gap-3 p-3 bg-muted/30 rounded-md">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {caller && (
                        <a
                          href={buildAddressLink(caller, effectiveMetadata)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded hover:underline inline-flex items-center gap-1"
                        >
                          {caller.slice(0, 10)}...{caller.slice(-8)}
                          <ExternalLinkIcon className="h-3 w-3" />
                        </a>
                      )}
                      <span className="text-muted-foreground text-sm">calls</span>
                      {functionCall && (
                        <code className="font-mono text-xs bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded break-all">
                          {truncateFunctionCall(functionCall)}
                        </code>
                      )}
                    </div>
                    {(contractName || targetAddress) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                        <span>on</span>
                        {contractName && (
                          <span className="font-medium text-foreground">{contractName}</span>
                        )}
                        {targetAddress && (
                          <>
                            <span>at</span>
                            <a
                              href={buildAddressLink(targetAddress, effectiveMetadata)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs hover:underline inline-flex items-center gap-1"
                            >
                              {targetAddress.slice(0, 10)}...{targetAddress.slice(-8)}
                              <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-xs bg-green-100 text-green-800 border-green-300 shrink-0"
                  >
                    {decodedFrom}
                  </Badge>
                </div>
              </div>
            );
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
                <div key={`calldata-${formattedLine.substring(0, 30)}`} className="mb-3">
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
              <div key={`calldata-${formattedLine.substring(0, 30)}`} className="mb-3">
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

          // Parse markdown links [address](url) and backtick addresses `address`
          // Combined regex to match both formats
          const combinedRegex =
            /\[(0x[a-fA-F0-9]{40})\]\(https?:\/\/[^)]+\)|`(0x[a-fA-F0-9]{40})`/g;
          let combinedMatch: RegExpExecArray | null;

          combinedMatch = combinedRegex.exec(processedLine);
          while (combinedMatch !== null) {
            // Add text before the match
            if (combinedMatch.index > lastIndex) {
              parts.push(processedLine.substring(lastIndex, combinedMatch.index));
            }

            // Get address from either capture group (markdown link or backtick)
            const address = combinedMatch[1] || combinedMatch[2];
            const isPlaceholder = isPlaceholderAddress(address, effectiveMetadata);
            parts.push(
              <span
                key={`address-wrapper-${address}-${combinedMatch.index}`}
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

            lastIndex = combinedMatch.index + combinedMatch[0].length;
            combinedMatch = combinedRegex.exec(processedLine);
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
              <div key={`info-line-${index}`} className="mb-3">
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
  }, [
    check.details,
    check.title,
    isStateChangesCheck,
    isSecurityCheck,
    isEventsCheck,
    stateChanges,
    metadata,
  ]);

  // Status-based styling
  const getStatusStyles = () => {
    switch (check.status) {
      case 'failed':
        return {
          border: 'border-l-4 border-l-red-500 border-t border-r border-b border-red-200',
          bg: 'bg-red-50/50',
          hoverBg: 'hover:bg-red-50',
        };
      case 'warning':
        return {
          border: 'border-l-4 border-l-yellow-500 border-t border-r border-b border-yellow-200',
          bg: 'bg-yellow-50/50',
          hoverBg: 'hover:bg-yellow-50',
        };
      case 'skipped':
        return {
          border: 'border-l-4 border-l-gray-300 border-t border-r border-b border-gray-200',
          bg: 'bg-gray-50/30',
          hoverBg: 'hover:bg-gray-50',
        };
      default:
        return {
          border: 'border-l-4 border-l-green-500 border-t border-r border-b border-muted',
          bg: '',
          hoverBg: 'hover:bg-muted/50',
        };
    }
  };

  const statusStyles = getStatusStyles();

  return (
    <div className={`rounded-md overflow-hidden ${statusStyles.border} ${statusStyles.bg}`}>
      <button
        type="button"
        className={`w-full p-3 sm:p-4 text-left ${statusStyles.hoverBg} transition-colors cursor-pointer flex justify-between items-start gap-2`}
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
          <span className="shrink-0 mt-0.5">{getStatusIcon()}</span>
          <h4 className="font-medium text-sm sm:text-base leading-snug">{check.title}</h4>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:block">{getStatusBadge()}</span>
          {(check.details || check.skipReason || isTreasuryMovementCheck) &&
            (isExpanded ? (
              <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
            ))}
        </div>
      </button>
      {isExpanded && (check.details || check.skipReason || isTreasuryMovementCheck) && (
        <div className="px-3 pb-4 sm:px-4 sm:pb-4 sm:pl-12 text-sm border-t border-muted/50 bg-background/50">
          {/* Show warning/error reason at the top if it's a meaningful summary (not just listing items) */}
          {check.status === 'warning' &&
            check.warnings &&
            check.warnings.length > 0 &&
            // Only show if warnings are short summaries, not long lists of items
            check.warnings.some((w) => !w.includes('0x') && w.length < 200) && (
              <div className="mt-4 mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                  <div className="text-yellow-800 text-sm">
                    <span className="font-medium">Why this check has warnings:</span>
                    <ul className="mt-1 list-disc list-inside space-y-1">
                      {check.warnings
                        .filter((w) => !w.includes('0x') && w.length < 200)
                        .map((w, i) => (
                          <li key={`reason-${i}`}>{w}</li>
                        ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          {check.status === 'failed' && check.errors && check.errors.length > 0 && (
            <div className="mt-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-red-800 text-sm">
                  <span className="font-medium">Why this check failed:</span>
                  <ul className="mt-1 list-disc list-inside space-y-1">
                    {check.errors.map((e, i) => (
                      <li key={`error-${i}`}>{e}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
          {check.status === 'skipped' && check.skipReason ? (
            <div className="mt-4">
              <p className="text-muted-foreground italic">{check.skipReason}</p>
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
          ) : isVerificationCheck && check.details ? (
            <div className="mt-4">
              <ContractVerificationList details={check.details} />
            </div>
          ) : isProxyResolutionCheck && check.details ? (
            <div className="mt-4">
              <ProxyResolutionDetails details={check.details} />
            </div>
          ) : isTreasuryMovementCheck && treasuryData ? (
            <div className="mt-4">
              <TreasuryMovementCheck {...treasuryData} />
            </div>
          ) : (
            <div className="mt-4 whitespace-pre-wrap">{formattedDetails}</div>
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

  const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);
  const isDecimalInteger = (value: string) => /^-?\d+$/.test(value);

  const isUniswapV3Slot0Change =
    stateChange.contract.toLowerCase().includes('uniswapv3pool') &&
    isHex32(oldValueCleaned) &&
    isHex32(newValueCleaned) &&
    /^0x0{64}$/i.test(stateChange.key);

  // Determine if the change is a simple value change or a complex one
  const isNumericChange = isDecimalInteger(oldValueCleaned) && isDecimalInteger(newValueCleaned);
  const isAddressChange = oldValueCleaned.startsWith('0x') && newValueCleaned.startsWith('0x');
  const isBooleanChange =
    (oldValueCleaned === 'true' || oldValueCleaned === 'false') &&
    (newValueCleaned === 'true' || newValueCleaned === 'false');

  // Calculate difference for numeric values
  const getDifference = () => {
    // Special-case: Uniswap V3 Pool `slot0` packing can be decoded for a readable delta (feeProtocol/unlocked).
    if (isUniswapV3Slot0Change) {
      try {
        const oldSlot0 = BigInt(oldValueCleaned);
        const newSlot0 = BigInt(newValueCleaned);

        const feeProtocolOld = Number((oldSlot0 >> 232n) & 0xffn);
        const feeProtocolNew = Number((newSlot0 >> 232n) & 0xffn);

        // Uniswap V3 packs feeProtocol0 in the low 4 bits and feeProtocol1 in the high 4 bits.
        const feeProtocol0Old = feeProtocolOld & 0x0f;
        const feeProtocol1Old = feeProtocolOld >> 4;
        const feeProtocol0New = feeProtocolNew & 0x0f;
        const feeProtocol1New = feeProtocolNew >> 4;

        const unlockedOld = ((oldSlot0 >> 240n) & 0xffn) === 1n;
        const unlockedNew = ((newSlot0 >> 240n) & 0xffn) === 1n;

        return (
          <div className="bg-muted p-3 rounded-md mt-4 space-y-2">
            <div className="text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Decoded (Uniswap V3 slot0)</span>
            </div>
            <div className="text-xs font-mono">
              feeProtocol (raw): {feeProtocolOld} → {feeProtocolNew}
            </div>
            <div className="text-xs font-mono">
              feeProtocol (token0, token1): ({feeProtocol0Old}, {feeProtocol1Old}) → (
              {feeProtocol0New}, {feeProtocol1New})
            </div>
            <div className="text-xs font-mono">
              unlocked: {String(unlockedOld)} → {String(unlockedNew)}
            </div>
          </div>
        );
      } catch {
        // fall through to generic rendering
      }
    }

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

    // Avoid misleading diffs for raw storage slots (hex32 values).
    if (isHex32(oldValueCleaned) && isHex32(newValueCleaned)) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm text-muted-foreground">Change</div>
          <div className="font-medium text-xs">Storage slot value changed</div>
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
          {isHex32(stateChange.key) ? (
            <div className="text-xs bg-muted-foreground/10 px-2 py-1 rounded text-muted-foreground">
              {isUniswapV3Slot0Change ? 'slot0' : 'Slot'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted-foreground/20 px-2 py-1 rounded">
            {stateChange.key}
          </code>
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
