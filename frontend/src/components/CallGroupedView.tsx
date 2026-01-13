'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  Proposal,
  SimulationCheck,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
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

type RiskTag = 'Upgrade' | 'Admin/Role' | 'Token Approval' | 'Token Transfer' | 'ETH Value';

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

const hoverCopyClasses =
  'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity';

function getTrustWalletChainSlug(chainId: number | undefined) {
  if (!chainId) return null;
  if (chainId === 1) return 'ethereum';
  if (chainId === 42161) return 'arbitrum';
  if (chainId === 10) return 'optimism';
  if (chainId === 8453) return 'base';
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

function stableHash(input: string) {
  // djb2
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
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
      <div className="group flex items-start gap-2 min-w-0">
        {label?.type === 'token' ? (
          <TokenLogo address={address} chainId={chainId} className="h-6 w-6 rounded-full" />
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {label?.label ? (
              <ExplorerAddressLink
                address={address}
                baseUrl={baseUrl}
                className="text-sm font-medium hover:underline break-words"
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
          <div className="text-xs font-mono text-muted-foreground break-all">
            <ExplorerAddressLink address={address} baseUrl={baseUrl} className="hover:underline">
              {address}
            </ExplorerAddressLink>
          </div>
        </div>
        <CopyButton value={address} className={`h-6 w-6 ${hoverCopyClasses}`} />
      </div>
    );
  }

  // Inline variant: single line, always show full address (no truncation)
  return (
    <div className="group inline-flex items-center gap-1.5 min-w-0">
      {label?.type === 'token' ? (
        <TokenLogo address={address} chainId={chainId} className="h-4 w-4 rounded-full" />
      ) : null}
      {label?.label ? (
        <>
          <ExplorerAddressLink
            address={address}
            baseUrl={baseUrl}
            className="text-xs hover:underline"
          >
            {label.label}
          </ExplorerAddressLink>
          <span className="text-xs font-mono text-muted-foreground break-all">
            <ExplorerAddressLink address={address} baseUrl={baseUrl} className="hover:underline">
              {address}
            </ExplorerAddressLink>
          </span>
          {label.type && label.type !== 'token' && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight">
              {label.type}
            </Badge>
          )}
        </>
      ) : (
        <ExplorerAddressLink
          address={address}
          baseUrl={baseUrl}
          className="text-xs font-mono text-muted-foreground hover:underline"
        >
          {address}
        </ExplorerAddressLink>
      )}
      <CopyButton value={address} className={`h-4 w-4 ${hoverCopyClasses}`} />
    </div>
  );
}

function ValueWithCopy({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <div className={`group inline-flex items-center gap-1 ${className || ''}`}>
      <span className="font-mono text-xs break-all">{value}</span>
      <CopyButton value={value} className={`h-4 w-4 ${hoverCopyClasses}`} />
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

function getDecodeCalldataInfo(checks: SimulationCheck[]) {
  const decodeCheck = checks.find((c) => c.checkId === 'checkDecodeCalldata');
  return decodeCheck?.info ?? [];
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
    }
  }

  return byAddress;
}

function parseDecodedSentence(decodedText: string) {
  // Examples:
  // `0xFROM` calls `transfer(0xTO, 123)` on Name at `0xTARGET` (decoded from ABI)
  // `0xFROM` transfers 0.1 ETH to `0xTARGET` (formatted)
  const callMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+calls\s+`(.+?)`\s+on\s+(.+?)\s+at\s+`(0x[a-fA-F0-9]{40})`/,
  );
  if (callMatch) {
    const [, from, fnCall, contractName, target] = callMatch;
    const fnMatch = fnCall.match(/^([a-zA-Z0-9_]+)\((.*)\)$/);
    const fnName = fnMatch?.[1] ?? null;
    const rawArgs = fnMatch?.[2] ?? null;
    const args = rawArgs
      ? rawArgs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    return {
      kind: 'call' as const,
      from,
      fnCall,
      fnName,
      args,
      contractName,
      target,
    };
  }

  const ethTransferMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+transfers\s+(.+?)\s+ETH\s+to\s+`(0x[a-fA-F0-9]{40})`/,
  );
  if (ethTransferMatch) {
    const [, from, amount, to] = ethTransferMatch;
    return {
      kind: 'eth-transfer' as const,
      from,
      to,
      amountEth: amount,
    };
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
  inputs: Array<{ name?: string; type: string }>;
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

function tryDecodeFromSignature(
  signature: string | undefined,
  calldata: `0x${string}`,
): DecodedSignatureCall | null {
  if (!signature) return null;
  const trimmed = signature.trim();
  if (!trimmed || trimmed.startsWith('0x')) return null;

  try {
    const abiItem = parseAbiItem(`function ${trimmed}`);
    // biome-ignore lint/suspicious/noExplicitAny: viem AbiFunction typing is complex
    const inputs = ((abiItem as any).inputs ?? []) as Array<{ name?: string; type: string }>;

    const fullCalldata = getFullCalldata(trimmed, calldata);
    const decoded = decodeFunctionData({
      // biome-ignore lint/suspicious/noExplicitAny: viem AbiFunction typing is complex
      abi: [abiItem as any],
      data: fullCalldata,
    });

    return {
      functionName: decoded.functionName,
      args: decoded.args,
      inputs,
      fullCalldata,
    };
  } catch {
    return null;
  }
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

function EventCard({
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
    return <div className="text-xs font-mono break-all text-muted-foreground">{eventText}</div>;
  }

  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium">{parsed.name}</div>
      {parsed.params.map((p) => {
        const raw = p.value;
        const isAddr = isHexAddress(raw);

        return (
          <div key={`${parsed.name}-${p.name}-${raw}`} className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground w-14 shrink-0">{p.name}</span>
            {isAddr ? (
              <AddressValue address={raw} baseUrl={baseUrl} labels={labels} chainId={chainId} />
            ) : (
              <ValueWithCopy value={raw} />
            )}
          </div>
        );
      })}
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
  const decodedByIndex = getDecodeCalldataInfo(report.checks);
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

  return (
    <div className="space-y-4">
      {Object.entries(byTarget).map(([targetKey, targetCalls]) => {
        const target = targetCalls[0]?.target ?? targetKey;

        const totalEth = targetCalls.reduce((sum, c) => sum + c.value, 0n);
        const uniqueTags = Array.from(new Set(targetCalls.flatMap((c) => c.tags)));

        const emitted = eventsByEmitter.get(target.toLowerCase());
        const eventCount = emitted?.events.length ?? 0;

        return (
          <div key={targetKey} className="border border-muted rounded-lg p-3 bg-card space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AddressValue
                  address={target}
                  baseUrl={baseUrl}
                  labels={labels}
                  chainId={chainId}
                  variant="header"
                />
                {uniqueTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                {targetCalls.length} call{targetCalls.length === 1 ? '' : 's'}
                {totalEth > 0n ? ` · ${formatEthValue(totalEth)}` : ''}
              </div>
            </div>

            <div className="space-y-2">
              {targetCalls.map((call) => {
                const hasDetails = Boolean(call.decodedText || call.signature || call.calldata);
                const decoded = call.decoded;
                const decodedSignature = call.decodedSignature;
                const fnLabel =
                  decodedSignature?.functionName ??
                  (decoded?.kind === 'call'
                    ? (decoded.fnName ?? 'Call')
                    : decoded?.kind === 'eth-transfer'
                      ? 'ETH transfer'
                      : (getFunctionName(call.signature, call.decodedText) ?? 'Call'));

                const showEth = call.value > 0n;

                return (
                  <details
                    key={`${call.target}-${call.index}`}
                    className="group border border-muted/60 rounded"
                  >
                    <summary className="cursor-pointer select-none px-2.5 py-1.5 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex items-baseline gap-2">
                        <span className="text-xs text-muted-foreground">{call.index + 1}</span>
                        <span className="text-sm font-medium">{fnLabel}</span>
                        {showEth && (
                          <span className="text-xs text-muted-foreground">
                            {formatEthValue(call.value)}
                          </span>
                        )}
                      </div>
                      <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180 shrink-0" />
                    </summary>

                    {hasDetails && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5 text-xs">
                        {(decoded?.kind === 'call' || decoded?.kind === 'eth-transfer') && (
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground w-14 shrink-0">Caller</span>
                            <AddressValue
                              address={decoded.from}
                              baseUrl={baseUrl}
                              labels={labels}
                              chainId={chainId}
                            />
                          </div>
                        )}

                        {call.value > 0n && (
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground w-14 shrink-0">Value (wei)</span>
                            <ValueWithCopy value={call.value.toString()} />
                          </div>
                        )}

                        {decodedSignature?.args.map((arg, argIndex) => {
                          const input = decodedSignature.inputs[argIndex];
                          const labelText = input?.name?.trim() || `arg${argIndex}`;
                          const raw = stringifyDecodedValue(arg);
                          const looksLikeAddress = isHexAddress(raw);

                          return (
                            <div
                              key={`${call.target}-${call.index}-arg-${argIndex}`}
                              className="flex items-center gap-3"
                            >
                              <span className="text-muted-foreground w-14 shrink-0 truncate">
                                {labelText}
                              </span>
                              {looksLikeAddress ? (
                                <AddressValue
                                  address={raw}
                                  baseUrl={baseUrl}
                                  labels={labels}
                                  chainId={chainId}
                                />
                              ) : (
                                <ValueWithCopy value={raw} />
                              )}
                            </div>
                          );
                        })}

                        {(call.signature || call.fullCalldata) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-[11px]">
                              Raw data
                            </summary>
                            <div className="mt-1 space-y-1 pl-2 border-l border-muted">
                              {call.signature && (
                                <div className="flex items-start gap-2">
                                  <span className="text-muted-foreground shrink-0">sig</span>
                                  <code className="font-mono text-[11px] break-all">
                                    {call.signature}
                                  </code>
                                </div>
                              )}
                              {call.fullCalldata && (
                                <div className="flex items-start gap-2">
                                  <span className="text-muted-foreground shrink-0">data</span>
                                  <code className="font-mono text-[11px] break-all text-muted-foreground">
                                    {call.fullCalldata}
                                  </code>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>

            {eventCount > 0 ? (
              <div className="pt-2 border-t border-muted/50">
                <details className="group outline-none" open={eventCount === 1}>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 [&::-webkit-details-marker]:hidden outline-none">
                    <ChevronDownIcon className="h-3 w-3 transition-transform group-open:rotate-180" />
                    {eventCount} event{eventCount === 1 ? '' : 's'}
                  </summary>
                  <div className="mt-2 space-y-3 pl-4">
                    {(() => {
                      const seen = new Map<string, number>();
                      return (emitted?.events ?? []).map((evt) => {
                        const hash = stableHash(evt);
                        const occurrence = (seen.get(hash) ?? 0) + 1;
                        seen.set(hash, occurrence);
                        const key = `${targetKey}-evt-${hash}-${occurrence}`;

                        return (
                          <EventCard
                            key={key}
                            eventText={evt}
                            baseUrl={baseUrl}
                            labels={labels}
                            chainId={chainId}
                          />
                        );
                      });
                    })()}
                  </div>
                </details>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
