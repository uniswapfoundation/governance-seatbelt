'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  CrossChainJobPreview,
  Proposal,
  SimulationCheck,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { formatCallPreview } from '@/lib/call-preview';
import { resolveChainName } from '@/lib/chain-name';
import { formatRawLogFromJson } from '@/lib/raw-log';
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  decodeFunctionData,
  formatEther,
  getAddress,
  parseAbiItem,
  toFunctionSelector,
} from 'viem';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';
import { ChainLogo } from './structured-report/ChainLogo';
import {
  formatBridgeType,
  formatCrossChainCall,
  getCrossChainJobSourceLabel,
  getCrossChainStepTarget,
  getCrossChainStepTargetLabel,
  getCrossChainTransportLabel,
  groupCrossChainJobsByDisplayedSource,
} from './structured-report/cross-chain';

type RiskTag = 'Upgrade' | 'Admin/Role' | 'Token Approval' | 'Token Transfer' | 'ETH Value';

const RISK_TAG_STYLES: Record<RiskTag, string> = {
  Upgrade: 'bg-red-100 text-red-800 border-red-200',
  'Admin/Role': 'bg-orange-100 text-orange-800 border-orange-200',
  'Token Approval': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Token Transfer': 'bg-blue-100 text-blue-800 border-blue-200',
  'ETH Value': 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

const hoverCopyClasses =
  'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity';

function getTrustWalletChainSlug(chainId: number | undefined) {
  if (!chainId) return null;
  if (chainId === mainnet.id) return 'ethereum';
  if (chainId === arbitrum.id) return 'arbitrum';
  if (chainId === optimism.id) return 'optimism';
  if (chainId === base.id) return 'base';
  return null;
}

function getTrustWalletTokenLogoUrl(chainId: number | undefined, address: string) {
  const slug = getTrustWalletChainSlug(chainId);
  if (!slug) return null;

  try {
    const checksum = getAddress(address);
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${checksum}/logo.png`;
  } catch {
    return null;
  }
}

function stringifyDecodedValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return JSON.stringify(
      value.map((v) => (typeof v === 'bigint' ? v.toString() : v)),
      null,
      0,
    );
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function getAddressLabelFor(
  address: string,
  labels?: StructuredSimulationReport['metadata']['addressLabels'],
) {
  if (!labels) return undefined;

  const direct = labels[address];
  if (direct) return direct;

  const lowerAddress = address.toLowerCase();
  for (const [key, value] of Object.entries(labels)) {
    if (key.toLowerCase() === lowerAddress) return value;
  }

  return undefined;
}

function TokenLogo({
  address,
  chainId,
  className,
}: {
  address: string;
  chainId: number | undefined;
  className?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const url = getTrustWalletTokenLogoUrl(chainId, address);

  if (!url || hidden) return null;

  return (
    <img
      src={url}
      alt=""
      className={className ?? 'h-5 w-5 rounded-full'}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHidden(true)}
    />
  );
}

function ExplorerAddressLink({
  address,
  baseUrl,
  className,
  children,
}: {
  address: string;
  baseUrl: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={`${baseUrl}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'hover:underline'}
    >
      {children ?? address}
    </a>
  );
}

function AddressValue({
  address,
  baseUrl,
  labels,
  chainId,
  variant = 'inline',
}: {
  address: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
  chainId: number | undefined;
  variant?: 'header' | 'inline';
}) {
  const label = getAddressLabelFor(address, labels);
  const isHeader = variant === 'header';

  if (isHeader) {
    return (
      <div className="group flex items-start gap-2 min-w-0 w-full">
        {label?.type === 'token' ? (
          <TokenLogo address={address} chainId={chainId} className="h-6 w-6 rounded-full" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {label?.label ? (
              <ExplorerAddressLink
                address={address}
                baseUrl={baseUrl}
                className="text-sm font-medium hover:underline break-all min-w-0"
              >
                {label.label}
              </ExplorerAddressLink>
            ) : (
              <ExplorerAddressLink
                address={address}
                baseUrl={baseUrl}
                className="text-sm font-mono hover:underline break-all"
              >
                {address}
              </ExplorerAddressLink>
            )}
            {label?.type && label.type !== 'token' ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {label.type}
              </Badge>
            ) : null}
          </div>
          {label?.label && (
            <div className="text-xs font-mono text-muted-foreground break-all">
              <ExplorerAddressLink address={address} baseUrl={baseUrl} className="hover:underline">
                {address.slice(0, 6)}…{address.slice(-4)}
              </ExplorerAddressLink>
            </div>
          )}
        </div>
        <CopyButton value={address} className={`h-6 w-6 ${hoverCopyClasses}`} />
      </div>
    );
  }

  return (
    <div className="group flex w-full items-start gap-2 min-w-0">
      <div className="min-w-0 flex-1 space-y-1">
        {label?.label && (
          <ExplorerAddressLink
            address={address}
            baseUrl={baseUrl}
            className="block text-xs hover:underline break-all"
          >
            {label.label}
          </ExplorerAddressLink>
        )}
        <ExplorerAddressLink
          address={address}
          baseUrl={baseUrl}
          className="block text-xs font-mono text-muted-foreground hover:underline break-all"
        >
          {address}
        </ExplorerAddressLink>
      </div>
      <CopyButton value={address} className={`h-4 w-4 shrink-0 ${hoverCopyClasses}`} />
    </div>
  );
}

function ValueWithCopy({
  value,
  className,
  truncate = true,
}: {
  value: string;
  className?: string;
  truncate?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLongValue = value.length > 96; // Keep addresses and uint256 values intact.
  const isExpandable = truncate && isLongValue;
  const shouldTruncate = isExpandable && !expanded;

  const displayValue = shouldTruncate ? `${value.slice(0, 20)}...${value.slice(-16)}` : value;

  const handleToggle = isExpandable ? () => setExpanded(!expanded) : undefined;
  const handleKeyDown = isExpandable
    ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(!expanded);
        }
      }
    : undefined;

  return (
    <div className={`group flex w-full items-start gap-2 min-w-0 ${className || ''}`}>
      <span
        className={`min-w-0 flex-1 break-all font-mono text-xs ${shouldTruncate ? 'cursor-pointer hover:text-foreground' : ''} ${isLongValue && !expanded ? 'text-muted-foreground' : ''}`}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        tabIndex={isExpandable ? 0 : undefined}
        role={isExpandable ? 'button' : undefined}
        aria-expanded={isExpandable ? expanded : undefined}
        aria-label={isExpandable ? (expanded ? 'Collapse value' : 'Expand value') : undefined}
        title={isExpandable ? (expanded ? 'Click to collapse' : 'Click to expand') : undefined}
      >
        {displayValue}
      </span>
      <CopyButton value={value} className={`h-4 w-4 shrink-0 ${hoverCopyClasses}`} />
    </div>
  );
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);

      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`h-5 w-5 p-0 cursor-pointer shrink-0 ${className || ''}`}
      onClick={handleCopy}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-3 w-3 text-green-500" />
      ) : (
        <CopyIcon className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

function parseLogsByEmitter(checks: SimulationCheck[]) {
  const logsCheck = checks.find((c) => c.checkId === 'checkLogs');
  const info = logsCheck?.info ?? [];

  const byAddress = new Map<string, { contract: string; events: string[] }>();

  let currentAddress: string | null = null;
  let currentContract = '';

  for (const line of info) {
    const header = line.match(/^(.+?) at `(0x[a-fA-F0-9]{40})`$/);
    if (header) {
      currentContract = header[1].trim();
      currentAddress = header[2].toLowerCase();
      if (!byAddress.has(currentAddress)) {
        byAddress.set(currentAddress, { contract: currentContract, events: [] });
      }
      continue;
    }

    const eventLine = line.match(/^\s+`(.+?)`$/);
    if (eventLine && currentAddress) {
      byAddress.get(currentAddress)?.events.push(eventLine[1]);
      continue;
    }

    const legacyUndecodedLine = line.match(/^\s+Undecoded log:\s+`(.+?)`$/);
    if (legacyUndecodedLine && currentAddress) {
      byAddress.get(currentAddress)?.events.push(formatRawLogFromJson(legacyUndecodedLine[1]));
    }
  }

  return byAddress;
}

function parseDecodedSentence(decodedText: string) {
  // Examples:
  // `0xFROM` calls `transfer(0xTO, 123)` on Name at `0xTARGET` (decoded from ABI)
  // `0xFROM` transfers 0.1 ETH to `0xTARGET` (formatted)
  const callMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+calls\s+`(.+?)`\s+on\s+(?:(.+?)\s+at\s+)?`(0x[a-fA-F0-9]{40})`/,
  );
  if (callMatch) {
    const fnCall = callMatch[2];
    const fnMatch = fnCall.match(/^([a-zA-Z0-9_]+)\((.*)\)$/);
    const fnName = fnMatch?.[1] ?? null;

    return {
      kind: 'call' as const,
      fnCall,
      fnName,
      from: callMatch[1],
      source: decodedText.match(/\(decoded from (.+?)\)$/)?.[1],
      implementation: decodedText.match(/implementation ABI at `(0x[a-fA-F0-9]{40})`/)?.[1],
    };
  }

  const ethTransferMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+transfers\s+(.+?)\s+ETH\s+to\s+`(0x[a-fA-F0-9]{40})`/,
  );
  if (ethTransferMatch) {
    return { kind: 'eth-transfer' as const };
  }

  return { kind: 'unknown' as const };
}

function getFunctionName(signature: string | undefined, decodedText?: string) {
  if (signature && !signature.startsWith('0x')) {
    return signature.split('(')[0]?.trim() || null;
  }

  if (decodedText) {
    const match = decodedText.match(/calls\s+`([a-zA-Z0-9_]+)\(/);
    if (match?.[1]) return match[1];
  }

  return null;
}

function getRiskTags(params: {
  signature?: string;
  decodedText?: string;
  value: bigint;
}): RiskTag[] {
  const tags: RiskTag[] = [];
  if (params.value > 0n) tags.push('ETH Value');

  const fn = getFunctionName(params.signature, params.decodedText);
  if (!fn) return tags;

  if (/(upgradeToAndCall|upgradeTo|upgrade|setImplementation|changeAdmin)/i.test(fn)) {
    tags.push('Upgrade');
  }
  if (
    /(transferOwnership|acceptOwnership|setOwner|setAdmin|grantRole|revokeRole|setRoleAdmin)/i.test(
      fn,
    )
  ) {
    tags.push('Admin/Role');
  }
  if (/^approve$/i.test(fn)) tags.push('Token Approval');
  if (/^(transfer|transferFrom)$/i.test(fn)) tags.push('Token Transfer');

  return tags;
}

function formatEthValue(value: bigint) {
  if (value === 0n) return '0 ETH';
  return `${formatEther(value)} ETH`;
}

type DecodedSignatureCall = {
  functionName: string;
  inputs: readonly { name?: string; type: string }[];
  args: readonly unknown[];
  fullCalldata: `0x${string}`;
};

function getFullCalldata(signature: string | undefined, calldata: `0x${string}`): `0x${string}` {
  if (!signature) return calldata;

  const trimmed = signature.trim();
  if (!trimmed || trimmed.startsWith('0x')) return calldata;

  try {
    const selector = toFunctionSelector(trimmed);
    if (calldata.startsWith(selector)) return calldata;
    return `${selector}${calldata.slice(2)}` as `0x${string}`;
  } catch {
    return calldata;
  }
}

function getFunctionAbi(signature: string | undefined) {
  if (!signature?.trim() || signature.startsWith('0x')) return null;
  try {
    const abiItem = parseAbiItem(`function ${signature.trim()}`);
    return abiItem.type === 'function' ? abiItem : null;
  } catch {
    return null;
  }
}

function tryDecodeFromSignature(
  signature: string | undefined,
  calldata: `0x${string}`,
): DecodedSignatureCall | null {
  const abiItem = getFunctionAbi(signature);
  if (!abiItem) return null;
  try {
    const fullCalldata = getFullCalldata(signature, calldata);
    const decoded = decodeFunctionData({ abi: [abiItem], data: fullCalldata });
    return {
      functionName: decoded.functionName,
      args: decoded.args,
      inputs: abiItem.inputs,
      fullCalldata,
    };
  } catch {
    return null;
  }
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[8rem_minmax(0,1fr)] gap-1 sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs break-words">{children}</dd>
    </div>
  );
}

function CallArguments({
  args,
  inputs,
  baseUrl,
  labels,
  chainId,
}: {
  args: readonly unknown[];
  inputs?: readonly { name?: string }[];
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
  chainId: number | undefined;
}) {
  return (
    <div className="space-y-3 text-xs">
      {args.map((arg, index) => {
        const raw = stringifyDecodedValue(arg);
        return (
          <div key={index} className="space-y-1">
            {inputs?.[index]?.name && (
              <p className="text-muted-foreground break-all">{inputs[index].name}</p>
            )}
            <div className="min-w-0">
              {isHexAddress(raw) ? (
                <AddressValue address={raw} baseUrl={baseUrl} labels={labels} chainId={chainId} />
              ) : (
                <ValueWithCopy value={raw} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function parseEventSignature(eventText: string) {
  const match = eventText.match(/^([a-zA-Z0-9_]+)\((.*)\)$/);
  if (!match) return null;

  const [, name, rawParams] = match;
  const parts = rawParams
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean);

  const params = parts
    .map((part) => {
      const m = part.match(/^([^:]+):\s*(.+)$/);
      if (!m) return null;
      return { name: m[1].trim(), value: m[2].trim() };
    })
    .filter(Boolean) as Array<{ name: string; value: string }>;

  return { name, params };
}

function EventRow({
  eventText,
  baseUrl,
  labels,
  chainId,
}: {
  eventText: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
  chainId: number | undefined;
}) {
  const parsed = parseEventSignature(eventText);
  if (!parsed) {
    return (
      <div className="py-2 first:pt-0 last:pb-0 text-xs font-mono break-all text-muted-foreground">
        {eventText}
      </div>
    );
  }

  const couldNotDecode = parsed.name === 'RawLog';
  return (
    <div className="py-3 first:pt-0 last:pb-0 space-y-3">
      <p className="text-sm font-medium">{couldNotDecode ? 'Unrecognized event' : parsed.name}</p>
      {couldNotDecode && (
        <p className="text-xs text-muted-foreground">This report could not identify the event.</p>
      )}
      <dl className="space-y-3">
        {parsed.params.map((p) => {
          const raw = p.value;
          const isAddr = isHexAddress(raw);

          return (
            <DetailField key={`${parsed.name}-${p.name}-${raw}`} label={p.name}>
              {isAddr ? (
                <AddressValue address={raw} baseUrl={baseUrl} labels={labels} chainId={chainId} />
              ) : (
                <ValueWithCopy value={raw} truncate={false} />
              )}
            </DetailField>
          );
        })}
      </dl>
    </div>
  );
}

export function CallGroupedView({
  proposal,
  report,
}: {
  proposal: Proposal;
  report: StructuredSimulationReport;
}) {
  const decodeCheck = report.checks.find((check) => check.checkId === 'checkDecodeCalldata');
  const decodedByIndex = (decodeCheck?.info ?? []).filter((line) => !line.startsWith('Advisory:'));
  const eventsByEmitter = parseLogsByEmitter(report.checks);
  const chainId = report.metadata.chainId;

  const calls = proposal.targets.map((target, index) => {
    const decodedText =
      decodedByIndex.length === proposal.targets.length ? decodedByIndex[index] : undefined;

    const signature = proposal.signatures[index];
    const calldata = proposal.calldatas[index];
    const value = proposal.values[index] ?? 0n;

    const tags = getRiskTags({ signature, decodedText, value });
    const decodedSignature = tryDecodeFromSignature(signature, calldata);

    return {
      index,
      target,
      value,
      signature,
      calldata,
      fullCalldata: decodedSignature?.fullCalldata ?? getFullCalldata(signature, calldata),
      decodedText,
      notes: (decodeCheck?.info ?? []).filter(
        (line) => line.startsWith('Advisory:') && line.toLowerCase().includes(target.toLowerCase()),
      ),
      decoded: decodedText ? parseDecodedSentence(decodedText) : null,
      decodedSignature,
      tags,
    };
  });

  const byTarget = calls.reduce<Record<string, typeof calls>>((acc, call) => {
    const key = call.target.toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(call);
    return acc;
  }, {});

  const baseUrl = report.metadata.blockExplorerBaseUrl ?? 'https://etherscan.io';
  const labels = report.metadata.addressLabels;

  // Summary stats
  const crossChainJobs = report.crossChain?.jobs ?? [];
  const crossChainDestinationCalls = crossChainJobs.reduce(
    (total, job) => total + job.steps.length,
    0,
  );
  const totalMainnetCalls = calls.length;
  const totalCalls = totalMainnetCalls + crossChainDestinationCalls;
  const totalEthValue = calls.reduce((sum, c) => sum + c.value, 0n);
  const allTags = calls.flatMap((c) => c.tags);
  const tagCounts = allTags.reduce<Record<RiskTag, number>>(
    (acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    },
    {} as Record<RiskTag, number>,
  );
  const uniqueTargets = Object.keys(byTarget).length;

  // Cross-chain stats
  const crossChainChains = new Set(crossChainJobs.map((job) => job.chainId));
  const crossChainFailures = crossChainJobs.filter((job) => job.status === 'failure').length;

  if (totalCalls === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
        No calls in this proposal
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm min-w-0">
          <span className="font-medium">
            {totalCalls} call{totalCalls === 1 ? '' : 's'}
          </span>
          <span className="text-muted-foreground">
            {uniqueTargets} contract{uniqueTargets === 1 ? '' : 's'}
          </span>
          {totalEthValue > 0n && (
            <span className="text-muted-foreground">{formatEthValue(totalEthValue)} total</span>
          )}
          {crossChainJobs.length > 0 && (
            <span className="text-muted-foreground">
              {crossChainDestinationCalls} cross-chain destination call
              {crossChainDestinationCalls === 1 ? '' : 's'} ({crossChainChains.size} chain
              {crossChainChains.size === 1 ? '' : 's'})
              {crossChainFailures > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] px-1.5">
                  {crossChainFailures} failed
                </Badge>
              )}
            </span>
          )}
        </div>
        {Object.keys(tagCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(tagCounts) as Array<[RiskTag, number]>).map(([tag, count]) => (
              <Badge
                key={tag}
                variant="outline"
                className={`text-[10px] px-1.5 ${RISK_TAG_STYLES[tag]}`}
              >
                {count} {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {[...(decodeCheck?.errors ?? []), ...(decodeCheck?.warnings ?? [])].map((message, index) => (
        <p key={`decode-warning-${index}`} className="text-sm text-destructive break-words">
          {message}
        </p>
      ))}

      {Object.entries(byTarget).map(([targetKey, targetCalls]) => {
        const target = targetCalls[0]?.target ?? targetKey;

        const totalEth = targetCalls.reduce((sum, c) => sum + c.value, 0n);
        const uniqueTags = Array.from(new Set(targetCalls.flatMap((c) => c.tags)));

        const emitted = eventsByEmitter.get(target.toLowerCase());
        const eventCount = emitted?.events.length ?? 0;

        return (
          <div
            key={targetKey}
            className="rounded-lg border border-border/80 bg-card overflow-hidden"
          >
            {/* Target header with accent bar */}
            <div className="bg-muted/30 border-b border-border/50 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col flex-1 gap-1.5 min-w-0">
                  <AddressValue
                    address={target}
                    baseUrl={baseUrl}
                    labels={labels}
                    chainId={chainId}
                    variant="header"
                  />
                  {uniqueTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {uniqueTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className={`text-[10px] px-2 py-0.5 font-semibold ${RISK_TAG_STYLES[tag]}`}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground text-right max-w-1/2 bg-background/50 px-2 py-1 rounded">
                  <span className="whitespace-nowrap">
                    {targetCalls.length} call{targetCalls.length === 1 ? '' : 's'}
                  </span>
                  {totalEth > 0n && (
                    <span className="block break-all">{formatEthValue(totalEth)}</span>
                  )}
                </div>
              </div>
            </div>

            <h4 className="px-4 pt-4 text-xs font-medium text-muted-foreground">
              {targetCalls.length === 1 ? 'Call' : 'Calls'}
            </h4>
            <div className="divide-y divide-border/60">
              {targetCalls.map((call) => {
                const decoded = call.decoded;
                const decodedSignature = call.decodedSignature;
                const fnLabel =
                  decodedSignature?.functionName ??
                  (decoded?.kind === 'call'
                    ? (decoded.fnName ?? 'Call')
                    : decoded?.kind === 'eth-transfer'
                      ? 'ETH transfer'
                      : (getFunctionName(call.signature, call.decodedText) ?? 'Call'));

                const preview = decodedSignature
                  ? `${fnLabel}(${decodedSignature.args.map(stringifyDecodedValue).join(', ')})`
                  : decoded?.kind === 'call'
                    ? decoded.fnCall
                    : fnLabel;

                return (
                  <details key={`${call.target}-${call.index}`} className="group/call">
                    <summary className="cursor-pointer list-none p-4 flex items-start gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-xs font-bold shrink-0">
                        {call.index + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <code className="text-sm break-all">{formatCallPreview(preview)}</code>
                        {call.value > 0n && <p className="text-xs">{formatEthValue(call.value)}</p>}
                        {call.decodedText?.includes('(not decoded)') && (
                          <p className="text-sm text-destructive">Could not decode this call.</p>
                        )}
                      </div>
                      <ChevronDownIcon className="h-4 w-4 shrink-0 mt-1 text-muted-foreground group-open/call:rotate-180" />
                    </summary>
                    <div className="border-t border-border/60 p-4 space-y-4">
                      <h4 className="text-sm font-medium">Technical details</h4>
                      <dl className="space-y-4">
                        <DetailField label="Target contract">
                          <AddressValue
                            address={call.target}
                            baseUrl={baseUrl}
                            labels={labels}
                            chainId={chainId}
                          />
                        </DetailField>
                        {decoded?.kind === 'call' && (
                          <DetailField label="Called by">
                            <AddressValue
                              address={decoded.from}
                              baseUrl={baseUrl}
                              labels={labels}
                              chainId={chainId}
                            />
                          </DetailField>
                        )}
                        {decodedSignature ? (
                          <DetailField label="Arguments">
                            <CallArguments
                              args={decodedSignature.args}
                              inputs={decodedSignature.inputs}
                              baseUrl={baseUrl}
                              labels={labels}
                              chainId={chainId}
                            />
                          </DetailField>
                        ) : decoded?.kind === 'call' ? (
                          <DetailField label="Full call">
                            <ValueWithCopy value={decoded.fnCall} />
                          </DetailField>
                        ) : null}
                        {decoded?.kind === 'call' && decoded.source && (
                          <DetailField label="Decoded using">
                            {decoded.implementation
                              ? 'Implementation contract’s ABI'
                              : decoded.source}
                          </DetailField>
                        )}
                        {decoded?.kind === 'call' && decoded.implementation && (
                          <DetailField label="Implementation">
                            <AddressValue
                              address={decoded.implementation}
                              baseUrl={baseUrl}
                              chainId={chainId}
                            />
                          </DetailField>
                        )}
                        {call.notes.length > 0 && (
                          <DetailField label="Trace note">
                            {call.notes.map((note, index) => (
                              <p key={index}>
                                {note.includes('no exact trace match')
                                  ? 'No exact call match was found in the simulation trace. The arguments were decoded separately.'
                                  : note.replace(/^Advisory: /, '')}
                              </p>
                            ))}
                          </DetailField>
                        )}
                        {call.signature && (
                          <DetailField label="Signature">
                            <ValueWithCopy value={call.signature} />
                          </DetailField>
                        )}
                        {call.value > 0n && (
                          <DetailField label="Value (wei)">
                            <ValueWithCopy value={call.value.toString()} />
                          </DetailField>
                        )}
                        <DetailField label="Raw calldata">
                          <ValueWithCopy value={call.fullCalldata} />
                        </DetailField>
                        {decoded?.kind === 'unknown' && call.decodedText && (
                          <DetailField label="Report note">
                            {call.decodedText.replaceAll('`', '')}
                          </DetailField>
                        )}
                      </dl>
                    </div>
                  </details>
                );
              })}
            </div>

            {eventCount > 0 && (
              <section
                className="border-t border-border/60 px-4 py-4 space-y-3"
                aria-label="Events"
              >
                <h4 className="text-xs font-medium text-muted-foreground">Events</h4>
                <div className="divide-y divide-border/60">
                  {(emitted?.events ?? []).map((eventText, index) => (
                    <EventRow
                      key={`${targetKey}-event-${index}`}
                      eventText={eventText}
                      baseUrl={baseUrl}
                      labels={labels}
                      chainId={chainId}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        );
      })}

      {/* Cross-chain calls */}
      <CrossChainCallsSection jobs={report.crossChain?.jobs ?? []} labels={labels} />
    </div>
  );
}

function CrossChainCallsSection({
  jobs,
  labels,
}: {
  jobs: CrossChainJobPreview[];
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
}) {
  if (jobs.length === 0) return null;

  const byChain = jobs.reduce<Record<number, CrossChainJobPreview[]>>((acc, job) => {
    if (!acc[job.chainId]) acc[job.chainId] = [];
    acc[job.chainId].push(job);
    return acc;
  }, {});

  const sortedChainEntries = Object.entries(byChain).sort((a, b) => {
    const aChainId = Number(a[0]);
    const bChainId = Number(b[0]);
    const aName = resolveChainName(aChainId, a[1][0]?.chainName);
    const bName = resolveChainName(bChainId, b[1][0]?.chainName);
    return aName.localeCompare(bName);
  });

  return (
    <>
      {sortedChainEntries.map(([chainIdStr, chainJobs]) => {
        const chainId = Number(chainIdStr);
        const chainName = resolveChainName(chainId, chainJobs[0]?.chainName);
        const explorerBaseUrl = chainJobs[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
        const bridgeType = formatBridgeType(chainJobs[0]?.bridgeType);
        const failedCount = chainJobs.filter((job) => job.status !== 'success').length;

        return (
          <div key={chainId} className="space-y-3">
            {/* Chain header */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <ChainLogo chainId={chainId} size={20} />
                <span className="font-medium text-sm" title={`Chain ID: ${chainId}`}>
                  {chainName}
                </span>
                {bridgeType && (
                  <Badge variant="outline" className="text-[10px] px-1.5">
                    via {bridgeType}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {failedCount > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5">
                    {failedCount} failed
                  </Badge>
                )}
              </div>
            </div>

            {groupCrossChainJobsByDisplayedSource(chainJobs).map((jobGroup) => {
              const firstJob = jobGroup[0];
              if (!firstJob) return null;

              const sourceOrders = jobGroup.map((job) => job.sourceOrder).join('-');
              const groupKey = `${firstJob.bridgeType}-${firstJob.l2FromAddress}-${firstJob.status}-${sourceOrders}`;
              const groupSteps = jobGroup.flatMap((job) => job.steps.map((msg) => ({ job, msg })));
              const stepCount = groupSteps.length;
              const sourceLabel = getCrossChainJobSourceLabel(firstJob);

              return (
                <div
                  key={`${chainId}-${groupKey}`}
                  className="border border-muted rounded-lg p-3 bg-card space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium">
                        {stepCount} destination call{stepCount === 1 ? '' : 's'}
                      </span>
                      {firstJob.status === 'skipped' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Skipped
                        </Badge>
                      )}
                      {firstJob.status === 'failure' && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          Failed
                        </Badge>
                      )}
                    </div>
                    {firstJob.l2FromAddress ? (
                      <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                        <span>{sourceLabel}</span>
                        <ExplorerAddressLink
                          address={firstJob.l2FromAddress}
                          baseUrl={explorerBaseUrl}
                          className="font-mono hover:underline"
                        >
                          {firstJob.l2FromAddress.slice(0, 6)}...
                          {firstJob.l2FromAddress.slice(-4)}
                        </ExplorerAddressLink>
                      </div>
                    ) : null}
                  </div>

                  {firstJob.error && (
                    <div className="p-2 bg-red-100 border border-red-200 rounded text-red-800 text-[11px] break-words">
                      {firstJob.error}
                    </div>
                  )}

                  <div className="divide-y divide-border/60">
                    {stepCount ? (
                      groupSteps.map(({ job, msg }, index) => {
                        const visibleSignature = formatCrossChainCall(msg);
                        const transportLabel = getCrossChainTransportLabel(msg);
                        const stepTarget = getCrossChainStepTarget(msg);
                        const stepTargetLabel = getCrossChainStepTargetLabel(msg);
                        const fnName = visibleSignature.split('(')[0] || 'Call';
                        const hasValue = msg.l2Value && msg.l2Value !== '0';
                        const isFailed = msg.status === 'failure';

                        const visibleCall = msg.forwardedCall ?? msg.call;
                        const inputs = getFunctionAbi(visibleCall?.signature)?.inputs;
                        const args =
                          visibleCall?.args ??
                          (!msg.forwardedCall && msg.l2InputData
                            ? tryDecodeFromSignature(msg.call?.signature, msg.l2InputData)?.args
                            : undefined);

                        const preview = args
                          ? `${fnName}(${args.map(stringifyDecodedValue).join(', ')})`
                          : visibleSignature;
                        return (
                          <details
                            key={`${chainId}-${job.sourceOrder}-${msg.stepIndex}-${index}`}
                            className="group/call"
                          >
                            <summary className="cursor-pointer list-none p-4 flex items-start gap-2 [&::-webkit-details-marker]:hidden">
                              <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-muted text-xs shrink-0">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="text-xs text-muted-foreground break-all">
                                  {stepTargetLabel || stepTarget || 'Unknown target'}
                                </p>
                                <code className="text-sm break-all">
                                  {formatCallPreview(preview)}
                                </code>
                                {hasValue && <p className="text-xs break-all">{msg.l2Value} wei</p>}
                                {msg.error && (
                                  <p className="text-xs text-destructive break-words">
                                    {msg.error}
                                  </p>
                                )}
                              </div>
                              {isFailed && <Badge variant="destructive">Failed</Badge>}
                              {msg.status === 'skipped' && <Badge variant="outline">Skipped</Badge>}
                              <ChevronDownIcon className="h-4 w-4 shrink-0 mt-1 text-muted-foreground group-open/call:rotate-180" />
                            </summary>
                            <div className="border-t border-border/60 p-4 space-y-4">
                              <h4 className="text-sm font-medium">Technical details</h4>
                              <dl className="space-y-4">
                                {stepTarget && (
                                  <DetailField label="Target contract">
                                    <AddressValue
                                      address={stepTarget}
                                      baseUrl={explorerBaseUrl}
                                      labels={labels}
                                      chainId={chainId}
                                    />
                                  </DetailField>
                                )}
                                {firstJob.l2FromAddress && (
                                  <DetailField label={sourceLabel}>
                                    <AddressValue
                                      address={firstJob.l2FromAddress}
                                      baseUrl={explorerBaseUrl}
                                      labels={labels}
                                      chainId={chainId}
                                    />
                                  </DetailField>
                                )}
                                {args && (
                                  <DetailField label="Arguments">
                                    <CallArguments
                                      args={args}
                                      inputs={inputs}
                                      baseUrl={explorerBaseUrl}
                                      labels={labels}
                                      chainId={chainId}
                                    />
                                  </DetailField>
                                )}
                                <DetailField label="Signature">
                                  <ValueWithCopy value={visibleSignature} />
                                </DetailField>
                                {transportLabel && transportLabel !== visibleSignature && (
                                  <DetailField label="Sent via">
                                    <ValueWithCopy value={transportLabel} />
                                  </DetailField>
                                )}
                                {msg.l2InputData && (
                                  <DetailField
                                    label={
                                      msg.forwardedCall ? 'Transport calldata' : 'Raw calldata'
                                    }
                                  >
                                    <ValueWithCopy value={msg.l2InputData} />
                                  </DetailField>
                                )}
                              </dl>
                            </div>
                          </details>
                        );
                      })
                    ) : (
                      <div className="rounded border border-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                        No destination calls decoded
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
