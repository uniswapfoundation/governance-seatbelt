import {
  type Address,
  type Hex,
  decodeFunctionData,
  getAddress,
  hexToBigInt,
  toFunctionSelector,
  toHex,
} from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { CrossChainExecutionJob } from '../../types.d';
// Assuming ABI is available, similar to sims/arb-grant.sim.ts
import ArbitrumDelayedInboxAbi from '../abis/ArbitrumDelayedInboxAbi.json' assert { type: 'json' };

const ARBITRUM_INBOX_LANES = [
  {
    inboxAddress: getAddress('0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f'),
    destinationChainId: 42_161,
  },
  {
    inboxAddress: getAddress('0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D'),
    destinationChainId: 4_663,
  },
] as const;
const ARBITRUM_CHAIN_ID_BY_INBOX = new Map(
  ARBITRUM_INBOX_LANES.map((lane) => [lane.inboxAddress.toLowerCase(), lane.destinationChainId]),
);

export function getArbitrumDestinationChainId(inboxAddress: string): number | undefined {
  return ARBITRUM_CHAIN_ID_BY_INBOX.get(inboxAddress.toLowerCase());
}
const ARB_ALIAS_OFFSET = BigInt('0x1111000000000000000000000000000000001111');
const ARBITRUM_HANDLED_SELECTORS = new Set([
  toFunctionSelector(
    'function createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function createRetryableTicketNoRefundAliasRewrite(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function unsafeCreateRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function uniswapCreateRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendL1FundedContractTransaction(uint256,uint256,address,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendL1FundedUnsignedTransaction(uint256,uint256,address,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendL1FundedUnsignedTransactionToFork(uint256,uint256,address,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendContractTransaction(uint256,uint256,address,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendUnsignedTransaction(uint256,uint256,address,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector(
    'function sendUnsignedTransactionToFork(uint256,uint256,address,uint256,bytes)',
  ).toLowerCase(),
  toFunctionSelector('function sendL2Message(bytes)').toLowerCase(),
  toFunctionSelector('function sendL2MessageFromOrigin(bytes)').toLowerCase(),
]);

/**
 * Calculates the L2 alias for a given L1 address.
 * L2 Alias = L1 Address + 0x1111000000000000000000000000000000001111
 */
function calculateL2Alias(l1Address: Address): Address {
  const l1AddressBigInt = hexToBigInt(l1Address);
  const l2AliasBigInt = l1AddressBigInt + ARB_ALIAS_OFFSET;
  // Use toHex for BigInt conversion, ensure size for padding
  return getAddress(toHex(l2AliasBigInt, { size: 20 }));
}

/**
 * Recursively searches the call trace for calls to the Arbitrum Delayed Inbox.
 */
function findArbitrumInboxCalls(
  call: CallTrace,
): Array<{ call: CallTrace; destinationChainId: number }> {
  let inboxCalls: Array<{ call: CallTrace; destinationChainId: number }> = [];

  // Check if the current call is to the inbox
  // Use optional chaining for safety
  const destinationChainId = call?.to ? getArbitrumDestinationChainId(call.to) : undefined;
  if (destinationChainId) {
    // Add all calls to the inbox, not just createRetryableTicket
    inboxCalls.push({ call, destinationChainId });
  }

  // Recursively check sub-calls
  if (call?.calls && Array.isArray(call.calls) && call.calls.length > 0) {
    for (const subCall of call.calls) {
      inboxCalls = inboxCalls.concat(findArbitrumInboxCalls(subCall));
    }
  }

  return inboxCalls;
}

/**
 * Parses a source chain simulation trace to find Arbitrum L1 -> L2 bridge
 * messages and converts each one into a destination execution job.
 * Groups jobs by their L2 target address to avoid duplicate simulations.
 *
 * @param sourceSim The Tenderly simulation result from the source chain.
 * @returns An array of destination execution jobs, grouped by L2 target.
 */
export function extractArbitrumL1L2Jobs(sourceSim: TenderlySimulation): CrossChainExecutionJob[] {
  // Map to store jobs by target address and calldata hash
  const jobsByTargetAndCalldata = new Map<string, CrossChainExecutionJob>();
  const unknownSelectorCounts = new Map<string, number>();

  // Handle null or undefined transaction info gracefully
  if (!sourceSim?.transaction?.transaction_info?.call_trace) {
    return [];
  }

  // Find all calls to the Arbitrum Delayed Inbox
  const inboxCalls = findArbitrumInboxCalls(sourceSim.transaction.transaction_info.call_trace);

  for (const { call, destinationChainId } of inboxCalls) {
    if (!call || !call.input || !call.from) continue; // Ensure from exists

    // Skip empty or invalid calldata
    if (call.input === '0x' || call.input.length < 10) {
      console.log(`[Arbitrum Parser] Skipping call with invalid input: ${call.input}`);
      continue;
    }
    const selector = call.input.slice(0, 10).toLowerCase();
    if (selector === '0x00000000') {
      console.log('[Arbitrum Parser] Skipping raw/internal calldata with selector 0x00000000');
      continue;
    }
    if (!ARBITRUM_HANDLED_SELECTORS.has(selector)) {
      unknownSelectorCounts.set(selector, (unknownSelectorCounts.get(selector) || 0) + 1);
      continue;
    }

    try {
      const decodedInput = decodeFunctionData({
        abi: ArbitrumDelayedInboxAbi,
        data: call.input as Hex,
      });

      // Handle different function types
      switch (decodedInput.functionName) {
        case 'createRetryableTicket':
        case 'createRetryableTicketNoRefundAliasRewrite':
        case 'unsafeCreateRetryableTicket':
        case 'uniswapCreateRetryableTicket': {
          const args = decodedInput.args as readonly [
            Address, // to
            bigint, // l2CallValue
            bigint, // maxSubmissionCost
            Address, // excessFeeRefundAddress
            Address, // callValueRefundAddress
            bigint, // gasLimit
            bigint, // maxFeePerGas
            Hex, // data
          ];

          const l2TargetAddress = args[0];
          const l2Value = args[1]; // This is L2 call value, NOT L1 msg.value
          const l2InputData = args[7];
          const l1Sender = getAddress(call.from);
          // Calculate the L2 alias
          const l2Alias = calculateL2Alias(l1Sender);

          // Create the message
          const message: CrossChainExecutionJob = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId,
            l2FromAddress: l2Alias,
            sourceOrder: jobsByTargetAndCalldata.size,
            calls: [{ l2TargetAddress, l2InputData, l2Value: l2Value.toString() }],
          };

          // Use both target address and calldata hash as key
          const key = `${destinationChainId}-${l2TargetAddress}-${l2InputData}`;
          jobsByTargetAndCalldata.set(key, message);
          break;
        }
        case 'sendL1FundedContractTransaction':
        case 'sendL1FundedUnsignedTransaction':
        case 'sendL1FundedUnsignedTransactionToFork': {
          const args = decodedInput.args as readonly [
            bigint, // gasLimit
            bigint, // maxFeePerGas
            Address, // to
            Hex, // data
          ];

          const l2TargetAddress = args[2];
          const l2InputData = args[3];
          const l1Sender = getAddress(call.from);
          const l2Alias = calculateL2Alias(l1Sender);

          const message: CrossChainExecutionJob = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId,
            l2FromAddress: l2Alias,
            sourceOrder: jobsByTargetAndCalldata.size,
            calls: [{ l2TargetAddress, l2InputData, l2Value: '0' }],
          };

          const key = `${destinationChainId}-${l2TargetAddress}-${l2InputData}`;
          jobsByTargetAndCalldata.set(key, message);
          break;
        }
        case 'sendContractTransaction':
        case 'sendUnsignedTransaction':
        case 'sendUnsignedTransactionToFork': {
          const args = decodedInput.args as readonly [
            bigint, // gasLimit
            bigint, // maxFeePerGas
            Address, // to
            bigint, // value
            Hex, // data
          ];

          const l2TargetAddress = args[2];
          const l2Value = args[3];
          const l2InputData = args[4];
          const l1Sender = getAddress(call.from);
          const l2Alias = calculateL2Alias(l1Sender);

          const message: CrossChainExecutionJob = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId,
            l2FromAddress: l2Alias,
            sourceOrder: jobsByTargetAndCalldata.size,
            calls: [{ l2TargetAddress, l2InputData, l2Value: l2Value.toString() }],
          };

          const key = `${destinationChainId}-${l2TargetAddress}-${l2InputData}`;
          jobsByTargetAndCalldata.set(key, message);
          break;
        }
        case 'sendL2Message':
        case 'sendL2MessageFromOrigin': {
          const args = decodedInput.args as readonly [Hex]; // messageData
          const l2InputData = args[0];
          const l1Sender = getAddress(call.from);
          const l2Alias = calculateL2Alias(l1Sender);

          // For these functions, we need to decode the message data to get the target
          try {
            const decodedMessage = decodeFunctionData({
              abi: [
                {
                  type: 'function',
                  name: 'sendMessage',
                  inputs: [
                    { name: 'target', type: 'address' },
                    { name: 'message', type: 'bytes' },
                    { name: 'gasLimit', type: 'uint256' },
                  ],
                  outputs: [],
                  stateMutability: 'nonpayable',
                },
              ],
              data: l2InputData,
            });

            const messageArgs = decodedMessage.args as readonly [Address, Hex, bigint];
            const l2TargetAddress = messageArgs[0];

            const message: CrossChainExecutionJob = {
              bridgeType: 'ArbitrumL1L2',
              destinationChainId,
              l2FromAddress: l2Alias,
              sourceOrder: jobsByTargetAndCalldata.size,
              calls: [{ l2TargetAddress, l2InputData: messageArgs[1], l2Value: '0' }],
            };

            const key = `${destinationChainId}-${l2TargetAddress}-${messageArgs[1]}`;
            jobsByTargetAndCalldata.set(key, message);
          } catch (error) {
            console.error('[Arbitrum Parser] Error decoding L2 message data:', error);
          }
          break;
        }
        default:
          console.log(`[Arbitrum Parser] Unhandled function: ${decodedInput.functionName}`);
      }
    } catch (error) {
      console.error(
        '[Arbitrum Parser] Error decoding inbox call data:',
        error,
        'Call Input:',
        call.input,
      );
    }
  }

  if (unknownSelectorCounts.size > 0) {
    const selectorSummary = Array.from(unknownSelectorCounts.entries())
      .map(([selector, count]) => `${selector} (${count})`)
      .join(', ');
    console.warn(
      `[Arbitrum Parser] Encountered unsupported non-zero inbox selectors: ${selectorSummary}`,
    );
  }

  const extractedJobs = Array.from(jobsByTargetAndCalldata.values());

  if (extractedJobs.length > 0) {
    console.log(`[Arbitrum Parser] Extracted ${extractedJobs.length} unique L1->L2 jobs.`);
  }

  return extractedJobs;
}

/**
 * Extracts Arbitrum L1->L2 bridge messages from a proposal's targets and
 * calldatas, then converts each one into a destination execution job.
 * Used when the simulation call trace does not yield decodeable inbox calls (e.g. trace
 * returns raw/internal calldata). Each (targets[i], calldatas[i]) that targets the
 * Delayed Inbox is decoded into one execution job.
 *
 * @param targets Proposal target addresses (L1).
 * @param calldatas Proposal calldatas (ABI-encoded for each target).
 * @param l1Sender Address treated as the L1 sender for L2 alias (e.g. timelock). Optional.
 * @returns One execution job for each inbox call found.
 */
export function extractArbitrumL1L2JobsFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): CrossChainExecutionJob[] {
  const jobs: CrossChainExecutionJob[] = [];
  const from = l1Sender
    ? getAddress(l1Sender)
    : getAddress('0x0000000000000000000000000000000000000000');
  const l2Alias = calculateL2Alias(from);

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i++) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !data) continue;
    const destinationChainId = getArbitrumDestinationChainId(getAddress(target));
    if (!destinationChainId) continue;
    if (data === '0x' || data.length < 10) continue;

    try {
      const decoded = decodeFunctionData({
        abi: ArbitrumDelayedInboxAbi,
        data: data as Hex,
      });

      switch (decoded.functionName) {
        case 'createRetryableTicket':
        case 'createRetryableTicketNoRefundAliasRewrite':
        case 'unsafeCreateRetryableTicket':
        case 'uniswapCreateRetryableTicket': {
          const args = decoded.args as readonly [
            Address,
            bigint,
            bigint,
            Address,
            Address,
            bigint,
            bigint,
            Hex,
          ];
          jobs.push({
            bridgeType: 'ArbitrumL1L2',
            l2FromAddress: l2Alias,
            destinationChainId,
            sourceOrder: i,
            calls: [
              { l2TargetAddress: args[0], l2InputData: args[7], l2Value: args[1].toString() },
            ],
          });
          break;
        }
        case 'sendL1FundedContractTransaction':
        case 'sendL1FundedUnsignedTransaction':
        case 'sendL1FundedUnsignedTransactionToFork': {
          const args = decoded.args as readonly [bigint, bigint, Address, Hex];
          jobs.push({
            bridgeType: 'ArbitrumL1L2',
            l2FromAddress: l2Alias,
            destinationChainId,
            sourceOrder: i,
            calls: [{ l2TargetAddress: args[2], l2InputData: args[3], l2Value: '0' }],
          });
          break;
        }
        case 'sendContractTransaction':
        case 'sendUnsignedTransaction':
        case 'sendUnsignedTransactionToFork': {
          const args = decoded.args as readonly [bigint, bigint, Address, bigint, Hex];
          jobs.push({
            bridgeType: 'ArbitrumL1L2',
            l2FromAddress: l2Alias,
            destinationChainId,
            sourceOrder: i,
            calls: [
              { l2TargetAddress: args[2], l2InputData: args[4], l2Value: args[3].toString() },
            ],
          });
          break;
        }
        default:
          break;
      }
    } catch {
      // Skip invalid or unsupported inbox calldata
    }
  }

  if (jobs.length > 0) {
    console.log(
      `[Arbitrum Parser] Extracted ${jobs.length} L1->L2 job(s) from proposal targets/calldatas.`,
    );
  }
  return jobs;
}
