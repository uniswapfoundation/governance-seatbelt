import { type Address, getAddress } from 'viem';
import type {
  CrossChainExecutionJob,
  CrossChainExecutionJobResult,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types.d';
import {
  type CrossChainBridgePreparedExecution,
  type CrossChainBridgeRuntimeStore,
  getCrossChainBridgeAdapter,
  getCrossChainBridgeAdapters,
} from '../bridges/adapter';
import { findBlockNumberAtOrBeforeTimestamp } from '../bridges/wormhole-execution';
import { supportsL2Checks } from '../chains/capabilities';
import { sendSimulation } from '../clients/tenderly-api';
import { BLOCK_GAS_LIMIT } from '../constants';
import {
  type DerivedStateByChain,
  type SimulationStateObjects,
  extractStateOverridesFromSimulation,
  mergeStateObjects,
} from '../derived-state';

export interface TenderlySimulationExecutionOptions {
  derivedStateByChain?: DerivedStateByChain;
  initialStateByChain?: DerivedStateByChain;
}

export type TenderlyCrossChainSimulationSourceResult = Pick<
  SimulationResult,
  'proposal' | 'deps' | 'latestBlock' | 'simulationTimestamp'
> & {
  sim: {
    transaction: {
      status: boolean;
      transaction_info?: {
        call_trace?: {
          from: string;
          input: string;
          calls?: unknown[];
        };
      };
    };
  };
  destinationJobResults?: CrossChainExecutionJobResult[];
  destinationStateByChain?: Record<number, NonNullable<TenderlyPayload['state_objects']>>;
  crossChainFailure?: boolean;
};

export type TenderlyCrossChainSimulationHandledResult<
  T extends TenderlyCrossChainSimulationSourceResult,
> = Omit<T, 'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'> &
  Required<
    Pick<
      SimulationResult,
      'destinationJobResults' | 'destinationStateByChain' | 'crossChainFailure'
    >
  >;

type DestinationJobExecutionOutcome =
  | {
      status: 'success';
      jobResult: CrossChainExecutionJobResult;
      committedState: SimulationStateObjects | undefined;
    }
  | {
      status: 'failure';
      jobResult: CrossChainExecutionJobResult;
    };

const DEFAULT_CROSS_CHAIN_SIMULATION_SENDER = getAddress(
  '0x0000000000000000000000000000000000001234',
);
function extractDestinationJobs(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): CrossChainExecutionJob[] {
  const orderedJobs: Array<{ extractionIndex: number; job: CrossChainExecutionJob }> = [];
  let extractionIndex = 0;

  for (const adapter of getCrossChainBridgeAdapters()) {
    for (const job of adapter.extractJobs({ targets, calldatas, l1Sender })) {
      orderedJobs.push({ extractionIndex, job });
      extractionIndex += 1;
    }
  }

  orderedJobs.sort(
    (a, b) => a.job.sourceOrder - b.job.sourceOrder || a.extractionIndex - b.extractionIndex,
  );

  return orderedJobs.map(({ job }) => job);
}

function initializeCommittedStateByChain(
  jobs: CrossChainExecutionJob[],
  options?: TenderlySimulationExecutionOptions,
): DerivedStateByChain {
  const committedStateByChain: DerivedStateByChain = {};

  for (const chainId of new Set(jobs.map((job) => job.destinationChainId))) {
    const committed = mergeStateObjects(
      options?.initialStateByChain?.[chainId],
      options?.derivedStateByChain?.[chainId],
    );
    if (committed) {
      committedStateByChain[chainId] = committed;
    }
  }

  return committedStateByChain;
}

function getDestinationFailureReason(sim: TenderlySimulation): string {
  const traceReason = sim.transaction?.transaction_info?.call_trace?.error_reason;
  if (traceReason && traceReason.trim().length > 0) return traceReason;

  const stackReason = sim.transaction?.transaction_info?.stack_trace?.find(
    (frame) =>
      (typeof frame.error_reason === 'string' && frame.error_reason.trim().length > 0) ||
      (typeof frame.error === 'string' && frame.error.trim().length > 0),
  );
  if (stackReason?.error_reason?.trim()) return stackReason.error_reason;
  if (stackReason?.error?.trim()) return stackReason.error;

  return 'Destination job failed (no detailed error returned by RPC).';
}

function buildSkippedDestinationJobResult(
  job: CrossChainExecutionJob,
): CrossChainExecutionJobResult {
  return {
    chainId: job.destinationChainId,
    bridgeType: job.bridgeType,
    job,
    status: 'skipped',
    stepResults: [],
    error: `Skipping destination job: chain ${job.destinationChainId} is not supported by the destination checks.`,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatPayloadForLog(payload: TenderlyPayload, compactLogging: boolean): string {
  if (!compactLogging) {
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify(
    {
      network_id: payload.network_id,
      from: payload.from,
      to: payload.to,
      value: payload.value,
      gas: payload.gas,
      receiverMode: true,
      inputPrefix:
        typeof payload.input === 'string' ? `${payload.input.slice(0, 18)}...` : payload.input,
      stateObjectKeys: Object.keys(payload.state_objects ?? {}),
    },
    null,
    2,
  );
}

function buildDestinationSimulationPayload(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  execution: CrossChainBridgePreparedExecution,
  workingState: SimulationStateObjects | undefined,
  blockNumber: number,
): TenderlyPayload {
  const syntheticReceiver = execution.simulationSender === DEFAULT_CROSS_CHAIN_SIMULATION_SENDER;
  if (syntheticReceiver && BigInt(call.l2Value) !== 0n) {
    throw new Error(
      'Nonzero receiver message value is unsupported without independent value funding',
    );
  }
  return {
    block_number: blockNumber,
    network_id: job.destinationChainId.toString() as TenderlyPayload['network_id'],
    from: execution.simulationSender ?? job.l2FromAddress ?? DEFAULT_CROSS_CHAIN_SIMULATION_SENDER,
    to: call.l2TargetAddress,
    input: call.l2InputData,
    fund_synthetic_sender: syntheticReceiver,
    gas: BLOCK_GAS_LIMIT,
    value: call.l2Value,
    save_if_fails: false,
    save: false,
    state_objects: execution.getStateObjects?.(workingState) ?? workingState,
  };
}

async function simulateDestinationCall(
  job: CrossChainExecutionJob,
  call: CrossChainExecutionJob['calls'][number],
  execution: CrossChainBridgePreparedExecution,
  workingState: SimulationStateObjects | undefined,
  stepIndex: number,
  totalSteps: number,
  blockNumber: number,
): Promise<TenderlySimulation> {
  const payload = buildDestinationSimulationPayload(
    job,
    call,
    execution,
    workingState,
    blockNumber,
  );

  console.log(
    `[CrossChainHandler] Sending L2 Simulation Payload (Chain ${payload.network_id}, Step ${stepIndex + 1}/${totalSteps}):`,
    formatPayloadForLog(payload, execution.compactPayloadLogging ?? false),
  );

  return await sendSimulation(payload);
}

async function executeDestinationJob(
  job: CrossChainExecutionJob,
  committedState: SimulationStateObjects | undefined,
  runtimeStore: CrossChainBridgeRuntimeStore,
  sourceTimestamp: bigint,
  blockNumber: number,
): Promise<DestinationJobExecutionOutcome> {
  let workingState = mergeStateObjects(committedState, undefined);
  const stepResults: CrossChainExecutionJobResult['stepResults'] = [];
  let accumulatedSim: TenderlySimulation | undefined;
  let execution: CrossChainBridgePreparedExecution = {
    calls: job.calls,
  };
  const bridgeAdapter = getCrossChainBridgeAdapter(job.bridgeType);

  try {
    if (bridgeAdapter?.prepareExecution) {
      execution = await bridgeAdapter.prepareExecution({
        job,
        workingState,
        sourceTimestamp,
        blockNumber: BigInt(blockNumber),
        runtimeStore,
      });
    }
  } catch (error: unknown) {
    const jobError = `Destination job setup failed: ${getErrorMessage(error)}`;
    console.error(
      `[CrossChainHandler] Error preparing destination job on chain ${job.destinationChainId}:`,
      error,
    );

    return {
      status: 'failure',
      jobResult: {
        chainId: job.destinationChainId,
        bridgeType: job.bridgeType,
        job,
        status: 'failure',
        stepResults,
        error: jobError,
      },
    };
  }
  const stepCalls = execution.calls;

  for (let stepIndex = 0; stepIndex < stepCalls.length; stepIndex += 1) {
    const call = stepCalls[stepIndex];

    try {
      const destSim = await simulateDestinationCall(
        job,
        call,
        execution,
        workingState,
        stepIndex,
        stepCalls.length,
        blockNumber,
      );

      if (!destSim.transaction.status) {
        const jobError = getDestinationFailureReason(destSim);
        console.error(
          `[CrossChainHandler] Destination job step failed for L2 target: ${call.l2TargetAddress}`,
        );
        stepResults.push({
          stepIndex,
          call,
          status: 'failure',
          sim: destSim,
          error: jobError,
        });

        return {
          status: 'failure',
          jobResult: {
            chainId: job.destinationChainId,
            bridgeType: job.bridgeType,
            job,
            status: 'failure',
            stepResults,
            error: jobError,
          },
        };
      }

      accumulatedSim = destSim;
      stepResults.push({
        stepIndex,
        call,
        status: 'success',
        sim: destSim,
      });
      const nextWorkingState =
        mergeStateObjects(workingState, extractStateOverridesFromSimulation(destSim)) ??
        workingState;
      execution.onStepSuccess?.(nextWorkingState);
      workingState = nextWorkingState;
    } catch (error: unknown) {
      const jobError = `Destination job step simulation API call failed: ${getErrorMessage(error)}`;
      console.error(
        `[CrossChainHandler] Error during destination job step simulation API call for L2 target ${call.l2TargetAddress}:`,
        error,
      );
      stepResults.push({
        stepIndex,
        call,
        status: 'failure',
        error: jobError,
      });

      return {
        status: 'failure',
        jobResult: {
          chainId: job.destinationChainId,
          bridgeType: job.bridgeType,
          job,
          status: 'failure',
          stepResults,
          error: jobError,
        },
      };
    }
  }

  return {
    status: 'success',
    jobResult: {
      chainId: job.destinationChainId,
      bridgeType: job.bridgeType,
      job,
      status: 'success',
      stepResults,
      accumulatedSim,
    },
    committedState: execution.finalizeCommittedState?.(workingState) ?? workingState,
  };
}

export async function handleCrossChainSimulations<
  T extends TenderlyCrossChainSimulationSourceResult,
>(
  sourceResult: T,
  options?: TenderlySimulationExecutionOptions,
): Promise<TenderlyCrossChainSimulationHandledResult<T>> {
  const result: TenderlyCrossChainSimulationHandledResult<T> = {
    ...sourceResult,
    destinationJobResults: sourceResult.destinationJobResults ?? [],
    destinationStateByChain: sourceResult.destinationStateByChain ?? {},
    crossChainFailure: sourceResult.crossChainFailure ?? false,
  };

  if (!result.sim.transaction.status) {
    console.log('[CrossChainHandler] Source simulation failed, skipping destination checks.');
    return result;
  }

  console.log('[CrossChainHandler] Parsing source sim for execution jobs...');

  if (!result.proposal?.targets?.length || !result.proposal?.calldatas?.length) {
    console.log('[CrossChainHandler] No cross-chain execution jobs detected.');
    return result;
  }

  const l1Sender = result.deps?.timelock?.address;
  const extractedJobs = extractDestinationJobs(
    result.proposal.targets,
    result.proposal.calldatas,
    l1Sender,
  );

  if (extractedJobs.length === 0) {
    console.log('[CrossChainHandler] No cross-chain execution jobs detected.');
    return result;
  }

  const committedStateByChain = initializeCommittedStateByChain(extractedJobs, options);
  const runtimeStore: CrossChainBridgeRuntimeStore = {};
  const destinationResults: CrossChainExecutionJobResult[] = [];

  console.log(
    `[CrossChainHandler] Detected ${extractedJobs.length} execution jobs. Executing destination jobs...`,
  );

  const blocksByChain = new Map<number, number>();
  for (const job of extractedJobs) {
    const destinationChainId = job.destinationChainId;
    const targetSummary = job.calls.map((call) => call.l2TargetAddress).join(', ');
    console.log(
      `[CrossChainHandler] Executing destination job on chain ${destinationChainId}: ${targetSummary}`,
    );

    if (!supportsL2Checks(destinationChainId)) {
      const skippedResult = buildSkippedDestinationJobResult(job);
      console.warn(`[CrossChainHandler] ${skippedResult.error}`);
      destinationResults.push(skippedResult);
      continue;
    }

    let blockNumber = blocksByChain.get(destinationChainId);
    if (blockNumber === undefined) {
      try {
        blockNumber = Number(
          await findBlockNumberAtOrBeforeTimestamp(
            destinationChainId,
            result.simulationTimestamp ?? result.latestBlock.timestamp,
          ),
        );
        blocksByChain.set(destinationChainId, blockNumber);
      } catch {
        destinationResults.push({
          chainId: destinationChainId,
          bridgeType: job.bridgeType,
          job,
          status: 'failure',
          stepResults: [],
          error: `RPC block lookup failed on chain ${destinationChainId}`,
        });
        continue;
      }
    }
    const executionOutcome = await executeDestinationJob(
      job,
      committedStateByChain[destinationChainId],
      runtimeStore,
      result.simulationTimestamp ?? result.latestBlock.timestamp,
      blockNumber,
    );
    if (executionOutcome.status === 'success' && executionOutcome.committedState) {
      committedStateByChain[destinationChainId] = executionOutcome.committedState;
    }
    destinationResults.push(executionOutcome.jobResult);
  }

  result.destinationJobResults = destinationResults;
  result.destinationStateByChain = committedStateByChain;
  result.crossChainFailure = destinationResults.some((res) => res.status === 'failure');

  return result;
}
