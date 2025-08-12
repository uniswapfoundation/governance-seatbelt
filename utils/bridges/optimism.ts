import type { Address, Hex } from 'viem';
import { decodeFunctionData, getAddress, parseAbi } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { ExtractedCrossChainMessage } from '../../types.d';

// L1CrossDomainMessenger addresses for supported OP Stack chains
const OPTIMISM_MESSENGERS: Record<string, Address> = {
  '10': '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet
  '8453': '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base
  '130': '0x9A3D64E386C18Cb1d6d5179a9596A4B5736e98A6', // Unichain
  '57073': '0x69d3cf86b2bf1a9e99875b7e2d9b6a84426c171f', // Ink
  '1868': '0x9cf951e3f74b644e621b36ca9cea147a78d4c39f', // Soneium
  '60808': '0xE3d981643b806FB8030CDB677D6E60892E547EdA', // Bob
};

// ABI for L1CrossDomainMessenger sendMessage function
const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);

// Constants for validation
const VALIDATION_CONSTANTS = {
  MIN_SEND_MESSAGE_INPUT_LENGTH: 138, // Minimum length for valid sendMessage call (4 + 32 + 32 + 64 + 4 + 2)
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
    if (
      call.input === '0x' ||
      call.input.length < VALIDATION_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH
    ) {
      console.log(
        `[Optimism Parser] Skipping call with invalid input length: ${call.input?.length || 0} chars (min: ${VALIDATION_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH})`,
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
      // Decode sendMessage function call using viem's robust ABI decoding
      const { functionName, args } = decodeFunctionData({
        abi: SEND_MESSAGE_ABI,
        data: call.input as Hex,
      });

      // Verify this is indeed a sendMessage call
      if (functionName !== 'sendMessage') {
        console.log(`[Optimism Parser] Skipping non-sendMessage call: ${functionName}`);
        continue;
      }

      // Extract decoded arguments
      const [targetAddress, messageData, minGasLimit] = args;

      // Validate message data length for DoS prevention
      const messageLength = messageData.length;
      if (messageLength > VALIDATION_CONSTANTS.MAX_MESSAGE_LENGTH * 2) {
        // *2 for hex encoding
        console.log(
          `[Optimism Parser] Message too large: ${messageLength / 2} bytes (max: ${VALIDATION_CONSTANTS.MAX_MESSAGE_LENGTH})`,
        );
        continue;
      }

      // Extract value from the call
      const l2Value = call.value || '0';

      // Create the message
      // TEMP: For Unichain testing, use an address that likely has ETH balance
      const l2FromAddress =
        destinationChainId === '130'
          ? ('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address) // Use Uniswap V2 Router for Unichain
          : getAddress(call.from); // Preserve original sender for other chains

      const message: ExtractedCrossChainMessage = {
        bridgeType: 'OptimismL1L2',
        destinationChainId,
        l2TargetAddress: getAddress(targetAddress),
        l2InputData: messageData as Hex,
        l2Value: l2Value.toString(),
        l2FromAddress,
      };

      // Use both target address and calldata hash as key for deduplication
      const key = `${targetAddress}-${messageData}-${destinationChainId}`;
      messagesByTargetAndCalldata.set(key, message);

      console.log(
        `[Optimism Parser] Found message to ${targetAddress} on chain ${destinationChainId} (gas: ${minGasLimit})`,
      );
    } catch (error) {
      // This will catch calls that don't match the sendMessage ABI or have invalid data
      console.log(
        `[Optimism Parser] Skipping non-sendMessage call or decoding error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  const extractedMessages = Array.from(messagesByTargetAndCalldata.values());

  if (extractedMessages.length > 0) {
    console.log(`[Optimism Parser] Extracted ${extractedMessages.length} unique L1->L2 messages.`);
  }

  return extractedMessages;
}
