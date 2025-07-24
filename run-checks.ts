/**
 * @notice Script to run checks for a specific proposal ID
 */

import { getAddress } from 'viem';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type {
  AllCheckResults,
  ProposalData,
  ProposalEvent,
  SimulationConfig,
  SimulationResult,
  TenderlySimulation,
} from './types.d';
import { getChainConfig, getClientForChain, publicClient } from './utils/clients/client';
import { handleCrossChainSimulations, simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, REPORTS_BRANCH } from './utils/constants';
import {
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

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
  const results: AllCheckResults = {};
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

  // Chain-agnostic checks
  results.checkStateChanges = {
    name: ALL_CHECKS.checkStateChanges.name,
    result: await ALL_CHECKS.checkStateChanges.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkLogs = {
    name: ALL_CHECKS.checkLogs.name,
    result: await ALL_CHECKS.checkLogs.checkProposal(proposal, sim, depsWithConfig, l2Simulations),
  };
  results.checkEthBalanceChanges = {
    name: ALL_CHECKS.checkEthBalanceChanges.name,
    result: await ALL_CHECKS.checkEthBalanceChanges.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkDecodeCalldata = {
    name: ALL_CHECKS.checkDecodeCalldata.name,
    result: await ALL_CHECKS.checkDecodeCalldata.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };

  // Chain-specific checks
  results.checkTargetsVerifiedEtherscan = {
    name: ALL_CHECKS.checkTargetsVerifiedEtherscan.name,
    result: await ALL_CHECKS.checkTargetsVerifiedEtherscan.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkTouchedContractsVerifiedEtherscan = {
    name: ALL_CHECKS.checkTouchedContractsVerifiedEtherscan.name,
    result: await ALL_CHECKS.checkTouchedContractsVerifiedEtherscan.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkTargetsNoSelfdestruct = {
    name: ALL_CHECKS.checkTargetsNoSelfdestruct.name,
    result: await ALL_CHECKS.checkTargetsNoSelfdestruct.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkTouchedContractsNoSelfdestruct = {
    name: ALL_CHECKS.checkTouchedContractsNoSelfdestruct.name,
    result: await ALL_CHECKS.checkTouchedContractsNoSelfdestruct.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };
  results.checkSolc = {
    name: ALL_CHECKS.checkSolc.name,
    result: await ALL_CHECKS.checkSolc.checkProposal(proposal, sim, depsWithConfig, l2Simulations),
  };
  results.checkSlither = {
    name: ALL_CHECKS.checkSlither.name,
    result: await ALL_CHECKS.checkSlither.checkProposal(
      proposal,
      sim,
      depsWithConfig,
      l2Simulations,
    ),
  };

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

  // Generate reports
  const dir = `./${REPORTS_BRANCH}/${config.daoName}/${config.governorAddress}`;
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
