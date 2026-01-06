import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';

export interface Proposal {
  id: string;
  targets: Address[];
  values: bigint[];
  calldatas: `0x${string}`[];
  signatures: string[];
  description: string;
}

export interface SimulationCheck {
  checkId?: string;
  title: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  warningCount?: number;
  errorCount?: number;
  details?: string;
  skipReason?: string;
  info?: string[];
}

export interface CheckCoverage {
  checkId: string;
  checkName: string;
  status: 'ran' | 'skipped' | 'failed';
  skipReason?: string;
  executionTimeMs?: number;
  wasInferred?: boolean;
  chainId?: number;
}

export interface CoverageData {
  metadata: {
    gitCommitHash: string;
    gitBranch: string;
    timestamp: string;
    solcVersion?: string;
    slitherVersion?: string;
  };
  checks: CheckCoverage[];
  summary: {
    total: number;
    ran: number;
    skipped: number;
    failed: number;
    inferredSkips: number;
  };
}

export interface SimulationStateChange {
  contract: string;
  contractAddress?: string;
  key: string;
  oldValue: string;
  newValue: string;
}

export interface SimulationEvent {
  name: string;
  contract: string;
  contractAddress?: string;
  params: Array<{
    name: string;
    value: string;
    type: string;
  }>;
}

export interface SimulationCalldata {
  decoded: string;
  raw: string;
  links?: Array<{
    text: string;
    address: string;
    href: string;
  }>;
}

/**
 * Address label with metadata about the source and type
 */
export interface AddressLabel {
  label: string;
  type?: 'governance' | 'token' | 'bridge' | 'contract' | 'user';
  source?: 'custom' | 'ens' | 'tenderly';
}

export interface StructuredSimulationReport {
  title: string;
  proposalText: string;
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  summary: string;
  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];
  calldata?: SimulationCalldata;
  coverage?: CoverageData;
  metadata: {
    // Legacy fields for backwards compatibility
    blockNumber?: string;
    timestamp?: string;
    // Core fields
    proposalId: string;
    proposer: Address;
    proposerIsPlaceholder?: boolean;
    governorAddress?: string;
    executor?: Address;
    executorIsPlaceholder?: boolean;
    simulationBlockNumber?: string;
    simulationTimestamp?: string;
    proposalCreatedAtBlockNumber?: string;
    proposalCreatedAtTimestamp?: string;
    proposalExecutedAtBlockNumber?: string;
    proposalExecutedAtTimestamp?: string;
    // Extended metadata for Tally integration
    schemaVersion?: number;
    chainId?: number;
    chainName?: string;
    blockExplorerBaseUrl?: string;
    simulationType?: 'executed' | 'proposed' | 'new';
    placeholderAddresses?: string[];
    // Repository and simulation links for Issue #92
    repoCommit?: string;
    repoUrl?: string;
    tenderlyUrl?: string;
    // Address labels for entity identification (Issue #94)
    addressLabels?: Record<string, AddressLabel>;
  };
}

export interface SimulationResponse {
  proposalData: {
    id?: string;
    targets: Address[];
    values: string[];
    signatures: `0x${string}`[];
    calldatas: `0x${string}`[];
    description: string;
  };
  report: {
    structuredReport?: StructuredSimulationReport;
    markdownReport: string;
    status: 'success' | 'warning' | 'error';
    summary: string;
  };
}

/**
 * Hook to fetch simulation results from the API
 */
export function useSimulationResults() {
  return useQuery<
    SimulationResponse[],
    Error,
    { proposalData: Proposal; report: SimulationResponse['report'] }
  >({
    queryKey: ['simulationResults'],
    queryFn: async () => {
      const response = await fetch('/api/simulation-results');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch simulation results');
      }

      const data = (await response.json()) as SimulationResponse[];

      // Validate the data structure
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('Invalid simulation results: no results found');
      }

      return data;
    },
    select: (data) => {
      // Get the first result
      const firstResult = data[0];

      // Ensure proposalData and values exist
      if (!firstResult.proposalData || !firstResult.proposalData.values) {
        throw new Error('Invalid simulation results: missing proposalData.values');
      }

      return {
        proposalData: {
          ...firstResult.proposalData,
          // Add id if it doesn't exist
          id: firstResult.proposalData.id || 'unknown',
          values: firstResult.proposalData.values.map((value) => BigInt(value)),
        } as Proposal,
        report: firstResult.report,
      };
    },
    retry: false,
  });
}
