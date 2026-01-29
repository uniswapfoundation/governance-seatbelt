'use client';

import { Badge } from '@/components/ui/badge';
import type { CrossChainMessagePreview } from '@/hooks/use-simulation-results';
import { AlertTriangleIcon, CheckCircleIcon, ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ChainLogo } from './ChainLogo';
import { summarizeCrossChainMessages } from './cross-chain';
import { buildAddressLinkForExplorer } from './explorer';

export function CrossChainChecksSummary({ messages }: { messages: CrossChainMessagePreview[] }) {
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
