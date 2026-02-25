import type { Address, Hex } from 'viem';
import {
  decodeFunctionData,
  getAddress,
  hexToBigInt,
  parseAbi,
  slice,
  toFunctionSelector,
  toHex,
} from 'viem';
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
  '42220': '0x1AC1181fc4e4F877963680587AEAa2C90D7EbB95', // Celo
  '480': '0xf931a81D18B1766d15695ffc7c1920a62b7e710a', // Worldchain
  '7777777': '0xdC40a14d9abd6F410226f1E6de71aE03441ca506', // Zora
};

// OptimismPortal addresses for OP-style depositTransaction flows
const OPTIMISM_PORTALS: Record<string, Address> = {
  '1868': '0x88e529A6ccd302c948689Cd5156C83D4614FAE92', // Soneium
  '196': '0x64057ad1DdAc804d0D26A7275b193D9DACa19993', // XLayer
};

// ABI for L1CrossDomainMessenger sendMessage function
const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);

const DEPOSIT_TRANSACTION_ABI = parseAbi([
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
]);

const SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
);

const DEPOSIT_TRANSACTION_SELECTOR = toFunctionSelector(
  'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
);

const OPTIMISM_ALIAS_OFFSET = BigInt('0x1111000000000000000000000000000000001111');

// Uniswap-specific pattern: L1 messages often target an L2 "CrossChainAccount" forwarder which then
// executes the real call. Simulating the forwarded call directly (from the forwarder) produces a
// much more accurate outcome for access-controlled targets (e.g., Uniswap v3 pools/factories).
const L2_CROSS_CHAIN_ACCOUNTS: Partial<Record<string, Address>> = {
  '10': '0xa1dD330d602c32622AA270Ea73d078B803Cb3518', // Optimism
  '8453': '0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9', // Base
  '480': '0xcb2436774C3e191c85056d248EF4260ce5f27A9D', // World Chain
  '7777777': '0x36eEC182D0B24Df3DC23115D64DB521A93D5154f', // Zora
};
// Note: Celo and X Layer intentionally rely on selector-based forward decoding when payloads
// use varying forwarder addresses (e.g. proposal placeholders), rather than strict address checks.

const L2_CROSS_CHAIN_ACCOUNT_FORWARD_ABI = parseAbi([
  'function forward(address target, bytes data)',
]);

const CROSS_CHAIN_FORWARD_SELECTOR = toFunctionSelector(
  'function forward(address target, bytes data)',
);

// Constants for validation
const VALIDATION_CONSTANTS = {
  MIN_SEND_MESSAGE_INPUT_LENGTH: 138, // Minimum length for valid sendMessage call
  MIN_DEPOSIT_TRANSACTION_INPUT_LENGTH: 330, // Minimum length for valid depositTransaction call
  MAX_MESSAGE_LENGTH: 1000000, // Reasonable upper bound for message size (1MB)
} as const;

const MESSENGER_ADDRESSES = Object.values(OPTIMISM_MESSENGERS).map((addr) => addr.toLowerCase());
const PORTAL_ADDRESSES = new Set(Object.values(OPTIMISM_PORTALS).map((addr) => addr.toLowerCase()));

type ExtendedCallTrace = CallTrace & {
  address?: string;
  function_name?: string;
  call_type?: string;
  caller?: { address?: string };
  decoded_input?: Array<{
    soltype?: { name?: string };
    value?: unknown;
  }>;
};

function isMessengerAddress(address: string | undefined): boolean {
  return !!address && MESSENGER_ADDRESSES.includes(address.toLowerCase());
}

/**
 * Recursively searches the call trace for calls in the context of an Optimism messenger.
 *
 * We match both:
 * - proxy fallback calls where `to` is the messenger address
 * - delegatecall frames where `address` is the messenger (proxy context) and `to` is implementation
 */
function findOptimismMessengerCalls(call: ExtendedCallTrace): ExtendedCallTrace[] {
  let messengerCalls: ExtendedCallTrace[] = [];

  if (isMessengerAddress(call?.to) || isMessengerAddress(call?.address)) {
    messengerCalls.push(call);
  }

  if (call?.calls && Array.isArray(call.calls) && call.calls.length > 0) {
    for (const subCall of call.calls) {
      messengerCalls = messengerCalls.concat(
        findOptimismMessengerCalls(subCall as ExtendedCallTrace),
      );
    }
  }

  return messengerCalls;
}

function findOptimismCalls(call: CallTrace): { portalCalls: ExtendedCallTrace[] } {
  const portalCalls: ExtendedCallTrace[] = [];

  const visit = (node: ExtendedCallTrace) => {
    const portalAddress = [node.to, node.address]
      .filter((value): value is string => typeof value === 'string')
      .find((value) => PORTAL_ADDRESSES.has(value.toLowerCase()));

    if (portalAddress) {
      portalCalls.push(node);
    }

    if (node?.calls && Array.isArray(node.calls) && node.calls.length > 0) {
      for (const subCall of node.calls) {
        visit(subCall as ExtendedCallTrace);
      }
    }
  };

  visit(call as ExtendedCallTrace);
  return { portalCalls };
}

function getChainIdFromMessenger(messengerAddress: string): string | null {
  const normalizedAddress = messengerAddress.toLowerCase();
  for (const [chainId, address] of Object.entries(OPTIMISM_MESSENGERS)) {
    if (address.toLowerCase() === normalizedAddress) {
      return chainId;
    }
  }
  return null;
}

function getChainIdFromAddress(address: string, mapping: Record<string, Address>): string | null {
  const normalizedAddress = address.toLowerCase();
  for (const [chainId, mappedAddress] of Object.entries(mapping)) {
    if (mappedAddress.toLowerCase() === normalizedAddress) {
      return chainId;
    }
  }
  return null;
}

function decodeSendMessageFromDecodedInput(call: ExtendedCallTrace): {
  fromAddress: Address;
  targetAddress: Address;
  messageData: Hex;
  minGasLimit: bigint;
} | null {
  if (call.function_name !== 'sendMessage' || !Array.isArray(call.decoded_input)) {
    return null;
  }

  const argsByName = new Map<string, unknown>();
  for (const arg of call.decoded_input) {
    const name = arg.soltype?.name;
    if (typeof name === 'string') {
      argsByName.set(name, arg.value);
    }
  }

  const targetValue = argsByName.get('_target') ?? call.decoded_input[0]?.value;
  const messageValue = argsByName.get('_message') ?? call.decoded_input[1]?.value;
  const minGasValue = argsByName.get('_minGasLimit') ?? call.decoded_input[2]?.value;

  if (typeof targetValue !== 'string' || typeof messageValue !== 'string') {
    return null;
  }

  const fromCandidate = typeof call.caller?.address === 'string' ? call.caller.address : call.from;
  if (typeof fromCandidate !== 'string') {
    return null;
  }

  const parsedMinGas =
    typeof minGasValue === 'bigint'
      ? minGasValue
      : typeof minGasValue === 'number'
        ? BigInt(minGasValue)
        : typeof minGasValue === 'string'
          ? BigInt(minGasValue)
          : 0n;

  return {
    fromAddress: getAddress(fromCandidate),
    targetAddress: getAddress(targetValue),
    messageData: messageValue as Hex,
    minGasLimit: parsedMinGas,
  };
}

function decodeDepositTransactionFromDecodedInput(call: ExtendedCallTrace): {
  fromAddress: Address;
  targetAddress: Address;
  value: bigint;
  isCreation: boolean;
  messageData: Hex;
} | null {
  if (call.function_name !== 'depositTransaction' || !Array.isArray(call.decoded_input)) {
    return null;
  }

  const argsByName = new Map<string, unknown>();
  for (const arg of call.decoded_input) {
    const name = arg.soltype?.name;
    if (typeof name === 'string') {
      argsByName.set(name, arg.value);
    }
  }

  const targetValue = argsByName.get('_to') ?? call.decoded_input[0]?.value;
  const valueRaw = argsByName.get('_value') ?? call.decoded_input[1]?.value;
  const isCreationRaw = argsByName.get('_isCreation') ?? call.decoded_input[3]?.value;
  const messageValue = argsByName.get('_data') ?? call.decoded_input[4]?.value;

  if (typeof targetValue !== 'string' || typeof messageValue !== 'string') {
    return null;
  }

  const fromCandidate =
    typeof call.caller?.address === 'string'
      ? call.caller.address
      : typeof call.from === 'string'
        ? call.from
        : undefined;
  if (!fromCandidate) {
    return null;
  }

  const parsedValue =
    typeof valueRaw === 'bigint'
      ? valueRaw
      : typeof valueRaw === 'number'
        ? BigInt(valueRaw)
        : typeof valueRaw === 'string'
          ? BigInt(valueRaw)
          : 0n;

  const isCreation =
    typeof isCreationRaw === 'boolean'
      ? isCreationRaw
      : typeof isCreationRaw === 'number'
        ? isCreationRaw !== 0
        : typeof isCreationRaw === 'bigint'
          ? isCreationRaw !== 0n
          : typeof isCreationRaw === 'string'
            ? isCreationRaw !== '0'
            : false;

  return {
    fromAddress: getAddress(fromCandidate),
    targetAddress: getAddress(targetValue),
    value: parsedValue,
    isCreation,
    messageData: messageValue as Hex,
  };
}

function calculateL2Alias(l1Address: Address): Address {
  const l1AddressBigInt = hexToBigInt(l1Address);
  const l2AliasBigInt = l1AddressBigInt + OPTIMISM_ALIAS_OFFSET;
  return getAddress(toHex(l2AliasBigInt, { size: 20 }));
}

function buildMessageFromDecodedPayload(input: {
  destinationChainId: string;
  targetAddress: Address;
  messageData: Hex;
  l2Value: string;
  l2FromAddress: Address;
}): ExtractedCrossChainMessage | null {
  if (input.messageData.length > VALIDATION_CONSTANTS.MAX_MESSAGE_LENGTH * 2) {
    console.log(
      `[Optimism Parser] Message too large: ${input.messageData.length / 2} bytes (max: ${VALIDATION_CONSTANTS.MAX_MESSAGE_LENGTH})`,
    );
    return null;
  }

  let l2TargetAddress = getAddress(input.targetAddress);
  let l2InputData = input.messageData;
  let l2FromAddress = input.l2FromAddress;

  // TEMP: For Unichain testing, use an address that likely has ETH balance.
  if (input.destinationChainId === '130') {
    l2FromAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address;
  }

  const expectedForwarder = L2_CROSS_CHAIN_ACCOUNTS[input.destinationChainId];
  const shouldAttemptForwardDecode =
    input.messageData.length >= 10 &&
    slice(input.messageData, 0, 4) === CROSS_CHAIN_FORWARD_SELECTOR &&
    (!expectedForwarder || getAddress(input.targetAddress) === getAddress(expectedForwarder));

  // Decode forwarded payloads so we simulate and label the final target contract call.
  if (shouldAttemptForwardDecode) {
    try {
      const decodedForward = decodeFunctionData({
        abi: L2_CROSS_CHAIN_ACCOUNT_FORWARD_ABI,
        data: input.messageData,
      });
      if (decodedForward.functionName === 'forward') {
        const [forwardTarget, forwardData] = decodedForward.args;
        l2FromAddress = getAddress(input.targetAddress);
        l2TargetAddress = getAddress(forwardTarget);
        l2InputData = forwardData as Hex;
      }
    } catch {
      // Fall back to simulating the direct call to the forwarder.
    }
  }

  return {
    bridgeType: 'OptimismL1L2',
    destinationChainId: input.destinationChainId,
    l2TargetAddress,
    l2InputData,
    l2Value: input.l2Value,
    l2FromAddress,
  };
}

/**
 * Parses a source chain simulation trace to find OP-style L1 -> L2 messages
 * initiated via L1CrossDomainMessenger.sendMessage or OptimismPortal.depositTransaction.
 */
export function parseOptimismL1L2Messages(
  sourceSim: TenderlySimulation,
): ExtractedCrossChainMessage[] {
  const messagesByKey = new Map<string, ExtractedCrossChainMessage>();

  if (!sourceSim?.transaction?.transaction_info?.call_trace) {
    return [];
  }

  const callTrace = sourceSim.transaction.transaction_info.call_trace;
  const messengerCalls = findOptimismMessengerCalls(callTrace as ExtendedCallTrace);
  const { portalCalls } = findOptimismCalls(callTrace);

  for (const call of messengerCalls) {
    const messengerAddress = isMessengerAddress(call.to)
      ? call.to
      : isMessengerAddress(call.address)
        ? call.address
        : undefined;
    if (!messengerAddress) continue;

    const destinationChainId = getChainIdFromMessenger(messengerAddress);
    if (!destinationChainId) {
      console.log(`[Optimism Parser] Unknown messenger address: ${messengerAddress}`);
      continue;
    }

    try {
      // Preferred path: use Tenderly-decoded sendMessage args from delegatecall frames.
      let decoded = decodeSendMessageFromDecodedInput(call);

      // Fallback path: decode raw calldata directly from the frame input.
      if (!decoded) {
        if (!call.input || !call.from) continue;

        if (
          call.input === '0x' ||
          call.input.length < VALIDATION_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH
        ) {
          console.log(
            `[Optimism Parser] Skipping call with invalid input length: ${call.input?.length || 0} chars (min: ${VALIDATION_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH})`,
          );
          continue;
        }

        const { functionName, args } = decodeFunctionData({
          abi: SEND_MESSAGE_ABI,
          data: call.input as Hex,
        });

        if (functionName !== 'sendMessage') {
          console.log(`[Optimism Parser] Skipping non-sendMessage call: ${functionName}`);
          continue;
        }

        const [targetAddress, messageData, minGasLimit] = args;
        decoded = {
          fromAddress: getAddress(call.from),
          targetAddress: getAddress(targetAddress),
          messageData: messageData as Hex,
          minGasLimit: BigInt(minGasLimit),
        };
      }

      const { fromAddress, targetAddress, messageData, minGasLimit } = decoded;
      const message = buildMessageFromDecodedPayload({
        destinationChainId,
        targetAddress,
        messageData,
        l2Value: (call.value || '0').toString(),
        l2FromAddress: fromAddress,
      });

      if (!message) continue;

      const key = `${message.l2TargetAddress}-${message.l2InputData}-${destinationChainId}`;
      messagesByKey.set(key, message);

      console.log(
        `[Optimism Parser] Found message to ${message.l2TargetAddress} on chain ${destinationChainId} (gas: ${minGasLimit})`,
      );
    } catch (error) {
      console.log(
        `[Optimism Parser] Skipping non-sendMessage call or decoding error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  for (const call of portalCalls) {
    const portalAddress = [call.to, call.address]
      .filter((value): value is string => typeof value === 'string')
      .find((value) => PORTAL_ADDRESSES.has(value.toLowerCase()));
    if (!portalAddress) continue;

    const destinationChainId = getChainIdFromAddress(portalAddress, OPTIMISM_PORTALS);
    if (!destinationChainId) {
      continue;
    }

    try {
      let decodedDeposit = decodeDepositTransactionFromDecodedInput(call);

      if (!decodedDeposit) {
        if (
          !call?.input ||
          call.input === '0x' ||
          call.input.length < VALIDATION_CONSTANTS.MIN_DEPOSIT_TRANSACTION_INPUT_LENGTH
        ) {
          continue;
        }
        if (slice(call.input as Hex, 0, 4) !== DEPOSIT_TRANSACTION_SELECTOR) {
          continue;
        }

        const { functionName, args } = decodeFunctionData({
          abi: DEPOSIT_TRANSACTION_ABI,
          data: call.input as Hex,
        });

        if (functionName !== 'depositTransaction') {
          continue;
        }

        const [targetAddress, value, _gasLimit, isCreation, messageData] = args;
        const fromCandidate =
          typeof call.from === 'string'
            ? call.from
            : typeof call.caller?.address === 'string'
              ? call.caller.address
              : undefined;
        if (!fromCandidate) {
          continue;
        }
        decodedDeposit = {
          fromAddress: getAddress(fromCandidate),
          targetAddress: getAddress(targetAddress),
          value: BigInt(value),
          isCreation: Boolean(isCreation),
          messageData: messageData as Hex,
        };
      }

      if (decodedDeposit.isCreation) continue;

      const message = buildMessageFromDecodedPayload({
        destinationChainId,
        targetAddress: decodedDeposit.targetAddress,
        messageData: decodedDeposit.messageData,
        l2Value: decodedDeposit.value.toString(),
        l2FromAddress: calculateL2Alias(decodedDeposit.fromAddress),
      });

      if (!message) continue;

      const key = `${message.l2TargetAddress}-${message.l2InputData}-${destinationChainId}`;
      messagesByKey.set(key, message);

      console.log(
        `[Optimism Parser] Found portal deposit message to ${message.l2TargetAddress} on chain ${destinationChainId}`,
      );
    } catch {
      // Skip invalid calldata.
    }
  }

  const extractedMessages = Array.from(messagesByKey.values());
  if (extractedMessages.length > 0) {
    console.log(`[Optimism Parser] Extracted ${extractedMessages.length} unique L1->L2 messages.`);
  }

  return extractedMessages;
}

/**
 * Extracts OP-style L1->L2 messages from a proposal's targets and calldatas.
 * Used when the simulation call trace does not yield decodeable bridge calls.
 */
export function parseOptimismL1L2MessagesFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): ExtractedCrossChainMessage[] {
  const messages: ExtractedCrossChainMessage[] = [];
  const messengerAddresses = new Set(
    Object.values(OPTIMISM_MESSENGERS).map((address) => address.toLowerCase()),
  );
  const portalAddresses = new Set(
    Object.values(OPTIMISM_PORTALS).map((address) => address.toLowerCase()),
  );

  const normalizedSender = l1Sender ? getAddress(l1Sender) : undefined;
  const defaultL2From = getAddress('0x0000000000000000000000000000000000000000');

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i++) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !data) continue;

    const normalizedTarget = getAddress(target).toLowerCase();

    // L1CrossDomainMessenger.sendMessage path
    if (messengerAddresses.has(normalizedTarget)) {
      if (
        data === '0x' ||
        data.length < VALIDATION_CONSTANTS.MIN_SEND_MESSAGE_INPUT_LENGTH ||
        slice(data as Hex, 0, 4) !== SEND_MESSAGE_SELECTOR
      ) {
        continue;
      }

      const destinationChainId = getChainIdFromAddress(normalizedTarget, OPTIMISM_MESSENGERS);
      if (!destinationChainId) continue;

      try {
        const { args } = decodeFunctionData({
          abi: SEND_MESSAGE_ABI,
          data: data as Hex,
        });

        const [targetAddress, messageData] = args;
        const message = buildMessageFromDecodedPayload({
          destinationChainId,
          targetAddress,
          messageData: messageData as Hex,
          l2Value: '0',
          l2FromAddress: normalizedSender ?? defaultL2From,
        });

        if (message) {
          messages.push(message);
        }
      } catch {
        // Skip invalid calldata.
      }

      continue;
    }

    // OptimismPortal.depositTransaction path
    if (portalAddresses.has(normalizedTarget)) {
      if (
        data === '0x' ||
        data.length < VALIDATION_CONSTANTS.MIN_DEPOSIT_TRANSACTION_INPUT_LENGTH ||
        slice(data as Hex, 0, 4) !== DEPOSIT_TRANSACTION_SELECTOR
      ) {
        continue;
      }

      const destinationChainId = getChainIdFromAddress(normalizedTarget, OPTIMISM_PORTALS);
      if (!destinationChainId) continue;

      try {
        const { args } = decodeFunctionData({
          abi: DEPOSIT_TRANSACTION_ABI,
          data: data as Hex,
        });

        const [targetAddress, value, _gasLimit, isCreation, messageData] = args;
        if (isCreation) continue;

        const aliasedSender = normalizedSender ? calculateL2Alias(normalizedSender) : defaultL2From;
        const message = buildMessageFromDecodedPayload({
          destinationChainId,
          targetAddress,
          messageData: messageData as Hex,
          l2Value: value.toString(),
          l2FromAddress: aliasedSender,
        });

        if (message) {
          messages.push(message);
        }
      } catch {
        // Skip invalid calldata.
      }
    }
  }

  if (messages.length > 0) {
    console.log(
      `[Optimism Parser] Extracted ${messages.length} L1->L2 message(s) from proposal targets/calldatas.`,
    );
  }

  return messages;
}
