/**
 * @notice Script to run checks for a specific proposal ID
 */

import { execFileSync } from 'node:child_process';
import { getAddress } from 'viem';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type {
  AllCheckResults,
  CheckCoverage,
  CoverageData,
  CoverageMetadata,
  Message,
  ProposalData,
  ProposalEvent,
  SimulationConfig,
  SimulationResult,
  TenderlySimulation,
} from './types.d';
import { runChecksWithTimeouts } from './utils/check-runner';
import {
  CHECKS_GLOBAL_TIMEOUT_MS,
  CHECK_TIMEOUT_MS,
  CHECK_TIMEOUT_OVERRIDES_MS,
} from './utils/check-timeout-constants';
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

/**
 * Infer if a check was skipped based on info messages (heuristic fallback)
 */
function inferSkipFromInfo(info: Message[]): string | null {
  for (const msg of info) {
    for (const pattern of SKIP_PATTERNS) {
      if (pattern.test(msg)) {
        return msg;
      }
    }
  }
  return null;
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
 * Build coverage metadata
 */
export function buildCoverageMetadata(): CoverageMetadata {
  const git = getGitMetadata();
  const tools = getToolVersions();
  return {
    gitCommitHash: git.commitHash,
    gitBranch: git.branch,
    timestamp: new Date().toISOString(),
    solcVersion: tools.solcVersion,
    slitherVersion: tools.slitherVersion,
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
  const chainConfig = getChainConfig(chainId);

  // Run all checks with chain-specific configuration
  const depsWithConfig = {
    ...deps,
    chainConfig,
  };

  // For L2 checks, pass all L2 simulations
  const l2Simulations =
    chainId !== 1 && allL2Simulations
      ? allL2Simulations.filter((s) => s.sim).map((s) => ({ chainId: s.chainId, sim: s.sim! }))
      : undefined;

  return await runChecksWithTimeouts(ALL_CHECKS, proposal, sim, depsWithConfig, l2Simulations, {
    globalTimeoutMs: CHECKS_GLOBAL_TIMEOUT_MS,
    defaultPerCheckTimeoutMs: CHECK_TIMEOUT_MS,
    perCheckTimeoutOverridesMs: CHECK_TIMEOUT_OVERRIDES_MS,
  });
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

  // Run checks for source chain
  const sourceChecks = await runChecksForChain(
    finalResult.proposal,
    finalResult.sim,
    proposalData,
    1, // Mainnet chain ID
    finalResult.destinationSimulations,
  );

  // Run checks for destination chains if any
  const destinationChecks: Record<number, AllCheckResults> = {};
  if (finalResult.destinationSimulations) {
    for (const destSim of finalResult.destinationSimulations) {
      if (destSim.sim) {
        const l2Deps: ProposalData = {
          ...proposalData,
          publicClient: getClientForChain(destSim.chainId),
          chainConfig: getChainConfig(destSim.chainId),
        };
        destinationChecks[destSim.chainId] = await runChecksForChain(
          finalResult.proposal,
          destSim.sim,
          l2Deps,
          destSim.chainId,
          finalResult.destinationSimulations,
        );
      }
    }
  }

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

  // Merge L2 check coverage into the main coverage
  for (const [chainIdStr, destResults] of Object.entries(destinationChecks)) {
    const chainId = Number(chainIdStr);
    const l2Coverage = buildCoverageFromResults(destResults, coverageMetadata, chainId);

    // Append L2 checks to the main coverage
    coverage.checks.push(...l2Coverage.checks);

    // Aggregate summary totals
    coverage.summary.total += l2Coverage.summary.total;
    coverage.summary.ran += l2Coverage.summary.ran;
    coverage.summary.skipped += l2Coverage.summary.skipped;
    coverage.summary.failed += l2Coverage.summary.failed;
    coverage.summary.inferredSkips += l2Coverage.summary.inferredSkips;
  }

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
    chainId: proposalData.chainConfig.chainId,
    simulationType: simType,
    simulation: finalResult.sim,
    coverage,
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
