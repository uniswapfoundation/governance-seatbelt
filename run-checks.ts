/**
 * @notice Script to run checks for a specific proposal ID
 */

import { getAddress } from 'viem';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type { AllCheckResults, ProposalData, SimulationConfig, SimulationResult } from './types.d';
import { publicClient } from './utils/clients/client';
import { handleCrossChainSimulations, simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * @notice Run checks for a specific proposal ID
 */
async function main() {
  // Validate inputs
  if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
  if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

  // Set the proposal ID to check
  const proposalId = process.argv[2] ? BigInt(process.argv[2]) : BigInt(81); // Default to 81 if no argument provided

  // Get governor type and contract
  const governorType = await inferGovernorType(GOVERNOR_ADDRESS);
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
  };

  let sourceResult: SimulationResult | null = null;

  if (config.type === 'new') {
    console.log(`[Simulate] Running fresh source simulation (type: ${config.type})...`);
    const freshResult = await simulate(config);
    sourceResult = freshResult;
  } else {
    console.log('Simulating proposal (multi-chain aware)...');
    const simResult = await simulate(config);
    console.log('Simulation attempt complete.');
    sourceResult = simResult;
  }

  if (!sourceResult) {
    throw new Error('Failed to obtain source simulation result.');
  }

  // --- Cross-Chain Handling ---
  console.log('[Main] Handling potential cross-chain messages...');
  const finalResult = await handleCrossChainSimulations(sourceResult);
  console.log('[Main] Cross-chain handling complete.');

  // --- Checks and Reporting ---

  // Check for simulation failures (based on finalResult)
  let overallSimulationSuccess = true;
  if (!finalResult.sim.transaction.status) {
    const failureReason = 'Source chain simulation failed.';
    console.error(`[FAILURE] ${failureReason}`);
    overallSimulationSuccess = false;
  }
  if (finalResult.crossChainFailure) {
    const failureReason = 'One or more destination chain simulations failed.';
    console.error(`[FAILURE] ${failureReason}`);
    overallSimulationSuccess = false;
  }

  if (overallSimulationSuccess) {
    console.log('Simulation successful on all relevant chains.');
  }

  const { sim, proposal, latestBlock, deps: _deps, destinationSimulations } = finalResult;

  // Run checks
  console.log('Running checks...');
  const checkResults: AllCheckResults = Object.fromEntries(
    await Promise.all(
      Object.keys(ALL_CHECKS).map(async (checkId) => [
        checkId,
        {
          name: ALL_CHECKS[checkId].name,
          result: await ALL_CHECKS[checkId].checkProposal(proposal, sim, proposalData),
        },
      ]),
    ),
  );

  // Generate markdown report
  console.log('Generating report...');
  const [startBlock, endBlock] = await Promise.all([
    proposal.startBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.startBlock })
      : null,
    proposal.endBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.endBlock })
      : null,
  ]);

  // Save markdown report to a file
  const dir = `./reports/${config.daoName}/${config.governorAddress}`;
  await generateAndSaveReports(
    governorType,
    { start: startBlock, end: endBlock, current: latestBlock },
    proposal,
    checkResults,
    dir,
    destinationSimulations,
  );

  console.log(`Done! Report saved to ${dir}/${formatProposalId(governorType, proposalId)}.md`);
}

// Run the script
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
