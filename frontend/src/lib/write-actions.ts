import type { Address } from 'viem';

export type SimulationType = 'new' | 'proposed' | 'executed';
export type WriteAction = 'propose' | 'execute';

export function parseSimulationType(value: unknown): SimulationType | null {
  if (value === 'new' || value === 'proposed' || value === 'executed') return value;
  return null;
}

export function getWriteActionForSimulationType(simulationType: unknown): WriteAction | null {
  if (simulationType == null) return 'propose';
  const parsed = parseSimulationType(simulationType);
  if (!parsed) return null;
  if (parsed === 'proposed') return 'execute';
  if (parsed === 'executed') return null;
  return 'propose';
}

export type ProposeLike = {
  targets: readonly Address[];
  values: readonly (bigint | string | number)[];
  signatures: readonly string[];
  calldatas: readonly `0x${string}`[];
  description: string;
};

export function buildProposeArgs(proposalData: ProposeLike) {
  return [
    proposalData.targets,
    proposalData.values.map((value) => BigInt(value)),
    proposalData.signatures,
    proposalData.calldatas,
    proposalData.description,
  ] as const;
}

export function buildExecuteArgs(proposalId: string | bigint) {
  return [BigInt(proposalId)] as const;
}

export type ExecuteSimulationLike = {
  report: {
    structuredReport?: {
      metadata?: {
        proposalId?: string;
        simulationType?: SimulationType;
      };
    };
  };
};

export function buildExecuteArgsFromSimulationData(simulationData: ExecuteSimulationLike) {
  const proposalId = simulationData.report.structuredReport?.metadata?.proposalId;
  if (!proposalId) throw new Error('Proposal ID not found in simulation data');
  return buildExecuteArgs(proposalId);
}
