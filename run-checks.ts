/**
 * @notice Script to run checks for a specific proposal ID
 */

import { execFileSync } from 'node:child_process';
import { getAddress } from 'viem';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type {
  AllCheckResults,
  ChainExecutionDiagnostics,
  CheckCoverage,
  CheckResult,
  CheckRetryDiagnostic,
  CoverageData,
  CoverageMetadata,
  FailedCheckExecutionDiagnostic,
  Message,
  ProposalCheck,
  ProposalData,
  ProposalEvent,
  SimulationConfig,
  SimulationResult,
  TenderlySimulation,
} from './types.d';
import { getChainConfig, getClientForChain, publicClient } from './utils/clients/client';
import { handleCrossChainSimulations, simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, REPORTS_OUTPUT_DIRECTORY } from './utils/constants';
import {
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * Patterns that indicate a check skipped execution (for heuristic fallback)
 */
const SKIP_PATTERNS = [
  /^skipped/i,
  /^No .+ detected$/i,
  /^No .+ found$/i,
  /^No .+ to analyze/i,
  /not applicable/i,
  /skipped for L2/i,
  /verification skipped/i,
  /No L2 targets found/i,
  /only the timelock and governor/i,
];

const MAX_CHECK_RETRIES = 1;

const RETRYABLE_ERROR_PATTERNS = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /network/i,
  /fetch failed/i,
  /timeout/i,
  /rate limit/i,
  /429/i,
  /502/i,
  /503/i,
  /504/i,
  /rpc/i,
  /etherscan/i,
  /sourcify/i,
  /tenderly/i,
  /gateway/i,
  /temporar/i,
  /socket hang up/i,
];

export const L2_CHECK_SUPPORTED_CHAIN_IDS = new Set([
  10, // Optimism
  8453, // Base
  42161, // Arbitrum
  130, // Unichain
  57073, // Ink
  1868, // Soneium
  60808, // Bob
  196, // X Layer
  42220, // Celo
  480, // World Chain
  7777777, // Zora
]);

/**
 * Infer if a check was skipped based on info messages (heuristic fallback)
 */
function inferSkipFromInfo(info: Message[]): string | null {
  if (info.length === 0) return null;

  // Only infer a skip if *all* messages look like a skip/not-applicable signal.
  // This avoids false positives for checks that legitimately run but include
  // some "not applicable" informational rows (e.g. EOAs in verification checks).
  const allSkipLike = info.every((msg) => SKIP_PATTERNS.some((pattern) => pattern.test(msg)));
  if (!allSkipLike) return null;

  return info[0] ?? null;
}

const CHECK_EXECUTION_ORDER = [
  'checkStateChanges',
  'checkLogs',
  'checkProxyResolution',
  'checkPermissionDiff',
  'checkEthBalanceChanges',
  'checkTreasuryMovement',
  'checkDecodeCalldata',
  'checkTargetsVerifiedOnBlockExplorer',
  'checkTouchedContractsVerifiedOnBlockExplorer',
  'checkTargetsNoSelfdestruct',
  'checkTouchedContractsNoSelfdestruct',
  // Preserve explicit dependency ordering.
  'checkSolc',
  'checkSlither',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRetryableCheckFailure(error: unknown): boolean {
  const message = toErrorMessage(error);
  if (RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (isRecord(error)) {
    const code = error.code;
    if (typeof code === 'string') {
      const normalized = code.toUpperCase();
      if (
        normalized === 'ETIMEDOUT' ||
        normalized === 'ECONNRESET' ||
        normalized === 'ECONNREFUSED' ||
        normalized === 'ENOTFOUND' ||
        normalized === 'EAI_AGAIN'
      ) {
        return true;
      }
    }
  }

  return false;
}

function buildInconclusiveCheckResult(
  checkId: string,
  checkName: string,
  reason: string,
  retries: number,
  retryable: boolean,
): CheckResult {
  return {
    info: [],
    warnings: [],
    errors: [],
    skipped: {
      reason: `Inconclusive: ${reason}`,
    },
    data: {
      executionFailure: {
        checkId,
        checkName,
        reason,
        retries,
        retryable,
      },
    },
  };
}

type CheckExecutionRunResult = {
  result: CheckResult;
  failedDiagnostic?: FailedCheckExecutionDiagnostic;
  retryDiagnostic?: CheckRetryDiagnostic;
};

async function runCheckWithIsolationAndRetry(
  checkId: string,
  check: ProposalCheck,
  proposal: ProposalEvent,
  sim: TenderlySimulation,
  deps: ProposalData,
  l2Simulations?: {
    chainId: number;
    sim: TenderlySimulation;
  }[],
): Promise<CheckExecutionRunResult> {
  let retries = 0;
  let lastErrorMessage = '';
  let retryable = false;

  while (retries <= MAX_CHECK_RETRIES) {
    try {
      const result = await check.checkProposal(proposal, sim, deps, l2Simulations);
      if (retries > 0) {
        return {
          result,
          retryDiagnostic: {
            checkId,
            checkName: check.name,
            retries,
            outcome: 'success',
            lastError: lastErrorMessage,
          },
        };
      }
      return { result };
    } catch (error) {
      lastErrorMessage = toErrorMessage(error);
      retryable = isRetryableCheckFailure(error);

      if (retryable && retries < MAX_CHECK_RETRIES) {
        retries += 1;
        continue;
      }

      const failureReason = `Check execution failed (${checkId}): ${lastErrorMessage}`;
      return {
        result: buildInconclusiveCheckResult(
          checkId,
          check.name,
          failureReason,
          retries,
          retryable,
        ),
        failedDiagnostic: {
          checkId,
          checkName: check.name,
          reason: failureReason,
          retryable,
          retries,
        },
        ...(retries > 0
          ? {
              retryDiagnostic: {
                checkId,
                checkName: check.name,
                retries,
                outcome: 'failed',
                lastError: lastErrorMessage,
              },
            }
          : {}),
      };
    }
  }

  const unexpectedReason = `Unexpected retry loop termination for ${checkId}`;
  return {
    result: buildInconclusiveCheckResult(checkId, check.name, unexpectedReason, retries, retryable),
    failedDiagnostic: {
      checkId,
      checkName: check.name,
      reason: unexpectedReason,
      retryable,
      retries,
    },
  };
}

function createEmptyChainExecutionDiagnostics(chainId: number): ChainExecutionDiagnostics {
  return {
    chainId,
    attemptedChecks: [],
    failedChecks: [],
    retries: [],
    partial: false,
  };
}

function dedupeStrings(messages: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    deduped.push(message);
  }
  return deduped;
}

function dedupeJsonValues<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = JSON.stringify(item, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeCheckResult(current: CheckResult, next: CheckResult): CheckResult {
  const info = dedupeStrings([...current.info, ...next.info]);
  const warnings = dedupeStrings([...current.warnings, ...next.warnings]);
  const errors = dedupeStrings([...current.errors, ...next.errors]);

  const skippedReasons = [current.skipped?.reason, next.skipped?.reason].filter(
    (reason): reason is string => Boolean(reason),
  );
  const skipped =
    current.skipped && next.skipped && skippedReasons.length > 0
      ? { reason: dedupeStrings(skippedReasons).join(' | ') }
      : undefined;

  const permissionsDiffMerged = dedupeJsonValues([
    ...(current.permissionsDiff ?? []),
    ...(next.permissionsDiff ?? []),
  ]);
  const permissionsDiff = permissionsDiffMerged.length > 0 ? permissionsDiffMerged : undefined;

  let data = current.data ?? next.data;
  if (current.data !== undefined && next.data !== undefined) {
    if (Array.isArray(current.data) && Array.isArray(next.data)) {
      data = dedupeJsonValues([...current.data, ...next.data]);
    } else if (isPlainObject(current.data) && isPlainObject(next.data)) {
      data = { ...current.data, ...next.data };
    }
  }

  return {
    info,
    warnings,
    errors,
    ...(data !== undefined ? { data } : {}),
    ...(skipped ? { skipped } : {}),
    ...(permissionsDiff ? { permissionsDiff } : {}),
  };
}

export function mergeAllCheckResults(
  current: AllCheckResults,
  next: AllCheckResults,
): AllCheckResults {
  const merged: AllCheckResults = { ...current };

  for (const [checkId, nextCheck] of Object.entries(next)) {
    const currentCheck = merged[checkId];

    if (!currentCheck) {
      merged[checkId] = nextCheck;
      continue;
    }

    merged[checkId] = {
      name: currentCheck.name || nextCheck.name,
      result: mergeCheckResult(currentCheck.result, nextCheck.result),
    };
  }

  return merged;
}

function mergeChainExecutionDiagnostics(
  current: ChainExecutionDiagnostics,
  next: ChainExecutionDiagnostics,
): ChainExecutionDiagnostics {
  const retryEntries = dedupeJsonValues([...current.retries, ...next.retries]);
  const failedChecks = dedupeJsonValues([...current.failedChecks, ...next.failedChecks]);
  const attemptedChecks = dedupeStrings([...current.attemptedChecks, ...next.attemptedChecks]);

  const reasons = [current.partialReason, next.partialReason].filter((reason): reason is string =>
    Boolean(reason),
  );

  return {
    chainId: current.chainId,
    attemptedChecks,
    failedChecks,
    retries: retryEntries,
    partial: current.partial || next.partial,
    ...(reasons.length > 0 ? { partialReason: dedupeStrings(reasons).join(' | ') } : {}),
  };
}

function addCoverageEntry(
  coverage: CoverageData,
  status: 'skipped' | 'failed',
  chainId: number,
  skipReason: string,
): void {
  coverage.checks.push({
    checkId: 'crossChainDestination',
    checkName: 'Cross-chain destination simulation status',
    status,
    skipReason,
    chainId,
  });
  coverage.summary.total += 1;
  if (status === 'skipped') coverage.summary.skipped += 1;
  else coverage.summary.failed += 1;
}

export function mergeCoverageForChain(coverage: CoverageData, nextCoverage: CoverageData): void {
  coverage.checks.push(...nextCoverage.checks);
  coverage.summary.total += nextCoverage.summary.total;
  coverage.summary.ran += nextCoverage.summary.ran;
  coverage.summary.skipped += nextCoverage.summary.skipped;
  coverage.summary.failed += nextCoverage.summary.failed;
  coverage.summary.inferredSkips += nextCoverage.summary.inferredSkips;
}

export type ChainCheckRun = {
  results: AllCheckResults;
  diagnostics: ChainExecutionDiagnostics;
};

export type DestinationChecksProcessingResult = {
  destinationChecks: Record<number, AllCheckResults>;
  executionDiagnostics: Record<number, ChainExecutionDiagnostics>;
};

export async function runChecksForChainWithDiagnostics(
  proposal: ProposalEvent,
  sim: TenderlySimulation,
  deps: ProposalData,
  chainId: number,
  allL2Simulations?: SimulationResult['destinationSimulations'],
  checksOverride?: Record<string, ProposalCheck>,
): Promise<ChainCheckRun> {
  const results: AllCheckResults = {};
  const chainConfig = getChainConfig(chainId);

  const depsWithConfig = {
    ...deps,
    chainConfig,
  };

  const l2Simulations =
    chainId !== 1 && allL2Simulations
      ? allL2Simulations
          .filter((simulation): simulation is typeof simulation & { sim: TenderlySimulation } =>
            Boolean(simulation.sim),
          )
          .map((simulation) => ({ chainId: simulation.chainId, sim: simulation.sim }))
      : undefined;

  const diagnostics = createEmptyChainExecutionDiagnostics(chainId);
  const checksSource = checksOverride ?? ALL_CHECKS;

  for (const checkId of CHECK_EXECUTION_ORDER) {
    const check = checksSource[checkId];
    if (!check) continue;

    diagnostics.attemptedChecks.push(checkId);

    const execution = await runCheckWithIsolationAndRetry(
      checkId,
      check,
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    );

    results[checkId] = {
      name: check.name,
      result: execution.result,
    };

    if (execution.failedDiagnostic) {
      diagnostics.failedChecks.push(execution.failedDiagnostic);
    }
    if (execution.retryDiagnostic) {
      diagnostics.retries.push(execution.retryDiagnostic);
    }
  }

  if (diagnostics.failedChecks.length > 0) {
    diagnostics.partial = true;
    const failedCheckIds = diagnostics.failedChecks.map((entry) => entry.checkId);
    diagnostics.partialReason = `Partial check execution: ${failedCheckIds.join(', ')} failed to complete.`;
  }

  return { results, diagnostics };
}

export async function processDestinationChecks(
  proposal: ProposalEvent,
  deps: ProposalData,
  destinationSimulations: SimulationResult['destinationSimulations'],
): Promise<DestinationChecksProcessingResult> {
  const destinationChecks: Record<number, AllCheckResults> = {};
  const executionDiagnostics: Record<number, ChainExecutionDiagnostics> = {};

  for (const destinationSimulation of destinationSimulations ?? []) {
    const chainId = destinationSimulation.chainId;

    if (destinationSimulation.status !== 'success' || !destinationSimulation.sim) {
      continue;
    }

    const chainDiagnostics =
      executionDiagnostics[chainId] ?? createEmptyChainExecutionDiagnostics(chainId);

    if (!L2_CHECK_SUPPORTED_CHAIN_IDS.has(chainId)) {
      chainDiagnostics.partial = true;
      chainDiagnostics.partialReason = `Destination simulation succeeded but L2 checks are not supported for chain ${chainId}.`;
      executionDiagnostics[chainId] = chainDiagnostics;
      continue;
    }

    try {
      const l2Deps: ProposalData = {
        ...deps,
        publicClient: getClientForChain(chainId),
        chainConfig: getChainConfig(chainId),
      };

      const chainRun = await runChecksForChainWithDiagnostics(
        proposal,
        destinationSimulation.sim,
        l2Deps,
        chainId,
        destinationSimulations,
      );

      destinationChecks[chainId] = destinationChecks[chainId]
        ? mergeAllCheckResults(destinationChecks[chainId], chainRun.results)
        : chainRun.results;

      executionDiagnostics[chainId] = executionDiagnostics[chainId]
        ? mergeChainExecutionDiagnostics(executionDiagnostics[chainId], chainRun.diagnostics)
        : chainRun.diagnostics;
    } catch (error) {
      const reason = toErrorMessage(error);
      chainDiagnostics.partial = true;
      chainDiagnostics.partialReason = `Destination checks failed to start for chain ${chainId}: ${reason}`;
      executionDiagnostics[chainId] = chainDiagnostics;
      console.error(
        `[Checks][L2_CHECK_FAILURE] Failed to run destination checks for chain ${chainId}; continuing with partial report.`,
        error,
      );
    }
  }

  for (const destinationSimulation of destinationSimulations ?? []) {
    const chainId = destinationSimulation.chainId;
    if (destinationSimulation.status !== 'success') continue;

    const chainDiagnostics = executionDiagnostics[chainId];
    if (!chainDiagnostics) continue;

    if (chainDiagnostics.attemptedChecks.length === 0) {
      chainDiagnostics.partial = true;
      if (!chainDiagnostics.partialReason) {
        chainDiagnostics.partialReason =
          'Destination simulation succeeded but no destination checks were attempted.';
      }
    }
  }

  return {
    destinationChecks,
    executionDiagnostics,
  };
}

export function appendDestinationCoverageDiagnostics(
  coverage: CoverageData,
  destinationChecks: Record<number, AllCheckResults>,
  destinationSimulations: SimulationResult['destinationSimulations'],
  executionDiagnostics: Record<number, ChainExecutionDiagnostics>,
): void {
  for (const [chainIdStr, destinationResults] of Object.entries(destinationChecks)) {
    const chainId = Number(chainIdStr);
    const l2Coverage = buildCoverageFromResults(destinationResults, coverage.metadata, chainId);
    mergeCoverageForChain(coverage, l2Coverage);
  }

  const chainsWithDiagnosticEntry = new Set<number>();

  for (const [chainIdStr, chainDiagnostics] of Object.entries(executionDiagnostics)) {
    const chainId = Number(chainIdStr);
    if (chainId === 1 || !chainDiagnostics.partial) continue;

    const reason =
      chainDiagnostics.partialReason ??
      `Destination checks for chain ${chainId} are partial/inconclusive.`;
    addCoverageEntry(coverage, 'failed', chainId, reason);
    chainsWithDiagnosticEntry.add(chainId);
  }

  const coveredChainIds = new Set(Object.keys(destinationChecks).map((id) => Number(id)));
  const simulationsByChain = new Map<
    number,
    Array<NonNullable<SimulationResult['destinationSimulations']>[number]>
  >();

  for (const destinationSimulation of destinationSimulations ?? []) {
    const entries = simulationsByChain.get(destinationSimulation.chainId) ?? [];
    entries.push(destinationSimulation);
    simulationsByChain.set(destinationSimulation.chainId, entries);
  }

  for (const [chainId, chainSimulations] of simulationsByChain.entries()) {
    if (coveredChainIds.has(chainId) || chainsWithDiagnosticEntry.has(chainId)) continue;

    const failures = chainSimulations.filter((simulation) => simulation.status === 'failure');
    const skips = chainSimulations.filter((simulation) => simulation.status === 'skipped');
    const successes = chainSimulations.filter((simulation) => simulation.status === 'success');

    if (failures.length > 0) {
      const reasons = failures.map((simulation) => simulation.error).filter(Boolean);
      addCoverageEntry(
        coverage,
        'failed',
        chainId,
        reasons.length > 0 ? reasons.join(' | ') : 'Destination simulation failed.',
      );
      continue;
    }

    if (!L2_CHECK_SUPPORTED_CHAIN_IDS.has(chainId)) {
      addCoverageEntry(
        coverage,
        'skipped',
        chainId,
        `L2 checks are not supported for chain ${chainId}.`,
      );
      continue;
    }

    if (skips.length > 0) {
      const reasons = skips.map((simulation) => simulation.error).filter(Boolean);
      addCoverageEntry(
        coverage,
        'skipped',
        chainId,
        reasons.length > 0 ? reasons.join(' | ') : 'Destination simulation skipped.',
      );
      continue;
    }

    if (successes.length > 0) {
      addCoverageEntry(
        coverage,
        'failed',
        chainId,
        'Destination simulation succeeded but no L2 checks were recorded for this chain.',
      );
      continue;
    }

    addCoverageEntry(
      coverage,
      'skipped',
      chainId,
      'No destination simulation result was available for this chain.',
    );
  }

  if (Object.keys(executionDiagnostics).length > 0) {
    coverage.executionDiagnostics = executionDiagnostics;
  }
}

/**
 * Get git metadata for coverage tracking
 */
function getGitMetadata(): { commitHash: string; branch: string } {
  try {
    const commitHash = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    return { commitHash, branch };
  } catch {
    return { commitHash: 'unknown', branch: 'unknown' };
  }
}

/**
 * Get tool versions for coverage tracking
 */
function getToolVersions(): { solcVersion?: string; slitherVersion?: string } {
  let solcVersion: string | undefined;
  let slitherVersion: string | undefined;

  try {
    const solcOutput = execFileSync('solc', ['--version']).toString();
    solcVersion = solcOutput.match(/Version: ([\d.]+)/)?.[1];
  } catch {
    // solc not available
  }

  try {
    slitherVersion = execFileSync('slither', ['--version']).toString().trim();
  } catch {
    // slither not available
  }

  return { solcVersion, slitherVersion };
}

/**
 * Get runtime versions for coverage tracking
 */
function getRuntimeVersions(): {
  bunVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  runnerOs?: string;
} {
  let bunVersion: string | undefined;
  let nodeVersion: string | undefined = process.version;
  let pythonVersion: string | undefined;

  try {
    bunVersion = execFileSync('bun', ['--version']).toString().trim();
  } catch {
    // bun not available
  }

  try {
    nodeVersion = execFileSync('node', ['--version']).toString().trim();
  } catch {
    // node not available; keep process.version fallback
  }

  try {
    pythonVersion = execFileSync('python3', ['--version']).toString().trim();
  } catch {
    // python not available
  }

  return {
    bunVersion,
    nodeVersion,
    pythonVersion,
    runnerOs: process.env.RUNNER_OS ?? process.platform,
  };
}

/**
 * Build coverage metadata
 */
export function buildCoverageMetadata(): CoverageMetadata {
  const git = getGitMetadata();
  const tools = getToolVersions();
  const runtime = getRuntimeVersions();
  return {
    gitCommitHash: git.commitHash,
    gitBranch: git.branch,
    timestamp: new Date().toISOString(),
    solcVersion: tools.solcVersion,
    slitherVersion: tools.slitherVersion,
    bunVersion: runtime.bunVersion,
    nodeVersion: runtime.nodeVersion,
    pythonVersion: runtime.pythonVersion,
    runnerOs: runtime.runnerOs,
  };
}

/**
 * Build coverage data from check results
 */
export function buildCoverageFromResults(
  results: AllCheckResults,
  metadata: CoverageMetadata,
  chainId?: number,
): CoverageData {
  const checks: CheckCoverage[] = [];
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  let inferredSkips = 0;

  for (const [checkId, check] of Object.entries(results)) {
    const { name, result } = check;
    let status: 'ran' | 'skipped' | 'failed' = 'ran';
    let skipReason: string | undefined;
    let wasInferred = false;

    if (result.skipped) {
      // Explicit skip
      status = 'skipped';
      skipReason = result.skipped.reason;
      skipped++;
    } else if (result.errors.length > 0) {
      // Check failed
      status = 'failed';
      failed++;
    } else {
      // Apply heuristic fallback for non-updated checks
      const inferredSkip = inferSkipFromInfo(result.info);
      if (inferredSkip) {
        status = 'skipped';
        skipReason = inferredSkip;
        wasInferred = true;
        skipped++;
        inferredSkips++;
        console.log(`[Coverage] Inferred skip for ${checkId}: ${inferredSkip}`);
      } else {
        ran++;
      }
    }

    checks.push({
      checkId,
      checkName: name,
      status,
      skipReason,
      wasInferred,
      chainId,
    });
  }

  return {
    metadata,
    checks,
    summary: {
      total: checks.length,
      ran,
      skipped,
      failed,
      inferredSkips,
    },
  };
}

/**
 * Run checks for a specific chain simulation
 */
export async function runChecksForChain(
  proposal: ProposalEvent,
  sim: TenderlySimulation,
  deps: ProposalData,
  chainId: number,
  allL2Simulations?: SimulationResult['destinationSimulations'],
): Promise<AllCheckResults> {
  const { results } = await runChecksForChainWithDiagnostics(
    proposal,
    sim,
    deps,
    chainId,
    allL2Simulations,
  );
  return results;
}

/**
 * @notice Run checks for a specific proposal ID
 */
async function main() {
  // Validate inputs
  if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
  if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

  // Get governor type and contract
  const governorType = await inferGovernorType(GOVERNOR_ADDRESS);

  // Set the proposal ID to check - default to latest proposal if no argument provided
  let proposalId: bigint;
  if (process.argv[2]) {
    // If a proposal ID is provided, use it
    proposalId = BigInt(process.argv[2]);
  } else {
    // Get the latest proposal ID
    const latestBlock = await publicClient.getBlock();
    if (!latestBlock.number) throw new Error('Failed to get latest block number');

    const proposalIds = await getProposalIds(governorType, GOVERNOR_ADDRESS, latestBlock.number);
    if (proposalIds.length === 0) {
      throw new Error('No proposals found for this governor');
    }

    // Get the latest proposal ID (highest number)
    proposalId = proposalIds.reduce((latest: bigint, current: bigint) =>
      current > latest ? current : latest,
    );
    console.log(`No proposal ID provided, defaulting to latest proposal: ${proposalId}`);
  }
  const governor = getGovernor(governorType, GOVERNOR_ADDRESS);

  // Get proposal state to determine simulation type
  const state = await governor.read.state([proposalId]);
  const stateStr = String(state) as keyof typeof PROPOSAL_STATES;
  const isExecuted = PROPOSAL_STATES[stateStr] === 'Executed';
  const simType = isExecuted ? 'executed' : 'proposed';

  console.log(
    `Running checks for ${DAO_NAME} proposal ${proposalId} (${PROPOSAL_STATES[stateStr]})...`,
  );

  // Create simulation config
  const config: SimulationConfig = {
    type: simType,
    daoName: DAO_NAME,
    governorAddress: getAddress(GOVERNOR_ADDRESS),
    governorType,
    proposalId,
  };

  // Generate the proposal data and dependencies needed by checks
  const proposalData: ProposalData = {
    governor,
    timelock: await getTimelock(governorType, governor.address),
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: [], // Will be populated from simulation
    touchedContracts: [], // Will be populated from simulation
  };

  // Run source simulation
  const sourceResult = await simulate(config);

  // Handle cross-chain messages
  const finalResult = await handleCrossChainSimulations(sourceResult);

  const finalDeps = finalResult.deps || proposalData;

  // Run checks for source chain
  const sourceRun = await runChecksForChainWithDiagnostics(
    finalResult.proposal,
    finalResult.sim,
    finalDeps,
    1, // Mainnet chain ID
    finalResult.destinationSimulations,
  );
  const sourceChecks = sourceRun.results;

  // Run checks for destination chains if any
  const { destinationChecks, executionDiagnostics: destinationExecutionDiagnostics } =
    await processDestinationChecks(
      finalResult.proposal,
      finalDeps,
      finalResult.destinationSimulations,
    );

  // Fetch full block data for start and end blocks
  const [startBlock, endBlock] = await Promise.all([
    finalResult.proposal.startBlock <= (finalResult.latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: finalResult.proposal.startBlock })
      : null,
    finalResult.proposal.endBlock <= (finalResult.latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: finalResult.proposal.endBlock })
      : null,
  ]);

  // Construct the blocks object
  const blocks = {
    current: finalResult.latestBlock,
    start: startBlock,
    end: endBlock,
  };

  // Build coverage data - include mainnet (chainId 1) and all L2 chains
  const coverageMetadata = buildCoverageMetadata();
  const coverage = buildCoverageFromResults(sourceChecks, coverageMetadata, 1);

  appendDestinationCoverageDiagnostics(
    coverage,
    destinationChecks,
    finalResult.destinationSimulations,
    {
      1: sourceRun.diagnostics,
      ...destinationExecutionDiagnostics,
    },
  );

  // Log coverage summary
  console.log(
    `[Coverage] Total: ${coverage.summary.total}, Ran: ${coverage.summary.ran}, Skipped: ${coverage.summary.skipped}, Failed: ${coverage.summary.failed}`,
  );
  if (coverage.summary.inferredSkips > 0) {
    console.log(
      `[Coverage] Warning: ${coverage.summary.inferredSkips} skips were inferred via heuristic`,
    );
  }

  // Generate reports
  const dir = `./${REPORTS_OUTPUT_DIRECTORY}/${config.daoName}/${config.governorAddress}`;
  await generateAndSaveReports({
    governorType,
    blocks,
    proposal: finalResult.proposal,
    checks: sourceChecks,
    outputDir: dir,
    governorAddress: config.governorAddress,
    destinationSimulations: finalResult.destinationSimulations,
    destinationChecks,
    executor: finalResult.executor,
    proposalCreatedBlock: finalResult.proposalCreatedBlock,
    proposalExecutedBlock: finalResult.proposalExecutedBlock,
    chainId: finalDeps.chainConfig.chainId,
    simulationType: simType,
    simulation: finalResult.sim,
    coverage,
    daoName: config.daoName,
    contracts: finalResult.sim?.contracts,
  });
}

// Only run main if this file is executed directly, not when imported
if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
