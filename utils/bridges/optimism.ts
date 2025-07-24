import { type Address, type Hex, getAddress } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { ExtractedCrossChainMessage } from '../../types.d';

// L1CrossDomainMessenger addresses for supported OP Stack chains
const OPTIMISM_MESSENGERS: Record<string, Address> = {
  '10': '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet
  '8453': '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base
};

// Constants for ABI decoding
const ABI_CONSTANTS = {
  SEND_MESSAGE_SELECTOR: '0x3dbb202b',
  FUNCTION_SELECTOR_LENGTH: 10, // 4 bytes = 8 hex chars + 0x prefix
  ADDRESS_OFFSET_START: 24, // Skip padding to get to actual address (12 bytes padding + 20 bytes address)
  ADDRESS_OFFSET_END: 64, // 32 bytes total for address parameter
  MESSAGE_LENGTH_OFFSET: 192, // 3 * 32 bytes (target + bytes offset + gas limit) * 2 hex chars
  MESSAGE_LENGTH_SIZE: 256, // 32 bytes for length field
  MESSAGE_DATA_OFFSET: 256, // Start of actual message data
  MIN_SEND_MESSAGE_INPUT_LENGTH: 256, // Minimum expected length for a valid sendMessage call
  MAX_MESSAGE_LENGTH: 1000000, // Reasonable upper bound for message size (1MB)
} as const;

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

  // Handle null or undefined transaction info gracefully
  if (!sourceSim?.transaction?.transaction_info?.call_trace) {
    return [];
  }

  // Find all calls to Optimism messengers
  const messengerCalls = findOptimismMessengerCalls(
    sourceSim.transaction.transaction_info.call_trace,
  );

  for (const call of messengerCalls) {
    if (!call || !call.input || !call.from || !call.to) continue;

    // Skip empty or invalid calldata - must have at least minimum length for sendMessage
    if (call.input === '0x' || call.input.length < ABI_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH) {
      console.log(
        `[Optimism Parser] Skipping call with invalid input length: ${call.input?.length || 0} chars (min: ${ABI_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH})`,
      );
      continue;
    }

    // Get the destination chain ID
    const destinationChainId = getChainIdFromMessenger(call.to);
    if (!destinationChainId) {
      console.log(`[Optimism Parser] Unknown messenger address: ${call.to}`);
      continue;
    }

    try {
      // Check for sendMessage function selector
      const selector = call.input.slice(0, ABI_CONSTANTS.FUNCTION_SELECTOR_LENGTH);
      if (selector !== ABI_CONSTANTS.SEND_MESSAGE_SELECTOR) {
        console.log(`[Optimism Parser] Skipping non-sendMessage call: ${selector}`);
        continue;
      }

      // Decode sendMessage(address _target, bytes _message, uint32 _minGasLimit)
      // Skip function selector (4 bytes)
      const data = call.input.slice(ABI_CONSTANTS.FUNCTION_SELECTOR_LENGTH);

      // Validate we have enough data for basic parameters
      if (data.length < ABI_CONSTANTS.MESSAGE_DATA_OFFSET) {
        console.log(
          `[Optimism Parser] Insufficient data for sendMessage parameters: ${data.length} chars`,
        );
        continue;
      }

      // Extract target address (32 bytes, but address is in the last 20 bytes)
      const targetAddress = getAddress(
        `0x${data.slice(ABI_CONSTANTS.ADDRESS_OFFSET_START, ABI_CONSTANTS.ADDRESS_OFFSET_END)}`,
      );

      // Read the length of the bytes data (32 bytes)
      const messageLengthHex = data.slice(
        ABI_CONSTANTS.MESSAGE_LENGTH_OFFSET,
        ABI_CONSTANTS.MESSAGE_LENGTH_SIZE,
      );

      // Check for malformed or extremely large message lengths
      if (messageLengthHex.length !== 64) {
        console.log(`[Optimism Parser] Invalid message length field: ${messageLengthHex}`);
        continue;
      }

      const messageLength = Number.parseInt(messageLengthHex, 16);

      // Validate message length and available data
      if (
        !Number.isFinite(messageLength) ||
        messageLength < 0 ||
        messageLength > ABI_CONSTANTS.MAX_MESSAGE_LENGTH
      ) {
        // Sanity check: reject obviously invalid lengths (1MB limit prevents DoS)
        console.log(`[Optimism Parser] Invalid message length: ${messageLength}`);
        continue;
      }

      const expectedDataEnd = ABI_CONSTANTS.MESSAGE_DATA_OFFSET + messageLength * 2;
      if (data.length < expectedDataEnd) {
        console.log(
          `[Optimism Parser] Insufficient data for message: expected ${expectedDataEnd}, got ${data.length}`,
        );
        continue;
      }

      // Read the actual message data
      const messageData =
        `0x${data.slice(ABI_CONSTANTS.MESSAGE_DATA_OFFSET, expectedDataEnd)}` as Hex;

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
