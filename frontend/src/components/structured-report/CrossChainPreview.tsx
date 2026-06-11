'use client';

import { Badge } from '@/components/ui/badge';
import type { CrossChainJobPreview } from '@/hooks/use-simulation-results';
import { resolveChainName } from '@/lib/chain-name';
import { ExternalLinkIcon } from 'lucide-react';
import { useMemo } from 'react';
import { ChainLogo } from './ChainLogo';
import {
  formatBridgeType,
  formatCrossChainCall,
  getCrossChainStepTarget,
  getCrossChainStepTargetLabel,
  getCrossChainTransportLabel,
} from './cross-chain';
import { buildAddressLinkForExplorer } from './explorer';

function CrossChainStatusBadge({
  status,
}: {
  status: CrossChainJobPreview['status'];
}) {
  if (status === 'success') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] h-5 px-1.5">
        OK
      </Badge>
    );
  }

  if (status === 'skipped') {
    return (
      <Badge variant="outline" className="text-[10px] h-5 px-1.5">
        Skipped
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
      Failed
    </Badge>
  );
}

export function CrossChainPreview({ jobs }: { jobs: CrossChainJobPreview[] }) {
  const groups = useMemo(() => {
    const byChain = new Map<number, CrossChainJobPreview[]>();
    for (const job of jobs) {
      const list = byChain.get(job.chainId) ?? [];
      list.push(job);
      byChain.set(job.chainId, list);
    }
    return Array.from(byChain.entries()).sort((a, b) => {
      const aName = resolveChainName(a[0], a[1][0]?.chainName);
      const bName = resolveChainName(b[0], b[1][0]?.chainName);
      return aName.localeCompare(bName);
    });
  }, [jobs]);

  return (
    <div className="space-y-3">
      {groups.map(([chainId, chainJobs]) => {
        const chainName = resolveChainName(chainId, chainJobs[0]?.chainName);
        const explorerBaseUrl = chainJobs[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
        const bridgeType = formatBridgeType(chainJobs[0]?.bridgeType);

        return (
          <div key={chainId}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ChainLogo chainId={chainId} size={16} />
                <span title={`Chain ID: ${chainId}`}>{chainName}</span>
              </div>
              {bridgeType ? (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {bridgeType}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              {chainJobs.map((job) => {
                const jobKey = `${job.chainId}-${job.bridgeType}-${job.sourceOrder}-${job.l2FromAddress}-${job.status}`;
                const stepCount = job.steps.length;

                return (
                  <div key={jobKey} className="border border-border/40 rounded bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium">
                        {stepCount} destination call{stepCount === 1 ? '' : 's'}
                      </div>
                      <CrossChainStatusBadge status={job.status} />
                    </div>

                    {stepCount ? (
                      <div className="mt-2 space-y-2">
                        {job.steps.map((step, index) => {
                          const target = getCrossChainStepTarget(step);
                          const targetLabel = getCrossChainStepTargetLabel(step);
                          const call = formatCrossChainCall(step);
                          const transportLabel = getCrossChainTransportLabel(step);

                          return (
                            <div
                              key={`${jobKey}-${step.stepIndex}-${index}`}
                              className="rounded border border-border/30 bg-background/70 p-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs min-w-0">
                                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
                                    {index + 1}
                                  </span>
                                  {targetLabel ? (
                                    <span className="font-medium truncate">{targetLabel}</span>
                                  ) : null}
                                  {target ? (
                                    <a
                                      href={buildAddressLinkForExplorer(target, explorerBaseUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center shrink-0"
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
                                {step.status !== 'success' ? (
                                  <CrossChainStatusBadge status={step.status} />
                                ) : null}
                              </div>

                              <code className="block mt-1.5 font-mono text-[10px] text-muted-foreground truncate">
                                {call}
                              </code>
                              {transportLabel ? (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  via <code className="font-mono">{transportLabel}</code>
                                </div>
                              ) : null}

                              {step.error ? (
                                <div className="text-[10px] text-red-600 mt-1">{step.error}</div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <code className="block mt-1.5 font-mono text-[10px] text-muted-foreground truncate">
                        (empty job)
                      </code>
                    )}

                    {job.error ? (
                      <div className="text-[10px] text-red-600 mt-1">{job.error}</div>
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
