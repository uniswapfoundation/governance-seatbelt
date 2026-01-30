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
    <div className="space-y-3">
      {groups.map(([chainId, chainMessages]) => {
        const chainName = chainMessages[0]?.chainName || `Chain ${chainId}`;
        const explorerBaseUrl = chainMessages[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
        const bridgeType = chainMessages[0]?.bridgeType;

        return (
          <div key={chainId}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ChainLogo chainId={chainId} size={16} />
                {chainName}
              </div>
              {bridgeType ? (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {bridgeType}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              {chainMessages.map((message) => {
                const messageKey = `${message.chainId}-${message.bridgeType}-${message.l2FromAddress ?? 'unknown'}-${message.l2TargetAddress ?? 'unknown'}-${message.l2InputData ?? 'unknown'}-${message.status}`;
                const target = message.l2TargetAddress;
                const targetLabel = message.targetLabel;
                const call = formatCrossChainCall(message);

                const statusBadge =
                  message.status === 'success' ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] h-5 px-1.5">
                      OK
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
                      Failed
                    </Badge>
                  );

                return (
                  <div
                    key={messageKey}
                    className="border border-border/40 rounded bg-muted/20 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        {targetLabel ? <span className="font-medium">{targetLabel}</span> : null}
                        {target ? (
                          <a
                            href={buildAddressLinkForExplorer(target, explorerBaseUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center"
                            title={target}
                          >
                            {target.slice(0, 6)}...{target.slice(-4)}
                            <ExternalLinkIcon className="h-2.5 w-2.5 ml-0.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">
                            (unknown target)
                          </span>
                        )}
                      </div>
                      {statusBadge}
                    </div>

                    <code className="block mt-1.5 font-mono text-[10px] text-muted-foreground truncate">
                      {call}
                    </code>

                    {message.error ? (
                      <div className="text-[10px] text-red-600 mt-1">{message.error}</div>
                    ) : null}
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
