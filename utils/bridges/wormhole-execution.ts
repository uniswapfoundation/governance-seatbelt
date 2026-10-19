import { type Address, type Hex, getAddress } from 'viem';
import type { CrossChainExecutionJob } from '../../types.d';
import { getClientForChain } from '../clients/client';
import {
  WORMHOLE_CORE_STUB_RUNTIME_BYTECODE,
  WORMHOLE_RECEIVER_ABI,
  type WormholeReceiverRuntimeState,
  type WormholeReceiverRuntimeStateByKey,
  buildWormholeReceiverSimulationCall,
  getOverriddenWormholeReceiverSequence,
  getWormholeReceiverRuntimeStateKey,
} from '../cross-chain/wormhole-receiver-sim';
import type { SimulationStateObjects } from '../derived-state';
import type {
  CrossChainBridgeExecutionContext,
  CrossChainBridgePreparedExecution,
} from './adapter';
import { getWormholeLaneCapabilities } from './wormhole';

const DEFAULT_CROSS_CHAIN_SIMULATION_SENDER = getAddress(
  '0x0000000000000000000000000000000000001234',
);
const DESTINATION_SETUP_MAX_ATTEMPTS = 3;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withDestinationSetupRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DESTINATION_SETUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt === DESTINATION_SETUP_MAX_ATTEMPTS) {
        throw error;
      }

      console.warn(
        `[CrossChainHandler] Retrying destination job setup ${label} (attempt ${attempt + 1}/${DESTINATION_SETUP_MAX_ATTEMPTS}) after error: ${getErrorMessage(error)}`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function getWormholeReceiverCoreAddress(job: CrossChainExecutionJob): Address | null {
  if (job.bridgeType !== 'WormholeL1L2') return null;
  const laneCapabilities = getWormholeLaneCapabilities(job.wormholeChainId);
  return laneCapabilities.receiverCoreAddress;
}

function parseLegacyWormholeReceiverSequenceStorage(
  storedSequence: Hex | undefined,
  job: CrossChainExecutionJob,
  runtimeStateBlockNumber: bigint,
): bigint {
  if (storedSequence === undefined || storedSequence === '0x') {
    throw new Error(
      `Missing legacy Wormhole receiver sequence storage for ${job.l2FromAddress} at block ${runtimeStateBlockNumber.toString()}`,
    );
  }

  try {
    return BigInt(storedSequence);
  } catch {
    throw new Error(
      `Invalid legacy Wormhole receiver sequence storage for ${job.l2FromAddress} at block ${runtimeStateBlockNumber.toString()}: ${storedSequence}`,
    );
  }
}

export async function findBlockNumberAtOrBeforeTimestamp(
  chainId: number,
  sourceTimestamp: bigint,
): Promise<bigint> {
  const client = getClientForChain(chainId);
  const latestBlockNumber = await withDestinationSetupRetry(
    `latest block number on chain ${chainId}`,
    async () => await client.getBlockNumber(),
  );
  const latestBlock = await withDestinationSetupRetry(
    `latest block on chain ${chainId}`,
    async () => await client.getBlock({ blockNumber: latestBlockNumber }),
  );
  if (latestBlock.timestamp <= sourceTimestamp) return latestBlock.number;

  let low = 0n;
  let high = latestBlock.number;
  let best = 0n;

  while (low <= high) {
    const mid = (low + high) / 2n;
    const candidateBlock = await withDestinationSetupRetry(
      `block ${mid} on chain ${chainId}`,
      async () => await client.getBlock({ blockNumber: mid }),
    );

    if (candidateBlock.timestamp <= sourceTimestamp) {
      best = candidateBlock.number;
      low = mid + 1n;
    } else {
      high = mid - 1n;
    }
  }

  return best;
}

function getWormholeRuntimeStore(
  context: CrossChainBridgeExecutionContext,
): WormholeReceiverRuntimeStateByKey {
  const existing = context.runtimeStore.WormholeL1L2;
  if (existing) {
    return existing;
  }

  const created: WormholeReceiverRuntimeStateByKey = {};
  context.runtimeStore.WormholeL1L2 = created;
  return created;
}

async function resolveWormholeReceiverRuntimeState(
  context: CrossChainBridgeExecutionContext,
): Promise<WormholeReceiverRuntimeState | null> {
  const { job, workingState, sourceTimestamp } = context;
  const laneCapabilities = getWormholeLaneCapabilities(job.wormholeChainId);
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  if (
    !wormholeCoreAddress ||
    job.wormholeChainId === undefined ||
    laneCapabilities.kind === 'direct'
  ) {
    return null;
  }

  const runtimeStateByKey = getWormholeRuntimeStore(context);
  const runtimeStateKey = getWormholeReceiverRuntimeStateKey(
    job.destinationChainId,
    job.l2FromAddress,
  );
  const overriddenSequence = getOverriddenWormholeReceiverSequence(workingState, job.l2FromAddress);
  const cached = runtimeStateByKey[runtimeStateKey];
  if (cached) {
    if (overriddenSequence === null) return cached;

    const refreshedRuntimeState = {
      ...cached,
      nextSequence: overriddenSequence,
    } satisfies WormholeReceiverRuntimeState;
    runtimeStateByKey[runtimeStateKey] = refreshedRuntimeState;
    return refreshedRuntimeState;
  }

  const client = getClientForChain(job.destinationChainId);
  const runtimeStateBlockNumber =
    context.blockNumber ??
    (await findBlockNumberAtOrBeforeTimestamp(job.destinationChainId, sourceTimestamp));
  const runtimeState =
    laneCapabilities.kind === 'legacy'
      ? ({
          nextSequence:
            overriddenSequence ??
            parseLegacyWormholeReceiverSequenceStorage(
              await withDestinationSetupRetry(
                `legacy sequence storage for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
                async () =>
                  await client.getStorageAt({
                    address: job.l2FromAddress,
                    slot: laneCapabilities.nextSequenceStorageSlot,
                    blockNumber: runtimeStateBlockNumber,
                  }),
              ),
              job,
              runtimeStateBlockNumber,
            ),
          expectedPayloadVersion: laneCapabilities.payloadVersion,
        } satisfies WormholeReceiverRuntimeState)
      : ({
          expectedPayloadVersion: await withDestinationSetupRetry(
            `EXPECTED_MESSAGE_PAYLOAD_VERSION for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
            async () =>
              await client.readContract({
                address: job.l2FromAddress,
                abi: WORMHOLE_RECEIVER_ABI,
                functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
                blockNumber: runtimeStateBlockNumber,
              }),
          ),
          nextSequence:
            overriddenSequence ??
            BigInt(
              await withDestinationSetupRetry(
                `nextMinimumSequence for ${job.l2FromAddress} on chain ${job.destinationChainId}`,
                async () =>
                  await client.readContract({
                    address: job.l2FromAddress,
                    abi: WORMHOLE_RECEIVER_ABI,
                    functionName: 'nextMinimumSequence',
                    blockNumber: runtimeStateBlockNumber,
                  }),
              ),
            ),
        } satisfies WormholeReceiverRuntimeState);

  runtimeStateByKey[runtimeStateKey] = runtimeState;
  return runtimeState;
}

function stripSimulationOnlyState(
  job: CrossChainExecutionJob,
  workingState: SimulationStateObjects | undefined,
): SimulationStateObjects | undefined {
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  if (!wormholeCoreAddress || !workingState) return workingState;

  const nextState = { ...workingState };
  const wormholeCoreState = nextState[wormholeCoreAddress];
  if (!wormholeCoreState) return nextState;

  const { code: _simulationOnlyCode, ...persistedState } = wormholeCoreState;
  if (Object.keys(persistedState).length === 0) {
    delete nextState[wormholeCoreAddress];
    return nextState;
  }

  nextState[wormholeCoreAddress] = persistedState;
  return nextState;
}

export async function prepareWormholeExecution(
  context: CrossChainBridgeExecutionContext,
): Promise<CrossChainBridgePreparedExecution> {
  const { job, sourceTimestamp } = context;
  const wormholeCoreAddress = getWormholeReceiverCoreAddress(job);
  const runtimeState = await resolveWormholeReceiverRuntimeState(context);

  if (!runtimeState || !wormholeCoreAddress) {
    return {
      calls: job.calls,
    };
  }

  return {
    calls: [buildWormholeReceiverSimulationCall(job, runtimeState, sourceTimestamp)],
    simulationSender: DEFAULT_CROSS_CHAIN_SIMULATION_SENDER,
    compactPayloadLogging: true,
    getStateObjects: (workingState) =>
      ({
        ...(workingState ?? {}),
        [wormholeCoreAddress]: {
          ...(workingState?.[wormholeCoreAddress] ?? {}),
          code: WORMHOLE_CORE_STUB_RUNTIME_BYTECODE,
        },
      }) satisfies SimulationStateObjects,
    onStepSuccess: (nextWorkingState) => {
      const nextSequence =
        getOverriddenWormholeReceiverSequence(nextWorkingState, job.l2FromAddress) ??
        runtimeState.nextSequence + 1n;
      getWormholeRuntimeStore(context)[
        getWormholeReceiverRuntimeStateKey(job.destinationChainId, job.l2FromAddress)
      ] = {
        ...runtimeState,
        nextSequence,
      };
    },
    finalizeCommittedState: (workingState) => stripSimulationOnlyState(job, workingState),
  };
}
