'use client';

import { normalizeArtifactUrl } from '@/lib/share-link';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
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
  status: 'passed' | 'warning' | 'failed' | 'skipped' | 'inconclusive';
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

export interface ChainSimulationReport {
  chainId: number;
  chainName: string;
  blockExplorerBaseUrl?: string;
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];
}

export interface StructuredSimulationReport {
  title: string;
  proposalText: string;
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  summary: string;
  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];
  chainReports?: ChainSimulationReport[];
  permissionsDiff?: PermissionsDiffItem[];
  calldata?: SimulationCalldata;
  crossChain?: CrossChainPreview;
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
    // On-chain proposal state (Issue #165)
    proposalState?: string;
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
    status: 'success' | 'warning' | 'error' | 'inconclusive';
    summary: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIssueSummaryItem(value: unknown): value is { path: string; message: string } {
  if (!isRecord(value)) return false;

  const path = Reflect.get(value, 'path');
  const message = Reflect.get(value, 'message');

  return typeof path === 'string' && typeof message === 'string';
}

function getErrorSummary(errorData: unknown): string {
  if (!isRecord(errorData)) {
    return 'Failed to fetch simulation results';
  }

  const errorMessage = Reflect.get(errorData, 'error');
  const issues = Reflect.get(errorData, 'issues');

  const issuesSummary = Array.isArray(issues)
    ? issues
        .filter(isIssueSummaryItem)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
    : '';

  const baseMessage =
    typeof errorMessage === 'string' ? errorMessage : 'Failed to fetch simulation results';
  return issuesSummary ? `${baseMessage} (${issuesSummary})` : baseMessage;
}

function isSimulationResponseArray(value: unknown): value is SimulationResponse[] {
  if (!Array.isArray(value) || value.length === 0) return false;

  return value.every((entry) => {
    if (!isRecord(entry)) return false;

    const proposalData = Reflect.get(entry, 'proposalData');
    if (!isRecord(proposalData)) return false;

    const values = Reflect.get(proposalData, 'values');
    if (!Array.isArray(values)) return false;

    const report = Reflect.get(entry, 'report');
    return isRecord(report);
  });
}

/**
 * Hook to fetch simulation results from the API
 */
export function useSimulationResults() {
  const searchParams = useSearchParams();
  const artifactUrl = normalizeArtifactUrl(searchParams.get('artifact'));

  return useQuery<
    SimulationResponse[],
    Error,
    { proposalData: Proposal; report: SimulationResponse['report'] }
  >({
    queryKey: ['simulationResults', artifactUrl ?? 'local'],
    queryFn: async () => {
      const requestParams = new URLSearchParams();
      if (artifactUrl) {
        requestParams.set('artifact', artifactUrl);
      }

      const endpoint = requestParams.size
        ? `/api/simulation-results?${requestParams.toString()}`
        : '/api/simulation-results';

      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) {
        const errorData: unknown = await response.json();
        throw new Error(getErrorSummary(errorData));
      }

      const data: unknown = await response.json();
      if (!isSimulationResponseArray(data)) {
        throw new Error('Invalid simulation results: no results found');
      }

      return data;
    },
    select: (data) => {
      const firstResult = data[0];

      const proposalData: Proposal = {
        id: firstResult.proposalData.id || 'unknown',
        targets: firstResult.proposalData.targets,
        values: firstResult.proposalData.values.map((value) => BigInt(value)),
        signatures: firstResult.proposalData.signatures,
        calldatas: firstResult.proposalData.calldatas,
        description: firstResult.proposalData.description,
      };

      return {
        proposalData,
        report: firstResult.report,
      };
    },
    retry: false,
  });
}
