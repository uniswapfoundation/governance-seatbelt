import { type Address, type Hex, decodeFunctionData, getAddress, hexToBigInt, toHex } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { ExtractedCrossChainMessage } from '../../types.d';
// Assuming ABI is available, similar to sims/arb-grant.sim.ts
import ArbitrumDelayedInboxAbi from '../abis/ArbitrumDelayedInboxAbi.json' assert { type: 'json' };

const ARBITRUM_DELAYED_INBOX: Address = '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f';
const ARBITRUM_CHAIN_ID = '42161';
const ARB_ALIAS_OFFSET = BigInt('0x1111000000000000000000000000000000001111');

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
function findArbitrumInboxCalls(call: CallTrace): CallTrace[] {
  let inboxCalls: CallTrace[] = [];

  // Check if the current call is to the inbox
  // Use optional chaining for safety
  if (call?.to?.toLowerCase() === ARBITRUM_DELAYED_INBOX.toLowerCase()) {
    // Add all calls to the inbox, not just createRetryableTicket
    inboxCalls.push(call);
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
 * Parses a source chain simulation trace to find Arbitrum L1 -> L2 messages
 * initiated via the ArbitrumDelayedInbox contract's createRetryableTicket function.
 * Groups messages by their L2 target address to avoid duplicate simulations.
 *
 * @param sourceSim The Tenderly simulation result from the source chain.
 * @returns An array of ExtractedCrossChainMessage objects, grouped by L2 target.
 */
export function parseArbitrumL1L2Messages(
  sourceSim: TenderlySimulation,
): ExtractedCrossChainMessage[] {
  // Map to store messages by target address and calldata hash
  const messagesByTargetAndCalldata = new Map<string, ExtractedCrossChainMessage>();

  // Handle null or undefined transaction info gracefully
  if (!sourceSim?.transaction?.transaction_info?.call_trace) {
    return [];
  }

  // Find all calls to the Arbitrum Delayed Inbox
  const inboxCalls = findArbitrumInboxCalls(sourceSim.transaction.transaction_info.call_trace);

  for (const call of inboxCalls) {
    if (!call || !call.input || !call.from) continue; // Ensure from exists

    // Skip empty or invalid calldata
    if (call.input === '0x' || call.input.length < 10) {
      console.log(`[Arbitrum Parser] Skipping call with invalid input: ${call.input}`);
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
          const message: ExtractedCrossChainMessage = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId: ARBITRUM_CHAIN_ID,
            l2TargetAddress: l2TargetAddress,
            l2InputData: l2InputData,
            l2Value: l2Value.toString(),
            l2FromAddress: l2Alias,
          };

          // Use both target address and calldata hash as key
          const key = `${l2TargetAddress}-${l2InputData}`;
          messagesByTargetAndCalldata.set(key, message);
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

          const message: ExtractedCrossChainMessage = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId: ARBITRUM_CHAIN_ID,
            l2TargetAddress: l2TargetAddress,
            l2InputData: l2InputData,
            l2Value: '0', // These functions don't have L2 value
            l2FromAddress: l2Alias,
          };

          const key = `${l2TargetAddress}-${l2InputData}`;
          messagesByTargetAndCalldata.set(key, message);
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

          const message: ExtractedCrossChainMessage = {
            bridgeType: 'ArbitrumL1L2',
            destinationChainId: ARBITRUM_CHAIN_ID,
            l2TargetAddress: l2TargetAddress,
            l2InputData: l2InputData,
            l2Value: l2Value.toString(),
            l2FromAddress: l2Alias,
          };

          const key = `${l2TargetAddress}-${l2InputData}`;
          messagesByTargetAndCalldata.set(key, message);
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

            const message: ExtractedCrossChainMessage = {
              bridgeType: 'ArbitrumL1L2',
              destinationChainId: ARBITRUM_CHAIN_ID,
              l2TargetAddress: l2TargetAddress,
              l2InputData: messageArgs[1],
              l2Value: '0',
              l2FromAddress: l2Alias,
            };

            const key = `${l2TargetAddress}-${messageArgs[1]}`;
            messagesByTargetAndCalldata.set(key, message);
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

  const extractedMessages = Array.from(messagesByTargetAndCalldata.values());

  if (extractedMessages.length > 0) {
    console.log(`[Arbitrum Parser] Extracted ${extractedMessages.length} unique L1->L2 messages.`);
  }

  return extractedMessages;
}
