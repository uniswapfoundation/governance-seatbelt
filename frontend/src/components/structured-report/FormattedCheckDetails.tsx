'use client';

import { Badge } from '@/components/ui/badge';
import type {
  SimulationCheck,
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { formatCallPreview } from '@/lib/call-preview';
import { ExternalLinkIcon } from 'lucide-react';
import type React from 'react';
import { useMemo } from 'react';
import { EventsDisplay } from './EventsDisplay';
import { SecurityAnalysisOutput } from './SecurityAnalysisOutput';
import { SimulationPlaceholderBadge } from './SimulationPlaceholderBadge';
import { StateChanges } from './StateChanges';
import { ADDRESS_MARKDOWN_LINK_REGEX } from './addressMarkdownLink';
import { buildAddressLink, isPlaceholderAddress } from './explorer';

export function FormattedCheckDetails({
  check,
  stateChanges,
  metadata,
}: {
  check: SimulationCheck;
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const formatted = useMemo(() => {
    if (!check.details) return null;

    const title = check.title.toLowerCase();
    const isStateChangesCheck = title.includes('state changes');
    const isSecurityCheck = title.includes('slither') || title.includes('solc');
    const isEventsCheck = title.includes('events emitted');

    if (isSecurityCheck) {
      return <SecurityAnalysisOutput details={check.details} checkTitle={check.title} />;
    }

    if (isEventsCheck) {
      return <EventsDisplay details={check.details} metadata={metadata} />;
    }

    let preprocessedDetails = check.details;

    preprocessedDetails = preprocessedDetails.replace(
      /\*\*Info\*\*: - ([A-Za-z0-9]+ \([A-Za-z0-9]+\))/g,
      '$1',
    );

    preprocessedDetails = preprocessedDetails
      .replace(/\*\*Info\*\*:/g, '')
      .replace(/\*\*Warnings\*\*:/g, '')
      .replace(/Info:/g, '')
      .replace(/Warnings:/g, '')
      .replace(/^- \*\*Info\*\*:/gm, '')
      .replace(/^-\s*\*\*Info\*\*:/gm, '')
      .replace(/^-\s*Info:/gm, '')
      .replace(/^-\s*/gm, '')
      .replace(/^Warning:\s*/gm, '')
      .replace(/\s*\(simulation placeholder\)/g, '');

    const cleanedDetails = preprocessedDetails.replace(/\*\*([^*]+)\*\*:/g, '$1:');

    const allLines = cleanedDetails.split('\n').filter((line: string) => line.trim() !== '');
    const isCalldataCheck = check.checkId === 'checkDecodeCalldata';
    const notes = isCalldataCheck
      ? allLines.filter((line) => line.trim().startsWith('Advisory:'))
      : [];
    const lines = allLines.filter((line) => !notes.includes(line));

    const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

    if (isStateChangesCheck) {
      return stateChanges && stateChanges.length > 0 ? (
        <StateChanges stateChanges={stateChanges} metadata={effectiveMetadata} />
      ) : null;
    }

    return (
      <>
        {lines.map((line: string, index: number) => {
          let processedLine = line
            .replace(/^\*\*Info\*\*:\s*/, '')
            .replace(/^\*\*Info\*\*:\s*-\s*/, '')
            .replace(/^Info:\s*/, '')
            .replace(/^Info\s*-\s*/, '')
            .replace(/^Warning:\s*/, '')
            .replace(/\s*\(simulation placeholder\)/g, '');

          processedLine = processedLine
            .replace(/^\*\*Info\*\*:\s*/, '')
            .replace(/^\*\*Info\*\*:\s*-\s*/, '');

          if (processedLine.match(/^\*\*Info\*\*:\s*-\s*[A-Za-z0-9]+ \([A-Za-z0-9]+\)/)) {
            processedLine = processedLine.replace(/^\*\*Info\*\*:\s*-\s*/, '');
          }

          const uniMatch = processedLine.match(/^\*\*Info\*\*: - ([A-Za-z0-9]+ \([A-Za-z0-9]+\))/);
          if (uniMatch) {
            processedLine = uniMatch[1];
          }

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
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center max-w-full break-all"
                      >
                        {contractAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1 shrink-0" />
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

          const parts: React.ReactNode[] = [];
          let lastIndex = 0;

          const delegatecallAdvisoryContextMatch = processedLine.match(
            /Contract \(with DELEGATECALL,\s*([^)]+)\)/,
          );
          const delegatecallAdvisoryContext = delegatecallAdvisoryContextMatch?.[1]?.trim();

          const isTargetLine =
            processedLine.includes('Contract (verified') ||
            processedLine.includes('EOA (verification not applicable)') ||
            processedLine.includes('Contract (looks safe)') ||
            processedLine.includes('Contract (unverified') ||
            processedLine.includes('Trusted contract') ||
            processedLine.includes('Contract (with DELEGATECALL') ||
            processedLine.includes('Contract (with SELFDESTRUCT)') ||
            processedLine.includes('Empty account (could deploy code later)') ||
            processedLine.includes('EOA (may have code later') ||
            processedLine.includes(': EOA') ||
            processedLine.includes('Trusted contract (not checked)');

          if (isTargetLine) {
            const markdownLinkMatch = processedLine.match(ADDRESS_MARKDOWN_LINK_REGEX);
            const backtickMatch =
              processedLine.match(/\[`(0x[a-fA-F0-9]{40})`\]/) ||
              processedLine.match(/at `(0x[a-fA-F0-9]{40})`/);
            const targetMatch = markdownLinkMatch || backtickMatch;

            if (targetMatch) {
              const address = targetMatch[1];
              let status = 'Unknown';
              if (processedLine.includes('Contract (verified')) status = 'Verified';
              else if (processedLine.includes('Contract (unverified')) status = 'Unverified';
              else if (processedLine.includes('EOA (verification not applicable)')) status = 'EOA';
              else if (processedLine.includes('Contract (looks safe)')) status = 'Looks Safe';
              else if (processedLine.includes('Trusted contract (not checked)')) status = 'Trusted';
              else if (processedLine.includes('Trusted contract')) status = 'Trusted';
              else if (processedLine.includes('Contract (with DELEGATECALL'))
                status = 'Contract (with DELEGATECALL)';
              else if (processedLine.includes('Contract (with SELFDESTRUCT)'))
                status = 'Contract (with SELFDESTRUCT)';
              else if (processedLine.includes('Empty account (could deploy code later)'))
                status = 'Empty account (could deploy code later)';
              else if (processedLine.includes('EOA (may have code later'))
                status = 'EOA (may have code later)';
              else if (processedLine.includes(': EOA')) status = 'EOA';

              const statusColor =
                status === 'Verified' || status === 'Looks Safe' || status === 'Trusted'
                  ? 'bg-green-100 text-green-800 border-green-300'
                  : status === 'Unverified' || status === 'Contract (with SELFDESTRUCT)'
                    ? 'bg-red-100 text-red-800 border-red-300'
                    : status === 'Contract (with DELEGATECALL)' ||
                        status === 'Empty account (could deploy code later)' ||
                        status === 'EOA (may have code later)'
                      ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                      : 'bg-gray-100 text-gray-700 border-gray-300';

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
                  {delegatecallAdvisoryContext && (
                    <p className="mt-1 px-2 text-xs text-muted-foreground">
                      {delegatecallAdvisoryContext}
                    </p>
                  )}
                </div>
              );
            }
          }

          if (isCalldataCheck && processedLine.includes('(not decoded)')) {
            return (
              <div key={`undecoded-${index}`} className="mb-3 space-y-2">
                <p className="text-destructive">Could not decode this call.</p>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Technical details
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground break-all">
                    {processedLine.replaceAll('`', '')}
                  </p>
                </details>
              </div>
            );
          }

          const isDecodedCalldataLine =
            processedLine.includes('calls `') &&
            processedLine.includes('` on ') &&
            processedLine.includes('(decoded from ');

          if (isDecodedCalldataLine) {
            const functionCall = processedLine.match(/calls\s*`([^`]+)`\s*on/)?.[1];
            const target = processedLine.match(/on\s+(?:(.+?)\s+at\s+)?`(0x[a-fA-F0-9]{40})`/);

            return (
              <div key={`calldata-${index}`} className="mb-3 p-3 bg-muted/30 rounded-md space-y-2">
                {target && (
                  <a
                    href={buildAddressLink(target[2], effectiveMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline break-all"
                  >
                    {target[1] || target[2]}
                  </a>
                )}
                <code className="block font-mono text-sm break-all">
                  {functionCall ? formatCallPreview(functionCall) : ''}
                </code>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Technical details
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground break-all">
                    {processedLine.replaceAll('`', '')}
                  </p>
                </details>
              </div>
            );
          }

          const isEventLine =
            processedLine.includes('`') &&
            (processedLine.includes('Transfer(') ||
              processedLine.includes('Approval(') ||
              (processedLine.includes('(') &&
                processedLine.includes(')') &&
                processedLine.includes(':')));

          const isCalldataLine =
            processedLine.includes('transfers') && processedLine.includes('UNI to');

          if (isCalldataLine) {
            const formattedLine = processedLine.replace(/`/g, '');

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
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center max-w-full break-all"
                      >
                        {fromAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1 shrink-0" />
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
                        className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center max-w-full break-all"
                      >
                        {toAddress}
                        <ExternalLinkIcon className="h-3 w-3 ml-1 shrink-0" />
                      </a>
                      {isPlaceholderAddress(toAddress, effectiveMetadata) && (
                        <SimulationPlaceholderBadge />
                      )}
                    </span>
                  </code>
                </div>
              );
            }

            return (
              <div key={`calldata-${formattedLine.substring(0, 30)}`} className="mb-3">
                <code className="block font-mono text-xs bg-muted p-3 rounded whitespace-pre-wrap overflow-x-auto">
                  {formattedLine}
                </code>
              </div>
            );
          }

          if (isEventLine) {
            const eventMatch = processedLine.match(/`([^`]+)`/);
            if (eventMatch) {
              const eventText = eventMatch[1];

              return (
                <div key={`event-${eventText.substring(0, 30)}-${index}`} className="mb-3">
                  <code className="block font-mono text-xs bg-muted p-3 rounded whitespace-pre-wrap overflow-x-auto">
                    {eventText}
                  </code>
                </div>
              );
            }
          }

          const combinedRegex =
            /\[`?(0x[a-fA-F0-9]{40})`?\]\(https?:\/\/[^)]+\)|`(0x[a-fA-F0-9]{40})`/g;
          let combinedMatch: RegExpExecArray | null;

          combinedMatch = combinedRegex.exec(processedLine);
          while (combinedMatch !== null) {
            if (combinedMatch.index > lastIndex) {
              parts.push(processedLine.substring(lastIndex, combinedMatch.index));
            }

            const address = combinedMatch[1] || combinedMatch[2];
            const isPlaceholder = isPlaceholderAddress(address, effectiveMetadata);
            parts.push(
              <span
                key={`address-wrapper-${address}-${combinedMatch.index}`}
                className="inline-flex max-w-full items-center gap-1"
              >
                <a
                  href={buildAddressLink(address, effectiveMetadata)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center max-w-full break-all"
                >
                  {address}
                  <ExternalLinkIcon className="h-3 w-3 ml-1 shrink-0" />
                </a>
                {isPlaceholder && <SimulationPlaceholderBadge />}
              </span>,
            );

            lastIndex = combinedMatch.index + combinedMatch[0].length;
            combinedMatch = combinedRegex.exec(processedLine);
          }

          if (lastIndex < processedLine.length) {
            parts.push(processedLine.substring(lastIndex));
          }

          if (
            processedLine.includes('No ETH is required') ||
            processedLine.includes('No ETH transfers detected') ||
            (parts.length === 1 && typeof parts[0] === 'string' && !processedLine.includes('`'))
          ) {
            return (
              <div key={`info-line-${index}`} className="mb-3">
                <p className="text-muted-foreground break-words">
                  {parts.length > 0 ? parts : processedLine}
                </p>
              </div>
            );
          }

          return (
            <p key={`line-${index}-${processedLine.substring(0, 20)}`} className="mb-2 break-words">
              {parts.length > 0 ? parts : processedLine}
            </p>
          );
        })}
        {notes.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Decoding notes
            </summary>
            {notes.map((note, index) => (
              <p key={`note-${index}`} className="mt-2 text-xs text-muted-foreground break-words">
                {note}
              </p>
            ))}
          </details>
        )}
      </>
    );
  }, [check.details, check.title, check.checkId, stateChanges, metadata]);

  if (!formatted) return null;
  return <>{formatted}</>;
}
