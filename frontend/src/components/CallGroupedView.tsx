'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  Proposal,
  SimulationCheck,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react';
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

function AddressValue({
  address,
  baseUrl,
  labels,
  chainId,
}: {
  address: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
  chainId: number | undefined;
}) {
  const label = getAddressLabelFor(address, labels);

  return (
    <div className="flex items-start gap-2 min-w-0">
      {label?.type === 'token' ? <TokenLogo address={address} chainId={chainId} /> : null}
      <div className="min-w-0">
        {label?.label ? <div className="text-xs text-muted-foreground">{label.label}</div> : null}
        <div className="font-mono break-all">{address}</div>
      </div>
      <div className="flex items-center shrink-0">
        <CopyButton value={address} className="h-6 w-6" />
        <ExplorerLinkButton href={`${baseUrl}/address/${address}`} className="h-6 w-6" />
      </div>
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
    <div className={`flex items-center gap-1 ${className || ''}`}>
      <span className="font-mono break-all">{value}</span>
      <CopyButton value={value} className="h-6 w-6" />
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
      className={`h-7 w-7 p-0 cursor-pointer ${className || ''}`}
      onClick={handleCopy}
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function ExplorerLinkButton({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={`h-7 w-7 p-0 cursor-pointer ${className || ''}`}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open in explorer">
        <ExternalLinkIcon className="h-3.5 w-3.5" />
      </a>
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
  compact,
}: {
  eventText: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
  chainId: number | undefined;
  compact?: boolean;
}) {
  const parsed = parseEventSignature(eventText);
  if (!parsed) {
    return <div className="text-xs font-mono break-all">{eventText}</div>;
  }

  const params = compact ? parsed.params.slice(0, 3) : parsed.params;

  return (
    <div className="border border-muted rounded-md px-3 py-2 bg-muted/20 space-y-2">
      <div className="text-xs font-medium">{parsed.name}</div>
      <div className="space-y-1">
        {params.map((p) => {
          const raw = p.value;
          const isAddr = isHexAddress(raw);
          return (
            <div
              key={`${parsed.name}-${p.name}-${raw}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-muted-foreground">{p.name}</span>
              {isAddr ? (
                <AddressValue address={raw} baseUrl={baseUrl} labels={labels} chainId={chainId} />
              ) : (
                <ValueWithCopy value={raw} />
              )}
            </div>
          );
        })}
        {compact && parsed.params.length > params.length ? (
          <div className="text-xs text-muted-foreground">…</div>
        ) : null}
      </div>
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
        const label = getAddressLabelFor(target, labels);

        const totalEth = targetCalls.reduce((sum, c) => sum + c.value, 0n);
        const uniqueTags = Array.from(new Set(targetCalls.flatMap((c) => c.tags)));

        const emitted = eventsByEmitter.get(target.toLowerCase());
        const eventCount = emitted?.events.length ?? 0;

        const explorerUrl = `${baseUrl}/address/${target}`;

        return (
          <div key={targetKey} className="border border-muted rounded-md p-4 bg-card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {label?.type === 'token' ? (
                  <TokenLogo address={target} chainId={chainId} className="h-6 w-6 rounded-full" />
                ) : null}
                {label?.type ? (
                  <Badge variant="outline" className="text-xs px-2 py-0.5">
                    {label.type}
                  </Badge>
                ) : null}
                <div className="flex items-start gap-2 min-w-0">
                  <div className="min-w-0">
                    {label?.label ? <div className="text-sm font-medium">{label.label}</div> : null}
                    <div className="text-xs font-mono text-muted-foreground break-all">
                      {target}
                    </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    <CopyButton value={target} />
                    <ExplorerLinkButton href={explorerUrl} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {uniqueTags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {targetCalls.length} call{targetCalls.length === 1 ? '' : 's'}
                {totalEth > 0n ? ` • ${formatEthValue(totalEth)}` : ''}
                {eventCount > 0 ? ` • ${eventCount} event${eventCount === 1 ? '' : 's'}` : ''}
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

                const subLabel = decodedSignature
                  ? `${decodedSignature.functionName}(${decodedSignature.args.map(stringifyDecodedValue).join(', ')})`
                  : decoded?.kind === 'call'
                    ? decoded.fnCall
                    : decoded?.kind === 'eth-transfer'
                      ? `to ${decoded.to}`
                      : call.signature || call.decodedText || null;

                const showEth = call.value > 0n;

                return (
                  <details
                    key={`${call.target}-${call.index}`}
                    className="group border border-muted rounded-md"
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          <span className="mr-2">Call {call.index + 1}</span>
                          <span className="text-muted-foreground">{fnLabel}</span>
                          {showEth ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {formatEthValue(call.value)}
                            </span>
                          ) : null}
                        </div>
                        {subLabel ? (
                          <div className="text-xs text-muted-foreground break-all">{subLabel}</div>
                        ) : null}
                      </div>
                    </summary>

                    {hasDetails && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="flex items-start justify-between gap-2 border border-muted rounded px-2 py-1">
                            <span className="text-muted-foreground">Target</span>
                            <AddressValue
                              address={call.target}
                              baseUrl={baseUrl}
                              labels={labels}
                              chainId={chainId}
                            />
                          </div>

                          {decoded?.kind === 'call' || decoded?.kind === 'eth-transfer' ? (
                            <div className="flex items-start justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.from}
                                baseUrl={baseUrl}
                                labels={labels}
                                chainId={chainId}
                              />
                            </div>
                          ) : null}

                          {call.value > 0n ? (
                            <div className="flex items-start justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                              <span className="text-muted-foreground">Value (wei)</span>
                              <ValueWithCopy value={call.value.toString()} />
                            </div>
                          ) : null}

                          {decodedSignature ? (
                            <>
                              {decodedSignature.args.map((arg, argIndex) => {
                                const input = decodedSignature.inputs[argIndex];
                                const labelText = input?.name?.trim()
                                  ? input.name
                                  : `Arg ${argIndex + 1}`;

                                const raw = stringifyDecodedValue(arg);
                                const looksLikeAddress = isHexAddress(raw);

                                return (
                                  <div
                                    key={`${call.target}-${call.index}-arg-${argIndex}-${raw}`}
                                    className="flex items-start justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2"
                                  >
                                    <span className="text-muted-foreground">{labelText}</span>
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
                            </>
                          ) : null}
                        </div>

                        {call.signature && (
                          <div className="text-xs">
                            <span className="text-muted-foreground mr-2">Signature</span>
                            <span className="font-mono">{call.signature || '(empty)'}</span>
                          </div>
                        )}
                        {call.fullCalldata && (
                          <div className="text-xs">
                            <span className="text-muted-foreground mr-2">Calldata</span>
                            <span className="font-mono break-all">{call.fullCalldata}</span>
                          </div>
                        )}
                        {call.calldata && call.calldata !== call.fullCalldata ? (
                          <div className="text-xs">
                            <span className="text-muted-foreground mr-2">Args Calldata</span>
                            <span className="font-mono break-all">{call.calldata}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>

            {eventCount > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Events</div>
                {emitted?.events[0] ? (
                  <EventCard
                    eventText={emitted.events[0]}
                    baseUrl={baseUrl}
                    labels={labels}
                    chainId={chainId}
                    compact
                  />
                ) : null}
                {eventCount > 1 ? (
                  <details className="group border border-muted rounded-md">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                      Show all events ({eventCount})
                    </summary>
                    <div className="px-3 pb-3 pt-0 space-y-1">
                      {(() => {
                        const seen = new Map<string, number>();
                        return (emitted?.events ?? []).map((evt) => {
                          const hash = stableHash(evt);
                          const occurrence = (seen.get(hash) ?? 0) + 1;
                          seen.set(hash, occurrence);
                          const key = `${targetKey}-evt-${hash}-${occurrence}`;

                          return (
                            <div key={key} className="py-2">
                              <EventCard
                                eventText={evt}
                                baseUrl={baseUrl}
                                labels={labels}
                                chainId={chainId}
                              />
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </details>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
