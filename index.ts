/**
 * @notice Entry point for executing a single proposal against a forked mainnet
 */

import { existsSync } from 'node:fs';
import { getAddress } from 'viem';
import { generateAndSaveReports } from './presentation/report';
import { runChecksForChain } from './run-checks';
import type {
  AllCheckResults,
  GovernorType,
  ProposalData,
  SimulationConfig,
  SimulationConfigBase,
  SimulationData,
  SimulationResult,
} from './types';
import { cacheProposal, getCachedProposal, needsSimulation } from './utils/cache/proposalCache';
import { getChainConfig, publicClient } from './utils/clients/client';
import { handleCrossChainSimulations, simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, REPORTS_OUTPUT_DIRECTORY, SIM_NAME } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * @notice Run the complete simulation pipeline (source + cross-chain)
 */
async function runSimulationPipeline(config: SimulationConfig): Promise<SimulationResult> {
  const sourceResult = await simulate(config);
  return await handleCrossChainSimulations(sourceResult);
}

/**
 * @notice Fetch block data for proposal start and end blocks
 */
async function fetchBlockData(
  proposal: SimulationResult['proposal'],
  latestBlock: SimulationResult['latestBlock'],
) {
  const [startBlock, endBlock] = await Promise.all([
    proposal.startBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.startBlock })
      : null,
    proposal.endBlock <= (latestBlock.number ?? 0n)
      ? publicClient.getBlock({ blockNumber: proposal.endBlock })
      : null,
  ]);

  return {
    current: latestBlock,
    start: startBlock,
    end: endBlock,
  };
}

/**
 * @notice Process cross-chain destination simulations and run checks
 */
async function processDestinationSimulations(
  proposal: SimulationResult['proposal'],
  deps: ProposalData,
  destinationSimulations: SimulationResult['destinationSimulations'],
) {
  const destinationChecks: Record<number, AllCheckResults> = {};

  if (destinationSimulations) {
    for (const destSim of destinationSimulations) {
      if (destSim.sim) {
        const l2Deps = {
          ...deps,
          chainConfig: getChainConfig(destSim.chainId),
        };
        destinationChecks[destSim.chainId] = await runChecksForChain(
          proposal,
          destSim.sim,
          l2Deps,
          destSim.chainId,
          destinationSimulations,
        );
      }
    }
  }

  return destinationChecks;
}

/**
 * @notice Process a single simulation with checks and reporting
 */
async function processSimulation(
  config: SimulationConfig,
  governorType: GovernorType,
  fallbackDeps: ProposalData,
  simulationResult: SimulationResult,
  proposalId: string,
  proposalState: string,
  shouldCache = true,
) {
  const {
    sim,
    proposal,
    latestBlock,
    proposalCreatedBlock,
    proposalExecutedBlock,
    executor,
    deps,
    destinationSimulations,
  } = simulationResult;

  // Use deps from simulationResult if available, otherwise use fallbackDeps
  const finalDeps = deps || fallbackDeps;

  // Note: deps from simulate() already contains targets and touchedContracts
  // The fallbackDeps parameter is only used if simulationResult.deps is undefined,
  // which shouldn't happen in normal operation

  // Run checks for mainnet using runChecksForChain for consistency
  console.log(`  Running checks for proposal ${proposalId}...`);
  const mainnetResults = await runChecksForChain(
    proposal,
    sim,
    finalDeps,
    1, // Mainnet chain ID
    destinationSimulations,
  );

  // Fetch block data
  const blocks = await fetchBlockData(proposal, latestBlock);

  // Process destination simulations and run checks
  const destinationChecks = await processDestinationSimulations(
    proposal,
    finalDeps,
    destinationSimulations,
  );

  // Generate reports
  const dir = `./${REPORTS_OUTPUT_DIRECTORY}/${config.daoName}/${config.governorAddress}`;
  await generateAndSaveReports({
    governorType,
    blocks,
    proposal,
    checks: mainnetResults,
    outputDir: dir,
    governorAddress: config.governorAddress,
    destinationSimulations,
    destinationChecks,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
  });

  // Prepare simulation data
  const simulationData: SimulationData = {
    sim,
    proposal,
    latestBlock,
    config,
    deps: finalDeps,
    proposalCreatedBlock,
    proposalExecutedBlock,
    executor,
  };

  // Cache results if requested
  if (shouldCache) {
    await cacheProposal(
      config.daoName,
      config.governorAddress,
      proposal.id.toString(),
      proposalState,
      simulationData,
    );
  }

  return simulationData;
}

/**
 * @notice Simulate governance proposals and run proposal checks against them
 */
async function main() {
  // --- Run simulations ---
  // Prepare array to store all simulation outputs
  const simOutputs: SimulationData[] = [];

  let governorType: GovernorType;

  // Determine if we are running a specific simulation or all on-chain proposals for a specified governor.
  if (SIM_NAME) {
    // If a SIM_NAME is provided, we run that simulation
    const configPath = `./sims/${SIM_NAME}.sim.ts`;
    if (!existsSync(configPath)) {
      throw new Error(`Simulation config file not found for '${SIM_NAME}' at path: ${configPath}`);
    }
    const config: SimulationConfig = await import(configPath).then((d) => d.config);

    governorType = await inferGovernorType(config.governorAddress);

    // Run simulation pipeline (source + cross-chain)
    console.log(`[Index] Simulating source chain for ${SIM_NAME}...`);
    const finalResult = await runSimulationPipeline(config);
    console.log(`[Index] Cross-chain handling complete for ${SIM_NAME}.`);

    const { sim, proposal, deps } = finalResult;

    // Check if source simulation itself failed
    if (!sim.transaction.status) {
      console.error(
        `[Index][FAILURE] Source simulation failed for ${SIM_NAME}. Proceeding to checks/reporting anyway.`,
      );
    }
    // Log if destination simulation failed
    if (finalResult.crossChainFailure) {
      console.error(`[Index][FAILURE] One or more destination simulations failed for ${SIM_NAME}.`);
    }

    // 3. Process simulation (checks, reports, etc.)
    console.log(`[Index] Processing ${SIM_NAME} simulation...`);

    await processSimulation(
      config,
      governorType,
      deps, // Use deps from finalResult
      finalResult,
      proposal.id.toString(),
      'Custom', // State for custom simulations
      false, // Don't cache custom simulations
    );

    console.log(`[Index] Reports saved for ${SIM_NAME}.`);
  } else {
    // If no SIM_NAME is provided, we get proposals to simulate from the chain
    if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
    if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

    const latestBlock = await publicClient.getBlock();
    if (!latestBlock.number) throw new Error('Failed to get latest block number');

    // Fetch all proposal IDs
    governorType = await inferGovernorType(GOVERNOR_ADDRESS);
    const proposalIds = await getProposalIds(governorType, GOVERNOR_ADDRESS, latestBlock.number);

    const states = await Promise.all(
      proposalIds.map((id) => getGovernor(governorType, GOVERNOR_ADDRESS!).read.state([id])),
    );
    const simProposals: { id: bigint; simType: SimulationConfigBase['type']; state: string }[] =
      proposalIds.map((id, i) => {
        const stateNum = String(states[i]) as keyof typeof PROPOSAL_STATES;
        const stateStr = PROPOSAL_STATES[stateNum] || 'Unknown';
        const isExecuted = stateStr === 'Executed';
        return {
          id,
          simType: isExecuted ? 'executed' : 'proposed',
          state: stateStr,
        };
      });

    // If we aren't simulating all proposals, filter down to just the active ones. For now we
    // assume we're simulating all by default
    const proposalsToSimulate: typeof simProposals = [];
    const cachedProposals: typeof simProposals = [];

    for (const simProposal of simProposals) {
      const needsSim = needsSimulation({
        daoName: DAO_NAME!,
        governorAddress: GOVERNOR_ADDRESS!,
        proposalId: simProposal.id.toString(),
        currentState: simProposal.state,
      });

      if (needsSim) {
        proposalsToSimulate.push(simProposal);
      } else {
        cachedProposals.push(simProposal);
      }
    }

    // Load cached proposals
    for (const cachedProposal of cachedProposals) {
      console.log(
        `Using cached simulation and reports for ${DAO_NAME} proposal ${cachedProposal.id}...`,
      );
      const cachedData = getCachedProposal(
        DAO_NAME,
        GOVERNOR_ADDRESS,
        cachedProposal.id.toString(),
      );

      if (cachedData) {
        const reportPath = `./${REPORTS_OUTPUT_DIRECTORY}/${DAO_NAME}/${GOVERNOR_ADDRESS}/${cachedProposal.id}.md`;
        if (existsSync(reportPath)) {
          console.log(`  Using cached report for proposal ${cachedProposal.id}`);
        } else {
          console.log(
            `  Report missing for cached proposal ${cachedProposal.id}, skipping for now.`,
          );
        }
        simOutputs.push(cachedData);
      }
    }

    // Simulate proposals that need simulation
    const numProposalsToSimulate = proposalsToSimulate.length;
    if (numProposalsToSimulate > 0) {
      console.log(
        `Simulating ${numProposalsToSimulate} ${DAO_NAME} proposals: IDs of ${proposalsToSimulate
          .map((sim) => formatProposalId(governorType, sim.id))
          .join(', ')}`,
      );

      // Generate the proposal data and dependencies needed by checks
      const proposalData: ProposalData = {
        governor: getGovernor(governorType, GOVERNOR_ADDRESS),
        timelock: await getTimelock(governorType, GOVERNOR_ADDRESS),
        publicClient,
        chainConfig: getChainConfig(1), // Mainnet chain config
        targets: [], // Will be populated from simulation
        touchedContracts: [], // Will be populated from simulation
      };

      for (const simProposal of proposalsToSimulate) {
        if (simProposal.simType === 'new')
          throw new Error('Simulation type "new" is not supported in this branch');
        // Determine if this proposal is already `executed` or currently in-progress (`proposed`)
        console.log(`  Simulating ${DAO_NAME} proposal ${simProposal.id}...`);
        const config: SimulationConfig = {
          type: simProposal.simType,
          daoName: DAO_NAME,
          governorAddress: getAddress(GOVERNOR_ADDRESS),
          governorType,
          proposalId: simProposal.id,
        };

        // Run simulation pipeline (source + cross-chain)
        console.log(`  Handling cross-chain messages for proposal ${simProposal.id}...`);
        const finalResult = await runSimulationPipeline(config);

        // Check if simulations failed
        if (!finalResult.sim.transaction.status) {
          console.error(
            `  [FAILURE] Source simulation failed for proposal ${simProposal.id}. Proceeding to checks/reporting anyway.`,
          );
        }
        if (finalResult.crossChainFailure) {
          console.error(
            `  [FAILURE] One or more destination simulations failed for proposal ${simProposal.id}.`,
          );
        }

        const simulationData = await processSimulation(
          config,
          governorType,
          proposalData,
          finalResult,
          simProposal.id.toString(),
          simProposal.state,
        );

        simOutputs.push(simulationData);
        console.log('    done');
      }
    } else {
      console.log(`No new proposals to simulate for ${DAO_NAME}`);
    }
  }

  // Remove the separate check and report generation loop since we now do it inline
  console.log('All done!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
