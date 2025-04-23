import type { Address, Hex } from 'viem';
import { decodeFunctionData, getAddress, hexToBigInt, toHex } from 'viem';
import type { TenderlySimulation } from '../../types.d';
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
 * Uses 'any' for parameter type due to complex nested trace types.
 */
function findArbitrumInboxCalls(call: any): any[] {
  let inboxCalls: any[] = [];

  // Check if the current call is to the inbox
  // Use optional chaining for safety
  if (call?.to?.toLowerCase() === ARBITRUM_DELAYED_INBOX.toLowerCase()) {
    // Check if it's the correct function (createRetryableTicket)
    if (call?.input?.startsWith('0x679b6ded')) {
      inboxCalls.push(call);
    }
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
 *
 * @param sourceSim The Tenderly simulation result from the source chain.
 * @returns An array of ExtractedCrossChainMessage objects.
 */
export function parseArbitrumL1L2Messages(
  sourceSim: TenderlySimulation,
): ExtractedCrossChainMessage[] {
  const extractedMessages: ExtractedCrossChainMessage[] = [];

  // Use optional chaining extensively for safety when accessing nested properties
  const trace = sourceSim?.transaction?.transaction_info?.call_trace;
  if (!trace) {
    console.warn('[Arbitrum Parser] No call trace found in simulation.');
    return extractedMessages;
  }

  // Find all relevant calls to the inbox
  const inboxCalls = findArbitrumInboxCalls(trace);

  for (const call of inboxCalls) {
    if (!call || !call.input || !call.from) continue; // Ensure from exists
    try {
      const decodedInput = decodeFunctionData({
        abi: ArbitrumDelayedInboxAbi,
        data: call.input as Hex,
      });

      if (decodedInput.functionName === 'createRetryableTicket') {
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

        extractedMessages.push({
          bridgeType: 'ArbitrumL1L2',
          destinationChainId: ARBITRUM_CHAIN_ID,
          l2TargetAddress: l2TargetAddress,
          l2InputData: l2InputData,
          l2Value: l2Value.toString(),
          // Use the calculated L2 Alias as the expected sender on L2
          l2FromAddress: l2Alias,
        });
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

  if (extractedMessages.length > 0) {
    console.log(`[Arbitrum Parser] Extracted ${extractedMessages.length} L1->L2 messages.`);
  }

  return extractedMessages;
}
