import { getAddress } from 'viem';
import type {
  AllCheckResults,
  DependencyStatus,
  DerivedBaselineChain,
  DerivedSimulationDependency,
  SimulationResult,
  TenderlyPayload,
  TenderlySimulation,
} from '../types.d';
import { supportsL2Checks } from './chains/capabilities';

export type SimulationStateObjects = NonNullable<TenderlyPayload['state_objects']>;
export type DerivedStateByChain = Record<number, SimulationStateObjects>;

export interface DependencyReference {
  proposalId?: string;
  simulationId?: string;
}

export interface DependencyOutcome {
  status: Exclude<DependencyStatus, 'skipped'>;
  reason?: string;
}

function normalizeStateObjects(
  stateObjects: TenderlyPayload['state_objects'] | undefined,
): SimulationStateObjects | undefined {
  if (!stateObjects) return undefined;

  const normalized: SimulationStateObjects = {};

  for (const [address, state] of Object.entries(stateObjects)) {
    const normalizedAddress = getAddress(address);
    const current = normalized[normalizedAddress] ?? {};
    const { balance, ...rest } = state;
    normalized[normalizedAddress] = {
      ...current,
      ...rest,
      ...(typeof balance === 'string' && balance.length > 0 ? { balance } : {}),
      storage: {
        ...(current.storage ?? {}),
        ...(state.storage ?? {}),
      },
    };
  }

  return normalized;
}

export function mergeStateObjects(
  base: TenderlyPayload['state_objects'] | undefined,
  overrides: TenderlyPayload['state_objects'] | undefined,
): SimulationStateObjects | undefined {
  const normalizedBase = normalizeStateObjects(base);
  const normalizedOverrides = normalizeStateObjects(overrides);

  if (!normalizedBase && !normalizedOverrides) return undefined;
  if (!normalizedBase) return { ...(normalizedOverrides ?? {}) };
  if (!normalizedOverrides) return { ...normalizedBase };

  const merged: SimulationStateObjects = { ...normalizedBase };

  for (const [address, overrideState] of Object.entries(normalizedOverrides)) {
    const current = merged[address] ?? {};
    merged[address] = {
      ...current,
      ...overrideState,
      storage: {
        ...(current.storage ?? {}),
        ...(overrideState.storage ?? {}),
      },
    };
  }

  return merged;
}

/**
 * Extract final storage, balance, and deployed runtime bytecode from a Tenderly
 * simulation and convert them into state_objects overrides that can seed a
 * dependent simulation.
 */
export function extractStateOverridesFromSimulation(
  sim: TenderlySimulation,
): SimulationStateObjects {
  if (sim.postState) return mergeStateObjects(sim.postState, undefined) ?? {};
  const overrides: SimulationStateObjects = {};
  const stateDiff = sim.transaction.transaction_info.state_diff ?? [];

  for (const contract of sim.contracts ?? []) {
    const address = getAddress(contract.address);
    const state = overrides[address] ?? {};

    overrides[address] = {
      ...state,
      ...(contract.balance ? { balance: contract.balance } : {}),
      ...(contract.deployed_bytecode ? { code: contract.deployed_bytecode } : {}),
    };
  }

  for (const entry of stateDiff) {
    for (const raw of entry.raw ?? []) {
      const address = getAddress(raw.address);
      const state = overrides[address] ?? {};
      const storage = {
        ...(state.storage ?? {}),
        [raw.key]: raw.dirty,
      };

      overrides[address] = {
        ...state,
        storage,
      };
    }
  }

  return overrides;
}

/**
 * Build per-chain state overrides from a completed simulation (source + destination).
 */
export function buildDerivedStateByChain(
  result: Pick<SimulationResult, 'sim' | 'destinationStateByChain'>,
): DerivedStateByChain {
  const byChain: DerivedStateByChain = {};

  const sourceOverrides = extractStateOverridesFromSimulation(result.sim);
  if (Object.keys(sourceOverrides).length > 0) {
    byChain[1] = sourceOverrides;
  }

  for (const [chainIdStr, stateObjects] of Object.entries(result.destinationStateByChain ?? {})) {
    const chainId = Number(chainIdStr);
    const normalized = mergeStateObjects(stateObjects, undefined);
    if (!normalized || Object.keys(normalized).length === 0) continue;
    byChain[chainId] = normalized;
  }

  return byChain;
}

/**
 * Fail-closed dependency gate.
 * - failed if source execution or destination job execution failed, or any check has errors
 * - inconclusive if checks did not execute for source/destination chains
 * - otherwise passed
 */
export function evaluateDependencyOutcome(
  predecessorResult: Pick<SimulationResult, 'sim' | 'crossChainFailure' | 'destinationJobResults'>,
  predecessorChecks: AllCheckResults,
  predecessorDestinationChecks: Record<number, AllCheckResults>,
): DependencyOutcome {
  if (!predecessorResult.sim.transaction.status) {
    return {
      status: 'failed',
      reason: 'Predecessor source simulation failed',
    };
  }

  if (predecessorResult.crossChainFailure) {
    return {
      status: 'failed',
      reason: 'Predecessor cross-chain simulation failed',
    };
  }

  const summarizeChecks = (checks: AllCheckResults) => {
    let total = 0;
    let skipped = 0;

    for (const check of Object.values(checks)) {
      total += 1;

      if (check.result.errors.length > 0) {
        return {
          total,
          skipped,
          failedCheckName: check.name,
        };
      }

      if (check.result.skipped) {
        skipped += 1;
      }
    }

    return {
      total,
      skipped,
      failedCheckName: undefined,
    };
  };

  const sourceSummary = summarizeChecks(predecessorChecks);
  if (sourceSummary.failedCheckName) {
    return {
      status: 'failed',
      reason: `Predecessor check failed: ${sourceSummary.failedCheckName}`,
    };
  }

  if (sourceSummary.total === 0 || sourceSummary.skipped === sourceSummary.total) {
    return {
      status: 'inconclusive',
      reason: 'Predecessor source checks were inconclusive (all checks skipped)',
    };
  }

  const destinationByChain = new Map<
    number,
    Array<NonNullable<SimulationResult['destinationJobResults']>[number]>
  >();

  for (const destination of predecessorResult.destinationJobResults ?? []) {
    const existing = destinationByChain.get(destination.chainId) ?? [];
    existing.push(destination);
    destinationByChain.set(destination.chainId, existing);
  }

  for (const [chainId, destinationSims] of destinationByChain.entries()) {
    if (!supportsL2Checks(chainId)) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination chain ${chainId} does not support L2 checks`,
      };
    }

    const notFullyValidated = destinationSims.some(
      (sim) => sim.status !== 'success' || !sim.accumulatedSim,
    );
    if (notFullyValidated) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination job for chain ${chainId} was not fully validated`,
      };
    }

    const destinationChecks = predecessorDestinationChecks[chainId];
    if (!destinationChecks) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination checks missing for chain ${chainId}`,
      };
    }

    const destinationSummary = summarizeChecks(destinationChecks);
    if (destinationSummary.failedCheckName) {
      return {
        status: 'failed',
        reason: `Predecessor check failed: ${destinationSummary.failedCheckName}`,
      };
    }

    if (destinationSummary.total === 0 || destinationSummary.skipped === destinationSummary.total) {
      return {
        status: 'inconclusive',
        reason: `Predecessor destination checks were inconclusive for chain ${chainId} (all checks skipped)`,
      };
    }
  }

  return { status: 'passed' };
}

export function buildDerivedBaselineChains(
  result: Pick<SimulationResult, 'sim' | 'destinationJobResults'>,
): DerivedBaselineChain[] {
  const baselines: DerivedBaselineChain[] = [];
  const destinationByChain = new Map<number, DerivedBaselineChain>();

  baselines.push({
    chainId: 1,
    simulationId: result.sim.simulation.id,
    blockNumber: result.sim.simulation.block_number.toString(),
  });

  for (const destination of result.destinationJobResults ?? []) {
    if (destination.status !== 'success' || !destination.accumulatedSim) continue;
    destinationByChain.set(destination.chainId, {
      chainId: destination.chainId,
      simulationId: destination.accumulatedSim.simulation.id,
      blockNumber: destination.accumulatedSim.simulation.block_number.toString(),
    });
  }

  baselines.push(...Array.from(destinationByChain.values()).sort((a, b) => a.chainId - b.chainId));
  return baselines;
}

export function buildDerivedProvenance(params: {
  outcome: DependencyOutcome | { status: 'skipped'; reason: string };
  reference: DependencyReference;
  baselineChains?: DerivedBaselineChain[];
}): DerivedSimulationDependency {
  return {
    mode: 'derived',
    status: params.outcome.status,
    reason: params.outcome.reason,
    derivedFromProposalId: params.reference.proposalId,
    derivedFromSimulationId: params.reference.simulationId,
    baselineChains: params.baselineChains ?? [],
  };
}
