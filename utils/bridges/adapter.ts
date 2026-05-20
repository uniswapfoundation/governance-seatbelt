import type { Address } from 'viem';
import type { BridgeType, CrossChainExecutionJob } from '../../types.d';
import type { WormholeReceiverRuntimeStateByKey } from '../cross-chain/wormhole-receiver-sim';
import type { SimulationStateObjects } from '../derived-state';
import { extractArbitrumL1L2JobsFromProposal } from './arbitrum';
import { extractOptimismL1L2JobsFromProposal } from './optimism';
import { extractPolygonFxL1L2JobsFromProposal } from './polygon-fx';
import { extractWormholeExecutionJobsFromProposal } from './wormhole';
import { prepareWormholeExecution } from './wormhole-execution';

export type CrossChainProposalExtractionContext = {
  targets: readonly string[];
  calldatas: readonly string[];
  l1Sender?: Address;
};

type CrossChainBridgeRuntimeStoreByType = {
  ArbitrumL1L2: Record<string, unknown>;
  OptimismL1L2: Record<string, unknown>;
  PolygonFxL1L2: Record<string, unknown>;
  WormholeL1L2: WormholeReceiverRuntimeStateByKey;
};

export type CrossChainBridgeRuntimeStore = Partial<CrossChainBridgeRuntimeStoreByType>;

export type CrossChainBridgeExecutionContext = {
  job: CrossChainExecutionJob;
  workingState: SimulationStateObjects | undefined;
  sourceTimestamp: bigint;
  runtimeStore: CrossChainBridgeRuntimeStore;
};

export type CrossChainBridgePreparedExecution = {
  calls: CrossChainExecutionJob['calls'];
  simulationSender?: Address;
  compactPayloadLogging?: boolean;
  getStateObjects?: (
    workingState: SimulationStateObjects | undefined,
  ) => SimulationStateObjects | undefined;
  onStepSuccess?: (workingState: SimulationStateObjects | undefined) => void;
  finalizeCommittedState?: (
    workingState: SimulationStateObjects | undefined,
  ) => SimulationStateObjects | undefined;
};

export type CrossChainBridgeAdapter = {
  bridgeType: BridgeType;
  extractJobs: (context: CrossChainProposalExtractionContext) => CrossChainExecutionJob[];
  prepareExecution?: (
    context: CrossChainBridgeExecutionContext,
  ) => Promise<CrossChainBridgePreparedExecution>;
};

const CROSS_CHAIN_BRIDGE_ADAPTERS: readonly CrossChainBridgeAdapter[] = [
  {
    bridgeType: 'ArbitrumL1L2',
    extractJobs: ({ targets, calldatas, l1Sender }) =>
      extractArbitrumL1L2JobsFromProposal(targets, calldatas, l1Sender),
  },
  {
    bridgeType: 'OptimismL1L2',
    extractJobs: ({ targets, calldatas, l1Sender }) =>
      extractOptimismL1L2JobsFromProposal(targets, calldatas, l1Sender),
  },
  {
    bridgeType: 'PolygonFxL1L2',
    extractJobs: ({ targets, calldatas, l1Sender }) =>
      extractPolygonFxL1L2JobsFromProposal(targets, calldatas, l1Sender),
  },
  {
    bridgeType: 'WormholeL1L2',
    extractJobs: ({ targets, calldatas }) =>
      extractWormholeExecutionJobsFromProposal(targets, calldatas),
    prepareExecution: prepareWormholeExecution,
  },
] as const;

export function getCrossChainBridgeAdapters(): readonly CrossChainBridgeAdapter[] {
  return CROSS_CHAIN_BRIDGE_ADAPTERS;
}

export function getCrossChainBridgeAdapter(
  bridgeType: BridgeType,
): CrossChainBridgeAdapter | undefined {
  return CROSS_CHAIN_BRIDGE_ADAPTERS.find((adapter) => adapter.bridgeType === bridgeType);
}
