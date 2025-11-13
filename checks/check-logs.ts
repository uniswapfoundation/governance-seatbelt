import { getAddress } from 'viem';
import type { Log, ProposalCheck } from '../types';
import { getContractName } from '../utils/clients/tenderly';

/**
 * Reports all emitted events from the proposal
 */
export const checkLogs: ProposalCheck = {
  name: 'Reports all events emitted from the proposal',
  async checkProposal(_, sim, deps, l2Simulations) {
    const info: string[] = [];

    // For L2 checks, we want to process all L2 simulations, not just the current one
    const simulations =
      l2Simulations && deps.chainConfig?.chainId !== 1
        ? l2Simulations.filter((s) => s.sim).map((s) => s.sim!)
        : [sim];

    // Process all logs from all relevant simulations
    const allEvents: Record<string, Log[]> = {};

    for (const currentSim of simulations) {
      const events = currentSim.transaction.transaction_info.logs?.reduce(
        (logs, log) => {
          const addr = getAddress(log.raw.address);
          // Check if this is a log that should be filtered out
          const isGovernor = getAddress(addr) === deps.governor.address;
          const isTimelock = getAddress(addr) === deps.timelock.address;
          const shouldSkipLog =
            (isGovernor && log.name === 'ProposalExecuted') ||
            (isTimelock && log.name === 'ExecuteTransaction' && log.inputs.length === 0);
          // Skip logs as required and add the rest to our logs object
          if (shouldSkipLog) return logs;
          if (!logs[addr]) logs[addr] = [];
          logs[addr].push(log);
          return logs;
        },
        {} as Record<string, Log[]>,
      );

      // Merge events from this simulation into allEvents
      if (events) {
        for (const [address, logs] of Object.entries(events)) {
          if (!allEvents[address]) allEvents[address] = [];
          allEvents[address].push(...logs);
        }
      }
    }

    // Return if no events to show
    if (!Object.keys(allEvents).length)
      return { info: ['No events emitted'], warnings: [], errors: [] };

    // Parse each event
    for (const [address, logs] of Object.entries(allEvents)) {
      // Use contracts array to get contract name of address
      const contract = sim.contracts.find((c) => c.address === address);
      info.push(await getContractName(contract, deps.chainConfig?.chainId));

      // Format log data for report
      for (const log of logs) {
        if (log.name) {
          // Log is decoded, format data as: VotingDelaySet(oldVotingDelay: value, newVotingDelay: value)
          const parsedInputs = log.inputs.map((i) => `${i.soltype!.name}: ${i.value}`).join(', ');
          info.push(`    \`${log.name}(${parsedInputs})\``);
        } else {
          // Log is not decoded, report the raw data
          // TODO find a transaction with undecoded logs to know how topics/data are formatted in simulation response
          info.push(`    Undecoded log: \`${JSON.stringify(log)}\``);
        }
      }
    }

    return { info, warnings: [], errors: [] };
  },
};
