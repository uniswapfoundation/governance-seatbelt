'use client';

import { Badge } from '@/components/ui/badge';
import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';
import { formatRawLogFromJson } from '@/lib/raw-log';
import { ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { buildAddressLink } from './explorer';

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
    const cleanLine = line.replace(/^\*\*Info\*\*:\s*/, '').trim();

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

    const legacyUndecodedLog = cleanLine.match(/^Undecoded log:\s+`(.+)`$/);
    const eventLine = legacyUndecodedLog ? formatRawLogFromJson(legacyUndecodedLog[1]) : cleanLine;
    const eventMatch = eventLine.match(/^\s*`?(\w+)\((.+)\)`?\s*$/);
    if (eventMatch && currentContract) {
      const eventName = eventMatch[1];
      const paramsString = eventMatch[2];

      const params: Array<{ name: string; value: string }> = [];
      if (paramsString.trim()) {
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

export function EventsDisplay({
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
                  {event.name === 'RawLog' && (
                    <Badge
                      variant="outline"
                      className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs"
                    >
                      Could not decode
                    </Badge>
                  )}
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
