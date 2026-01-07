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
import { formatEther } from 'viem';

type RiskTag = 'Upgrade' | 'Admin/Role' | 'Token Approval' | 'Token Transfer' | 'ETH Value';

function abbreviateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function abbreviateHex(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isNumberish(value: string): boolean {
  return /^-?(?:0x[a-fA-F0-9]+|\d+(?:\.\d+)?)$/.test(value);
}

function formatDecimalWithGrouping(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith('0x') || trimmed.startsWith('-0x')) return trimmed;

  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;

  const [intPart, fracPart] = normalized.split('.');
  const digits = (intPart || '0').replace(/^0+(?=\d)/, '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const result = fracPart ? `${grouped}.${fracPart}` : grouped;
  return negative ? `-${result}` : result;
}

function formatBigIntGrouping(value: bigint) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

function formatNumberish(value: string, opts?: { compact?: boolean }) {
  const trimmed = value.trim();
  if (!isNumberish(trimmed)) return value;

  if (trimmed.includes('.')) {
    const grouped = formatDecimalWithGrouping(trimmed);
    if (!opts?.compact) return grouped;
    return grouped.length > 22 ? `${grouped.slice(0, 18)}…` : grouped;
  }

  try {
    const parsed = BigInt(trimmed);
    const grouped = formatBigIntGrouping(parsed);
    if (!opts?.compact) return grouped;

    const rawDigits = parsed < 0n ? grouped.slice(1) : grouped;
    if (rawDigits.length <= 24) return grouped;

    const prefix = grouped.slice(0, parsed < 0n ? 14 : 13);
    const suffix = grouped.slice(-8);
    return `${prefix}…${suffix}`;
  } catch {
    return value;
  }
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

function AddressValue({
  address,
  baseUrl,
  labels,
}: {
  address: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
}) {
  const label = getAddressLabelFor(address, labels);

  return (
    <div className="flex items-center gap-1">
      <span className="font-mono">
        {label?.label ? (
          <>
            {label.label}
            <span className="ml-1 text-muted-foreground">({abbreviateAddress(address)})</span>
          </>
        ) : (
          abbreviateAddress(address)
        )}
      </span>
      <CopyButton value={address} className="h-6 w-6" />
      <ExplorerLinkButton href={`${baseUrl}/address/${address}`} className="h-6 w-6" />
    </div>
  );
}

function ValueWithCopy({
  value,
  displayValue,
  className,
}: {
  value: string;
  displayValue?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className || ''}`}>
      <span className="font-mono break-all">{displayValue ?? value}</span>
      <CopyButton value={value} className="h-6 w-6" />
    </div>
  );
}

function stripTrailingNote(text: string) {
  return text.replace(/\s*\((?:formatted|decoded from cache|decoded from ABI|generic)\)\s*$/i, '');
}

function parseContractIdentifier(text: string) {
  const clean = stripTrailingNote(text).trim();

  const direct = clean.match(/^`(0x[a-fA-F0-9]{40})`$/);
  if (direct) return { target: direct[1], contractName: undefined as string | undefined };

  const withAt = clean.match(/^(.+?)\s+at\s+`(0x[a-fA-F0-9]{40})`$/);
  if (withAt) return { contractName: withAt[1].trim(), target: withAt[2] };

  const backticked = Array.from(clean.matchAll(/`(0x[a-fA-F0-9]{40})`/g)).map((m) => m[1]);
  const target = backticked.at(-1);
  if (!target) return { contractName: clean, target: undefined as string | undefined };

  return { contractName: clean.replace(/`(0x[a-fA-F0-9]{40})`/g, '`…`').trim(), target };
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
  // `0xFROM` transfers 123.45 UNI to `0xTO` on UNI Token (UNI) at `0xTARGET` (formatted)
  // `0xFROM` approves `0xSPENDER` to spend 123.45 UNI on UNI Token (UNI) at `0xTARGET` (formatted)
  // `0xFROM` transfers 123.45 UNI from `0xFROM` to `0xTO` on UNI Token (UNI) at `0xTARGET` (formatted)
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

  const tokenTransferFromMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+transfers\s+(.+?)\s+([^\s]+)\s+from\s+`(0x[a-fA-F0-9]{40})`\s+to\s+`(0x[a-fA-F0-9]{40})`\s+on\s+(.+)$/,
  );
  if (tokenTransferFromMatch) {
    const [, caller, amount, symbol, from, to, on] = tokenTransferFromMatch;
    const { contractName, target } = parseContractIdentifier(on);
    return {
      kind: 'token-transferFrom' as const,
      caller,
      from,
      to,
      amount,
      symbol: symbol === 'null' ? null : symbol,
      contractName,
      target,
    };
  }

  const tokenTransferMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+transfers\s+(.+?)\s+([^\s]+)\s+to\s+`(0x[a-fA-F0-9]{40})`\s+on\s+(.+)$/,
  );
  if (tokenTransferMatch) {
    const [, caller, amount, symbol, to, on] = tokenTransferMatch;
    const { contractName, target } = parseContractIdentifier(on);
    return {
      kind: 'token-transfer' as const,
      caller,
      to,
      amount,
      symbol: symbol === 'null' ? null : symbol,
      contractName,
      target,
    };
  }

  const tokenApproveMatch = decodedText.match(
    /^`(0x[a-fA-F0-9]{40})`\s+approves\s+`(0x[a-fA-F0-9]{40})`\s+to\s+spend\s+(.+?)\s+([^\s]+)\s+on\s+(.+)$/,
  );
  if (tokenApproveMatch) {
    const [, caller, spender, amount, symbol, on] = tokenApproveMatch;
    const { contractName, target } = parseContractIdentifier(on);
    return {
      kind: 'token-approve' as const,
      caller,
      spender,
      amount,
      symbol: symbol === 'null' ? null : symbol,
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

function getCallArgLabels(decoded: ReturnType<typeof parseDecodedSentence>) {
  if (decoded.kind !== 'call') return {};

  const fn = decoded.fnName?.toLowerCase();
  if (!fn) return {};

  if (fn === 'transfer') {
    const to = decoded.args[0];
    const amount = decoded.args[1];
    return {
      otherAddressLabel: 'To',
      otherAddress: to && isHexAddress(to) ? to : undefined,
      fromToken: undefined as string | undefined,
      amountLabel: 'Amount',
      amount,
    };
  }

  if (fn === 'approve') {
    const spender = decoded.args[0];
    const amount = decoded.args[1];
    return {
      otherAddressLabel: 'Spender',
      otherAddress: spender && isHexAddress(spender) ? spender : undefined,
      fromToken: undefined as string | undefined,
      amountLabel: 'Amount',
      amount,
    };
  }

  if (fn === 'transferfrom') {
    const fromToken = decoded.args[0];
    const to = decoded.args[1];
    const amount = decoded.args[2];
    return {
      otherAddressLabel: 'To',
      otherAddress: to && isHexAddress(to) ? to : undefined,
      fromToken: fromToken && isHexAddress(fromToken) ? fromToken : undefined,
      amountLabel: 'Amount',
      amount,
    };
  }

  return {};
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
  compact,
}: {
  eventText: string;
  baseUrl: string;
  labels?: StructuredSimulationReport['metadata']['addressLabels'];
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
          const display = isAddr ? abbreviateAddress(raw) : formatNumberish(raw, { compact: true });
          return (
            <div
              key={`${parsed.name}-${p.name}-${raw}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-muted-foreground">{p.name}</span>
              {isAddr ? (
                <AddressValue address={raw} baseUrl={baseUrl} labels={labels} />
              ) : (
                <ValueWithCopy value={raw} displayValue={display} />
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

  const calls = proposal.targets.map((target, index) => {
    const decodedText =
      decodedByIndex.length === proposal.targets.length ? decodedByIndex[index] : undefined;

    const signature = proposal.signatures[index];
    const calldata = proposal.calldatas[index];
    const value = proposal.values[index] ?? 0n;

    const tags = getRiskTags({ signature, decodedText, value });

    return {
      index,
      target,
      value,
      signature,
      calldata,
      decodedText,
      decoded: decodedText ? parseDecodedSentence(decodedText) : null,
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
                {label?.type && (
                  <Badge variant="outline" className="text-xs px-2 py-0.5">
                    {label.type}
                  </Badge>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="text-sm font-medium">
                    {label?.label ?? abbreviateAddress(target)}
                    {label?.label ? (
                      <span className="ml-2 text-xs font-mono text-muted-foreground">
                        ({abbreviateAddress(target)})
                      </span>
                    ) : null}
                  </div>
                  <CopyButton value={target} />
                  <ExplorerLinkButton href={explorerUrl} />
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
                const fnLabel =
                  decoded?.kind === 'call'
                    ? (decoded.fnName ?? 'Call')
                    : decoded?.kind === 'token-transfer'
                      ? 'Transfer'
                      : decoded?.kind === 'token-transferFrom'
                        ? 'TransferFrom'
                        : decoded?.kind === 'token-approve'
                          ? 'Approve'
                          : decoded?.kind === 'eth-transfer'
                            ? 'ETH transfer'
                            : (getFunctionName(call.signature, call.decodedText) ?? 'Call');

                const subLabel =
                  decoded?.kind === 'call'
                    ? `${decoded.fnName ?? 'call'}(${decoded.args
                        .map((arg) => {
                          if (isHexAddress(arg)) return abbreviateAddress(arg);
                          if (arg.startsWith('0x')) return abbreviateHex(arg);
                          return formatNumberish(arg, { compact: true });
                        })
                        .join(', ')})`
                    : decoded?.kind === 'token-transfer'
                      ? `${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''} to ${abbreviateAddress(decoded.to)}`
                      : decoded?.kind === 'token-transferFrom'
                        ? `${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''} from ${abbreviateAddress(decoded.from)} to ${abbreviateAddress(decoded.to)}`
                        : decoded?.kind === 'token-approve'
                          ? `${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''} to ${abbreviateAddress(decoded.spender)}`
                          : decoded?.kind === 'eth-transfer'
                            ? `to ${abbreviateAddress(decoded.to)}`
                            : (call.decodedText ?? null);

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
                        {decoded?.kind === 'call' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.from}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            {(() => {
                              const args = getCallArgLabels(decoded);
                              if (!('fromToken' in args) && !('otherAddress' in args)) return null;

                              const fromToken = (args as { fromToken?: string }).fromToken;
                              const otherAddress = (args as { otherAddress?: string }).otherAddress;
                              const otherAddressLabel = (args as { otherAddressLabel?: string })
                                .otherAddressLabel;

                              return (
                                <>
                                  {fromToken ? (
                                    <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                                      <span className="text-muted-foreground">From</span>
                                      <AddressValue
                                        address={fromToken}
                                        baseUrl={baseUrl}
                                        labels={labels}
                                      />
                                    </div>
                                  ) : null}
                                  {otherAddress ? (
                                    <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                                      <span className="text-muted-foreground">
                                        {otherAddressLabel ?? 'To'}
                                      </span>
                                      <AddressValue
                                        address={otherAddress}
                                        baseUrl={baseUrl}
                                        labels={labels}
                                      />
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                            {(() => {
                              const args = getCallArgLabels(decoded);
                              if (!('amount' in args)) return null;
                              const amount = (args as { amount?: string }).amount;
                              const amountLabel = (args as { amountLabel?: string }).amountLabel;
                              if (!amount) return null;

                              return (
                                <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                                  <span className="text-muted-foreground">
                                    {amountLabel ?? 'Amount'}
                                  </span>
                                  <ValueWithCopy
                                    value={amount}
                                    displayValue={formatNumberish(amount)}
                                  />
                                </div>
                              );
                            })()}
                            {decoded.args.length > 0 &&
                            !['transfer', 'approve', 'transferfrom'].includes(
                              (decoded.fnName ?? '').toLowerCase(),
                            ) ? (
                              <div className="flex items-start justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                                <span className="text-muted-foreground">Args</span>
                                <div className="space-y-1">
                                  {decoded.args.map((arg, argIndex) => {
                                    const isAddr = isHexAddress(arg);
                                    const display = isAddr
                                      ? abbreviateAddress(arg)
                                      : formatNumberish(arg, { compact: true });

                                    return (
                                      <div
                                        key={`${decoded.fnName ?? 'call'}-${argIndex}-${arg}`}
                                        className="flex items-center justify-end gap-2"
                                      >
                                        <span className="text-muted-foreground">
                                          Arg {argIndex + 1}
                                        </span>
                                        {isAddr ? (
                                          <AddressValue
                                            address={arg}
                                            baseUrl={baseUrl}
                                            labels={labels}
                                          />
                                        ) : (
                                          <ValueWithCopy value={arg} displayValue={display} />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {decoded?.kind === 'token-transfer' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.caller}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">To</span>
                              <AddressValue
                                address={decoded.to}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                              <span className="text-muted-foreground">Amount</span>
                              <ValueWithCopy
                                value={decoded.amount}
                                displayValue={`${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''}`}
                              />
                            </div>
                          </div>
                        ) : null}

                        {decoded?.kind === 'token-transferFrom' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.caller}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">From</span>
                              <AddressValue
                                address={decoded.from}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">To</span>
                              <AddressValue
                                address={decoded.to}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                              <span className="text-muted-foreground">Amount</span>
                              <ValueWithCopy
                                value={decoded.amount}
                                displayValue={`${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''}`}
                              />
                            </div>
                          </div>
                        ) : null}

                        {decoded?.kind === 'token-approve' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.caller}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Spender</span>
                              <AddressValue
                                address={decoded.spender}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                              <span className="text-muted-foreground">Amount</span>
                              <ValueWithCopy
                                value={decoded.amount}
                                displayValue={`${formatNumberish(decoded.amount)}${decoded.symbol ? ` ${decoded.symbol}` : ''}`}
                              />
                            </div>
                          </div>
                        ) : null}

                        {decoded?.kind === 'eth-transfer' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">Caller</span>
                              <AddressValue
                                address={decoded.from}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1">
                              <span className="text-muted-foreground">To</span>
                              <AddressValue
                                address={decoded.to}
                                baseUrl={baseUrl}
                                labels={labels}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2 border border-muted rounded px-2 py-1 md:col-span-2">
                              <span className="text-muted-foreground">Amount</span>
                              <span className="font-mono">{decoded.amountEth} ETH</span>
                            </div>
                          </div>
                        ) : null}

                        {call.signature && (
                          <div className="text-xs">
                            <span className="text-muted-foreground mr-2">Signature</span>
                            <span className="font-mono">{call.signature || '(empty)'}</span>
                          </div>
                        )}
                        {call.calldata && (
                          <div className="text-xs">
                            <span className="text-muted-foreground mr-2">Calldata</span>
                            <span className="font-mono break-all">{call.calldata}</span>
                          </div>
                        )}
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
                              <EventCard eventText={evt} baseUrl={baseUrl} labels={labels} />
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
