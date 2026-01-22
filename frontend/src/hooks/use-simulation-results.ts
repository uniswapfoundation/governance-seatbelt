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
  skipReason?: string;
  warningCount?: number;
  errorCount?: number;
  details?: string;
  info?: string[];
  warnings?: string[];
  errors?: string[];
  data?: unknown;
  infoItems?: Array<{
    label: string;
    value: string;
    isCode?: boolean;
    isLink?: boolean;
    href?: string;
  }>;
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

export interface AddressLabel {
  label: string;
  type?: 'governance' | 'token' | 'bridge' | 'contract' | 'user';
  source?: 'custom' | 'ens' | 'tenderly';
}

export type PermissionsDiffItem =
  | {
      kind: 'ownership_transferred';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    }
  | {
      kind: 'role_granted' | 'role_revoked';
      contractAddress: Address;
      contractName?: string;
      role: { id: `0x${string}`; name: string | null };
      account: Address;
      sender: Address;
    }
  | {
      kind: 'timelock_admin_changed';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    }
  | {
      kind: 'timelock_pending_admin_changed';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    };

export interface CrossChainDecodedCall {
  selector: `0x${string}`;
  signature?: string;
  args?: unknown[];
}

export interface CrossChainMessagePreview {
  chainId: number;
  chainName: string;
  blockExplorerBaseUrl: string;
  bridgeType: string;
  status: 'success' | 'failure';
  error?: string;
  l2FromAddress?: Address;
  l2TargetAddress?: Address;
  l2Value?: string;
  l2InputData?: `0x${string}`;
  targetLabel?: string;
  call?: CrossChainDecodedCall;
}

export interface CrossChainPreview {
  messages: CrossChainMessagePreview[];
}

export interface StructuredSimulationReport {
  title: string;
  proposalText: string;
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  summary: string;
  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];
  permissionsDiff?: PermissionsDiffItem[];
  calldata?: SimulationCalldata;
  crossChain?: CrossChainPreview;
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
        const issuesSummary =
          Array.isArray(errorData.issues) && errorData.issues.length > 0
            ? ` (${errorData.issues.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join('; ')})`
            : '';
        throw new Error(
          `${errorData.error || 'Failed to fetch simulation results'}${issuesSummary}`,
        );
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
