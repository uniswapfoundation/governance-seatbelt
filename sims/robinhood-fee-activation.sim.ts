import { encodeFunctionData, getAddress, parseAbi, parseEther, parseGwei } from 'viem';
import type { SimulationConfigNew } from '../types';
import ArbitrumDelayedInboxAbi from '../utils/abis/ArbitrumDelayedInboxAbi.json' assert {
  type: 'json',
};

const RH_INBOX = getAddress('0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D');
const ALIASED_TIMELOCK = getAddress('0x2BAD8182C09F50c8318d769245beA52C32BE46CD');
const V2_FACTORY = getAddress('0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f');
const V3_FACTORY = getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa');
const TOKEN_JAR = getAddress('0x0e197b5b7c9eeeea25e7c8378516d68aa0df7d92');
const V3_OPEN_FEE_ADAPTER = getAddress('0x59f4888f34c5ba04086b6ed2c61044d123168a4f');

const GAS_LIMIT = 200_000n;
const MAX_FEE_PER_GAS = parseGwei('0.1');
const MAX_SUBMISSION_COST = parseEther('0.01');
const RETRYABLE_TICKET_VALUE = MAX_SUBMISSION_COST + GAS_LIMIT * MAX_FEE_PER_GAS;

const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)']);
const V3_FACTORY_ABI = parseAbi(['function setOwner(address)']);

function createRetryableTicket(target: `0x${string}`, data: `0x${string}`) {
  return {
    target: RH_INBOX,
    value: RETRYABLE_TICKET_VALUE,
    signature: '',
    calldata: encodeFunctionData({
      abi: ArbitrumDelayedInboxAbi,
      functionName: 'createRetryableTicket',
      args: [
        target,
        0n,
        MAX_SUBMISSION_COST,
        ALIASED_TIMELOCK,
        ALIASED_TIMELOCK,
        GAS_LIMIT,
        MAX_FEE_PER_GAS,
        data,
      ],
    }),
  };
}

const calls = [
  createRetryableTicket(
    V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [TOKEN_JAR],
    }),
  ),
  createRetryableTicket(
    V3_FACTORY,
    encodeFunctionData({
      abi: V3_FACTORY_ABI,
      functionName: 'setOwner',
      args: [V3_OPEN_FEE_ADAPTER],
    }),
  ),
];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
  governorType: 'bravo',
  targets: calls.map((call) => call.target),
  values: calls.map((call) => call.value),
  signatures: calls.map((call) => call.signature),
  calldatas: calls.map((call) => call.calldata),
  description: `# Protocol Fee Expansion: Robinhood Chain

Creates two retryable tickets through Robinhood Chain's Ethereum Inbox. The destination calls set the Uniswap v2 fee collector to TokenJar and transfer Uniswap v3 factory ownership to V3OpenFeeAdapter.`,
};
