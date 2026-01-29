'use client';

import { Badge } from '@/components/ui/badge';
import type { CrossChainMessagePreview } from '@/hooks/use-simulation-results';
import { ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ChainLogo } from './ChainLogo';
import { formatCrossChainCall } from './cross-chain';
import { buildAddressLinkForExplorer } from './explorer';

export function CrossChainPreview({ messages }: { messages: CrossChainMessagePreview[] }) {
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
