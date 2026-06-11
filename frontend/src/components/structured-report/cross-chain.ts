import type {
  CrossChainJobPreview,
  CrossChainJobStepPreview,
} from '@/hooks/use-simulation-results';
import { resolveChainName } from '@/lib/chain-name';

const BRIDGE_TYPE_LABELS: Record<string, string> = {
  ArbitrumL1L2: 'Arbitrum',
  OptimismL1L2: 'OP Stack',
  PolygonFxL1L2: 'Polygon FxPortal',
  WormholeL1L2: 'Wormhole',
  LayerZeroL1L2: 'LayerZero',
};

export function formatBridgeType(bridgeType: string | undefined): string | undefined {
  if (!bridgeType) return undefined;
  return BRIDGE_TYPE_LABELS[bridgeType] ?? bridgeType;
}

export function formatCrossChainCall(step: CrossChainJobStepPreview): string {
  if (step.forwardedCall?.signature) return step.forwardedCall.signature;
  if (step.forwardedCall?.selector) return step.forwardedCall.selector;
  if (step.call?.signature) return step.call.signature;
  if (step.call?.selector) return step.call.selector;
  if (step.l2InputData) return step.l2InputData.slice(0, 10);
  return '(unknown)';
}

export function getCrossChainStepTarget(step: CrossChainJobStepPreview): string | undefined {
  return step.forwardedTargetAddress ?? step.l2TargetAddress;
}

export function getCrossChainStepTargetLabel(step: CrossChainJobStepPreview): string | undefined {
  return step.forwardedTargetLabel ?? step.targetLabel;
}

export function getCrossChainTransportLabel(step: CrossChainJobStepPreview): string | null {
  if (!step.forwardedCall && step.call?.signature !== 'forward(address,bytes)') {
    return null;
  }

  return step.call?.signature ?? step.call?.selector ?? 'forward(...)';
}

type CrossChainChainSummary = {
  chainId: number;
  chainName: string;
  explorerBaseUrl: string;
  bridgeType?: string;
  total: number;
  successCount: number;
  failureCount: number;
  failures: Array<{
    sourceOrder: number;
    status: 'failure' | 'skipped';
    call: string | null;
    transportLabel?: string;
    targetLabel?: string;
    target?: string;
    error?: string;
  }>;
};

function toFailureStatus(status: CrossChainJobPreview['status']): 'failure' | 'skipped' {
  return status === 'failure' ? 'failure' : 'skipped';
}

export function summarizeCrossChainJobs(jobs: CrossChainJobPreview[]): {
  total: number;
  successCount: number;
  failureCount: number;
  chains: CrossChainChainSummary[];
} {
  const byChain = new Map<number, CrossChainJobPreview[]>();
  for (const job of jobs) {
    const list = byChain.get(job.chainId) ?? [];
    list.push(job);
    byChain.set(job.chainId, list);
  }

  const chains: CrossChainChainSummary[] = Array.from(byChain.entries())
    .map(([chainId, chainJobs]) => {
      const chainName = resolveChainName(chainId, chainJobs[0]?.chainName);
      const explorerBaseUrl = chainJobs[0]?.blockExplorerBaseUrl || 'https://etherscan.io';
      const bridgeType = formatBridgeType(chainJobs[0]?.bridgeType);
      const successCount = chainJobs.filter((job) => job.status === 'success').length;
      const failureCount = chainJobs.length - successCount;

      return {
        chainId,
        chainName,
        explorerBaseUrl,
        bridgeType,
        total: chainJobs.length,
        successCount,
        failureCount,
        failures: chainJobs
          .map((job) => ({
            sourceOrder: job.sourceOrder,
            call: job.steps[0] ? formatCrossChainCall(job.steps[0]) : null,
            transportLabel: job.steps[0] ? getCrossChainTransportLabel(job.steps[0]) : null,
            targetLabel: job.steps[0] ? getCrossChainStepTargetLabel(job.steps[0]) : undefined,
            target: job.steps[0] ? getCrossChainStepTarget(job.steps[0]) : undefined,
            status: job.status,
            error: job.error,
          }))
          .filter((job) => job.status !== 'success')
          .map(({ sourceOrder, status, call, transportLabel, targetLabel, target, error }) => ({
            sourceOrder,
            status: toFailureStatus(status),
            call,
            transportLabel: transportLabel ?? undefined,
            targetLabel,
            target,
            error,
          })),
      };
    })
    .sort((a, b) => a.chainName.localeCompare(b.chainName));

  const total = chains.reduce((acc, c) => acc + c.total, 0);
  const successCount = chains.reduce((acc, c) => acc + c.successCount, 0);
  const failureCount = total - successCount;

  return { total, successCount, failureCount, chains };
}
