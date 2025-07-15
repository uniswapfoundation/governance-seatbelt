import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { ExtractedCrossChainMessage } from '../../types.d';

// L1CrossDomainMessenger addresses for supported OP Stack chains
const OPTIMISM_MESSENGERS: Record<string, Address> = {
  '10': '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet
  '8453': '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base
};

// Get all messenger addresses as lowercase for comparison
const MESSENGER_ADDRESSES = Object.values(OPTIMISM_MESSENGERS).map((addr) => addr.toLowerCase());

/**
 * Recursively searches the call trace for calls to any Optimism L1CrossDomainMessenger.
 */
function findOptimismMessengerCalls(call: CallTrace): CallTrace[] {
  let messengerCalls: CallTrace[] = [];

  // Check if the current call is to any messenger
  if (call?.to && MESSENGER_ADDRESSES.includes(call.to.toLowerCase())) {
    messengerCalls.push(call);
  }

  // Recursively check sub-calls
  if (call?.calls && Array.isArray(call.calls) && call.calls.length > 0) {
    for (const subCall of call.calls) {
      messengerCalls = messengerCalls.concat(findOptimismMessengerCalls(subCall));
    }
  }

  return messengerCalls;
}

/**
 * Determines the destination chain ID based on the messenger address.
 */
function getChainIdFromMessenger(messengerAddress: string): string | null {
  const normalizedAddress = messengerAddress.toLowerCase();
  for (const [chainId, address] of Object.entries(OPTIMISM_MESSENGERS)) {
    if (address.toLowerCase() === normalizedAddress) {
      return chainId;
    }
  }
  return null;
}

/**
 * Parses a source chain simulation trace to find Optimism L1 -> L2 messages
 * initiated via the L1CrossDomainMessenger contract's sendMessage function.
 * Supports both OP Mainnet and Base.
 *
 * @param sourceSim The Tenderly simulation result from the source chain.
 * @returns An array of ExtractedCrossChainMessage objects.
 */
export function parseOptimismL1L2Messages(
  sourceSim: TenderlySimulation,
): ExtractedCrossChainMessage[] {
  // Map to store unique messages
  const messagesByTargetAndCalldata = new Map<string, ExtractedCrossChainMessage>();

  // Find all calls to Optimism messengers
  const messengerCalls = findOptimismMessengerCalls(
    sourceSim.transaction.transaction_info.call_trace,
  );

  for (const call of messengerCalls) {
    if (!call || !call.input || !call.from || !call.to) continue;

    // Skip empty or invalid calldata
    if (call.input === '0x' || call.input.length < 10) {
      console.log(`[Optimism Parser] Skipping call with invalid input: ${call.input}`);
      continue;
    }

    // Get the destination chain ID
    const destinationChainId = getChainIdFromMessenger(call.to);
    if (!destinationChainId) {
      console.log(`[Optimism Parser] Unknown messenger address: ${call.to}`);
      continue;
    }

    try {
      // The sendMessage function selector is 0x3dbb202b
      const selector = call.input.slice(0, 10);
      if (selector !== '0x3dbb202b') {
        console.log(`[Optimism Parser] Skipping non-sendMessage call: ${selector}`);
        continue;
      }

      // Decode sendMessage(address _target, bytes _message, uint32 _minGasLimit)
      // For simplicity, we'll extract the values manually
      // Skip function selector (4 bytes)
      const data = call.input.slice(10);

      // Extract target address (32 bytes, but address is in the last 20 bytes)
      const targetAddress = getAddress(`0x${data.slice(24, 64)}`);

      // Skip to the bytes offset (32 bytes for target + 32 bytes for bytes offset + 32 bytes for gasLimit)
      // The message bytes start at offset 0x60 (96 in decimal = 3 * 32)
      // Read the length of the bytes data (32 bytes)
      const messageLengthHex = data.slice(192, 256);
      const messageLength = Number.parseInt(messageLengthHex, 16);

      // Read the actual message data
      const messageData = `0x${data.slice(256, 256 + messageLength * 2)}` as Hex;

      // Extract value from the call
      const l2Value = call.value || '0';

      // Create the message
      const message: ExtractedCrossChainMessage = {
        bridgeType: 'OptimismL1L2',
        destinationChainId,
        l2TargetAddress: targetAddress,
        l2InputData: messageData,
        l2Value: l2Value.toString(),
        l2FromAddress: getAddress(call.from), // On Optimism, the sender is preserved
      };

      // Use both target address and calldata hash as key
      const key = `${targetAddress}-${messageData}-${destinationChainId}`;
      messagesByTargetAndCalldata.set(key, message);

      console.log(
        `[Optimism Parser] Found message to ${targetAddress} on chain ${destinationChainId}`,
      );
    } catch (error) {
      console.error(
        '[Optimism Parser] Error decoding messenger call data:',
        error,
        'Call Input:',
        call.input,
      );
    }
  }

  const extractedMessages = Array.from(messagesByTargetAndCalldata.values());

  if (extractedMessages.length > 0) {
    console.log(`[Optimism Parser] Extracted ${extractedMessages.length} unique L1->L2 messages.`);
  }

  return extractedMessages;
}
