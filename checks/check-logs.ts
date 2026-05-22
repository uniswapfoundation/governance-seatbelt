import { type Abi, decodeEventLog, getAddress } from 'viem';
import type { Log, ProposalCheck, TenderlyContract } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { getContractName } from '../utils/clients/tenderly';

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[a-fA-F0-9]*$/.test(value);
}

function eventTopics(topics: unknown[]): [`0x${string}`, ...`0x${string}`[]] | null {
  const [first, ...rest] = topics;
  if (!isHex(first) || !rest.every(isHex)) return null;
  return [first, ...rest];
}

function formatTenderlyDecodedLog(log: Log): string | null {
  if (!log.name || !Array.isArray(log.inputs)) return null;

  const parsedInputs = log.inputs
    .map((input, index) => `${input.soltype?.name || `arg${index}`}: ${input.value}`)
    .join(', ');
  return `${log.name}(${parsedInputs})`;
}

function formatDecodedArgs(args: unknown): string {
  if (Array.isArray(args)) {
    return args.map((value, index) => `arg${index}: ${String(value)}`).join(', ');
  }

  if (args && typeof args === 'object') {
    return Object.entries(args)
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join(', ');
  }

  return '';
}

function formatAbiDecodedLog(log: Log, abi: Abi | null): string | null {
  const topics = eventTopics(log.raw.topics);
  if (!abi || !topics || !isHex(log.raw.data)) return null;

  try {
    const decoded = decodeEventLog({
      abi,
      data: log.raw.data,
      topics,
    });

    return `${decoded.eventName}(${formatDecodedArgs(decoded.args)})`;
  } catch {
    return null;
  }
}

function formatRawLog(log: Log): string {
  const fields = [
    ...log.raw.topics.map((topic, index) => `topic${index}: ${topic}`),
    `data: ${log.raw.data}`,
  ];

  return `RawLog(${fields.join(', ')})`;
}

function formatLog(log: Log, abi: Abi | null): string {
  return formatTenderlyDecodedLog(log) ?? formatAbiDecodedLog(log, abi) ?? formatRawLog(log);
}

function getTenderlyAbi(contract: TenderlyContract | undefined): Abi | null {
  return contract?.data?.abi?.length ? (contract.data.abi as Abi) : null;
}

async function getLogDecodingAbi(
  contract: TenderlyContract | undefined,
  address: string,
  chainId: number | undefined,
): Promise<Abi | null> {
  const tenderlyAbi = getTenderlyAbi(contract);
  if (tenderlyAbi) return tenderlyAbi;
  if (!chainId) return null;
  return BlockExplorerFactory.fetchContractAbi(address, chainId);
}

/**
 * Reports all emitted events from the proposal
 */
export const checkLogs: ProposalCheck = {
  name: 'Reports all events emitted from the proposal',
  async checkProposal(_, sim, deps, _l2Simulations) {
    const info: string[] = [];
    const allEvents: Record<string, Log[]> = {};

    for (const log of sim.transaction.transaction_info.logs ?? []) {
      const addr = getAddress(log.raw.address);
      const isGovernor = getAddress(addr) === deps.governor.address;
      const isTimelock = getAddress(addr) === deps.timelock.address;
      const shouldSkipLog =
        (isGovernor && log.name === 'ProposalExecuted') ||
        (isTimelock && log.name === 'ExecuteTransaction' && log.inputs.length === 0);
      if (shouldSkipLog) continue;
      if (!allEvents[addr]) allEvents[addr] = [];
      allEvents[addr].push(log);
    }

    if (!Object.keys(allEvents).length)
      return { info: ['No events emitted'], warnings: [], errors: [] };

    for (const [address, logs] of Object.entries(allEvents)) {
      const contract = sim.contracts.find((c) => getAddress(c.address) === address);
      info.push(await getContractName(contract ?? { address }, deps.chainConfig?.chainId));
      const abi = logs.some((log) => !formatTenderlyDecodedLog(log))
        ? await getLogDecodingAbi(contract, address, deps.chainConfig?.chainId)
        : null;

      for (const log of logs) {
        info.push(`    \`${formatLog(log, abi)}\``);
      }
    }

    return { info, warnings: [], errors: [] };
  },
};
