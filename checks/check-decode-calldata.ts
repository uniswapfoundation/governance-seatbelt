import {
  decodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseAbiItem,
  toFunctionSelector,
} from 'viem';
import type {
  DecodedCall,
  ProposalCheck,
  ProposalData,
  TenderlyContract,
  TenderlySimulation,
} from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { getContractNameFromTenderly } from '../utils/clients/tenderly';
import { fetchTokenMetadata } from '../utils/contracts/erc20';
import { detectProxy } from '../utils/contracts/proxy';

// Keep this small to avoid rate limiting and reduce ABI/metadata lookup fan-out.
// If decoding becomes a bottleneck, tune this constant.
const DECODE_CONCURRENCY = 2;

const KNOWN_SIGNATURE_FALLBACKS: Record<string, string[]> = {
  [toFunctionSelector('sendMessage(address,bytes,uint32)')]: [
    'function sendMessage(address target, bytes message, uint32 gasLimit)',
  ],
  [toFunctionSelector('depositTransaction(address,uint256,uint64,bool,bytes)')]: [
    'function depositTransaction(address to, uint256 value, uint64 gasLimit, bool isCreation, bytes data)',
  ],
  [toFunctionSelector(
    'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  )]: [
    'function createRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data)',
  ],
  [toFunctionSelector(
    'createRetryableTicketNoRefundAliasRewrite(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  )]: [
    'function createRetryableTicketNoRefundAliasRewrite(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data)',
  ],
  [toFunctionSelector(
    'unsafeCreateRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  )]: [
    'function unsafeCreateRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data)',
  ],
  [toFunctionSelector(
    'uniswapCreateRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
  )]: [
    'function uniswapCreateRetryableTicket(address to, uint256 l2CallValue, uint256 maxSubmissionCost, address excessFeeRefundAddress, address callValueRefundAddress, uint256 gasLimit, uint256 maxFeePerGas, bytes data)',
  ],
  [toFunctionSelector('sendL1FundedContractTransaction(uint256,uint256,address,bytes)')]: [
    'function sendL1FundedContractTransaction(uint256 gasLimit, uint256 maxFeePerGas, address destination, bytes data)',
  ],
  [toFunctionSelector('sendL1FundedUnsignedTransaction(uint256,uint256,address,bytes)')]: [
    'function sendL1FundedUnsignedTransaction(uint256 gasLimit, uint256 maxFeePerGas, address destination, bytes data)',
  ],
  [toFunctionSelector('sendL1FundedUnsignedTransactionToFork(uint256,uint256,address,bytes)')]: [
    'function sendL1FundedUnsignedTransactionToFork(uint256 gasLimit, uint256 maxFeePerGas, address destination, bytes data)',
  ],
  [toFunctionSelector('sendContractTransaction(uint256,uint256,address,uint256,bytes)')]: [
    'function sendContractTransaction(uint256 gasLimit, uint256 maxFeePerGas, address destination, uint256 amount, bytes data)',
  ],
  [toFunctionSelector('sendUnsignedTransaction(uint256,uint256,address,uint256,bytes)')]: [
    'function sendUnsignedTransaction(uint256 gasLimit, uint256 maxFeePerGas, address destination, uint256 amount, bytes data)',
  ],
  [toFunctionSelector('sendUnsignedTransactionToFork(uint256,uint256,address,uint256,bytes)')]: [
    'function sendUnsignedTransactionToFork(uint256 gasLimit, uint256 maxFeePerGas, address destination, uint256 amount, bytes data)',
  ],
  [toFunctionSelector('receiveMessage(bytes)')]: ['function receiveMessage(bytes whMessage)'],
  [toFunctionSelector('parseAndVerifyVM(bytes)')]: ['function parseAndVerifyVM(bytes encodedVM)'],
  [toFunctionSelector('forward(address,bytes)')]: ['function forward(address target, bytes data)'],
  [toFunctionSelector('setOwner(address)')]: ['function setOwner(address owner)'],
  [toFunctionSelector('setFeeTo(address)')]: ['function setFeeTo(address feeTo)'],
};

type MatchKind =
  | 'strict-from-calldata'
  | 'target-calldata'
  | 'calldata-only'
  | 'target-selector-order'
  | 'selector-order';

type DecodeSource = 'abi' | 'signature' | 'token' | 'generic' | 'eth-transfer';

type CalldataDescriptionResult = {
  description: string;
  decodeSource: DecodeSource;
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid concurrency: ${concurrency}`);
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Decodes proposal target calldata into a human-readable format
 */
export const checkDecodeCalldata: ProposalCheck = {
  name: 'Decodes target calldata into a human-readable format',
  async checkProposal(proposal, sim, deps, _l2Simulations) {
    const warnings: string[] = [];

    // Check if we're running on L2 and have cross-chain message data available
    const isL2Chain = deps.chainConfig?.chainId !== 1;

    if (isL2Chain) {
      // Handle L2 calldata decoding (destination simulation for this chain only)
      return await handleL2CrossChainCalldata(sim, warnings, deps);
    }

    // Handle regular L1 calldata decoding (existing logic)
    // Generate the raw calldata for each proposal action
    const calldatas = proposal.signatures.map((sig, i) => {
      return sig
        ? `${toFunctionSelector(sig)}${proposal.calldatas[i].slice(2)}`
        : proposal.calldatas[i];
    });

    // Find the call with that calldata and parse it
    const calls = sim.transaction.transaction_info.call_trace.calls;
    const flattenedCalls = flattenCalls(calls || []);
    const selectorOrdinalByAction = computeSelectorOrdinals(proposal.targets, calldatas);
    const warningsByCalldataIndex: string[][] = Array.from({ length: calldatas.length }, () => []);
    const advisoryByCalldataIndex: string[][] = Array.from({ length: calldatas.length }, () => []);

    const descriptions = await mapWithConcurrency(
      calldatas,
      DECODE_CONCURRENCY,
      async (calldata, i) => {
        const localWarnings = warningsByCalldataIndex[i];
        const localAdvisories = advisoryByCalldataIndex[i];
        const targetAddress = proposal.targets[i];

        const match = findMatchingCallWithFallback(
          getAddress(deps.timelock.address),
          getAddress(targetAddress),
          calldata,
          flattenedCalls,
          selectorOrdinalByAction[i],
        );

        let call: DecodedCall;
        let traceMatchWarning: string | null = null;

        if (!match) {
          if (!(calldata === '0x' && BigInt(proposal.values?.[i].toString() ?? '0') > 0n)) {
            traceMatchWarning = `Could not find matching call for target ${targetAddress} with calldata ${calldata}`;
          }

          call = {
            from: deps.timelock.address,
            to: targetAddress,
            input: calldata,
            value: proposal.values?.[i].toString() ?? '0',
          };
        } else {
          call = match.call;
        }

        const contract = sim.contracts.find(
          (c) => getAddress(c.address) === getAddress(targetAddress),
        );

        const descriptionResult = await prettifyCalldata(
          call,
          targetAddress,
          localWarnings,
          contract,
          deps,
          BigInt(sim.transaction.block_number),
        );

        if (traceMatchWarning) {
          if (['abi', 'signature', 'token'].includes(descriptionResult.decodeSource)) {
            localAdvisories.push(
              `Advisory: no exact trace match for target ${targetAddress}; decoded calldata via ${descriptionResult.decodeSource} fallback.`,
            );
          } else {
            localWarnings.push(traceMatchWarning);
          }
        } else if (match && match.kind !== 'strict-from-calldata') {
          localAdvisories.push(
            `Advisory: matched target ${targetAddress} calldata using ${match.kind.replaceAll('-', ' ')} heuristic.`,
          );
        }

        return descriptionResult.description;
      },
    );

    for (const localWarnings of warningsByCalldataIndex) warnings.push(...localWarnings);

    const info: string[] = [];
    for (let i = 0; i < descriptions.length; i++) {
      info.push(...advisoryByCalldataIndex[i]);
      if (descriptions[i]) info.push(descriptions[i]);
    }
    return { info, warnings, errors: [] };
  },
};

/**
 * Handle L2 cross-chain calldata decoding using the actual L2 execution data
 */
async function handleL2CrossChainCalldata(
  sim: TenderlySimulation,
  warnings: string[],
  deps: ProposalData,
) {
  const allL2Calls: DecodedCall[] = [];

  // Extract calls from this destination simulation only
  const trace = sim.transaction.transaction_info.call_trace;
  if (trace) allL2Calls.push(...extractMeaningfulL2Calls(trace));

  if (allL2Calls.length === 0) {
    warnings.push('No meaningful L2 execution calls found in cross-chain simulation');
    return { info: [], warnings, errors: [] };
  }

  // Process each meaningful L2 call
  const warningsByCallIndex: string[][] = Array.from({ length: allL2Calls.length }, () => []);
  const descriptions = await mapWithConcurrency(allL2Calls, DECODE_CONCURRENCY, async (call, i) => {
    const localWarnings = warningsByCallIndex[i];

    // Get contract information from the simulation
    const contract = sim.contracts.find(
      (c: TenderlyContract) => getAddress(c.address) === getAddress(call.to),
    );

    return prettifyCalldata(
      call,
      call.to,
      localWarnings,
      contract,
      deps,
      BigInt(sim.transaction.block_number),
    );
  });

  for (const localWarnings of warningsByCallIndex) warnings.push(...localWarnings);

  const validDescriptions = descriptions.map((d) => d.description).filter((d) => d !== null);
  if (validDescriptions.length === 0) {
    warnings.push('Could not decode any L2 cross-chain execution calls');
    return { info: [], warnings, errors: [] };
  }

  return {
    info: validDescriptions,
    warnings,
    errors: [],
  };
}

/**
 * Extract meaningful L2 calls from the call trace, filtering out system calls
 */
function extractMeaningfulL2Calls(
  callTrace: TenderlySimulation['transaction']['transaction_info']['call_trace'],
): DecodedCall[] {
  const meaningfulCalls: DecodedCall[] = [];

  // biome-ignore lint/suspicious/noExplicitAny: Complex nested Tenderly types make this difficult to type precisely
  function traverseCalls(calls: any[]): void {
    for (const call of calls || []) {
      // Skip system addresses and empty calls
      if (call.to && call.input && call.input !== '0x') {
        // Skip common precompile/system address ranges (but keep OP Stack predeploys like 0x4200...)
        const normalizedTo = call.to.toLowerCase();
        const isLowPrecompileAddress = /^0x0{38}[0-9a-f]{2}$/.test(normalizedTo); // 0x...00xx
        const isSystemAddress = normalizedTo.startsWith('0xfffff') || isLowPrecompileAddress;

        if (!isSystemAddress) {
          meaningfulCalls.push({
            from: call.from,
            to: call.to,
            input: call.input,
            value: call.value || '0',
            function_name: call.function_name,
            decoded_input: call.decoded_input,
            decoded_output: call.decoded_output,
            calls: call.calls,
          } as DecodedCall);
        }
      }

      // Recursively check subcalls
      if (call.calls) {
        traverseCalls(call.calls);
      }
    }
  }

  traverseCalls([callTrace]);
  return meaningfulCalls;
}

// --- Helper methods ---

/**
 * Flatten nested call traces preserving traversal order.
 */
type TraceCallLike = {
  from?: string;
  to?: string;
  input?: string;
  value?: string;
  calls?: DecodedCall[];
  function_name?: string;
  decoded_input?: DecodedCall['decoded_input'];
  decoded_output?: DecodedCall['decoded_output'];
};

function isTraceCallLike(value: unknown): value is TraceCallLike {
  return typeof value === 'object' && value !== null;
}

function flattenCalls(calls: readonly unknown[]): DecodedCall[] {
  const flattened: DecodedCall[] = [];

  const traverse = (nodes: readonly unknown[]) => {
    for (const node of nodes) {
      if (!isTraceCallLike(node)) continue;

      if (
        typeof node.from === 'string' &&
        typeof node.to === 'string' &&
        typeof node.input === 'string'
      ) {
        flattened.push({
          from: node.from,
          to: node.to,
          input: node.input,
          value: node.value ?? '0',
          calls: node.calls,
          function_name: node.function_name,
          decoded_input: node.decoded_input,
          decoded_output: node.decoded_output,
        });
      }

      if (Array.isArray(node.calls) && node.calls.length > 0) {
        traverse(node.calls);
      }
    }
  };

  traverse(calls);
  return flattened;
}

/**
 * Compute per-action ordinal for (target, selector) pairs so we can choose stable fallback matches.
 */
function computeSelectorOrdinals(
  targets: readonly string[],
  calldatas: readonly string[],
): number[] {
  const ordinalByKey = new Map<string, number>();

  return calldatas.map((calldata, index) => {
    const target = getAddress(targets[index]).toLowerCase();
    const selector = calldata.slice(0, 10).toLowerCase();
    const key = `${target}:${selector}`;
    const current = ordinalByKey.get(key) ?? 0;
    ordinalByKey.set(key, current + 1);
    return current;
  });
}

function addressesEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function findMatchingCallWithFallback(
  from: string,
  target: string,
  calldata: string,
  flattenedCalls: readonly DecodedCall[],
  targetSelectorOrdinal: number,
): { call: DecodedCall; kind: MatchKind } | null {
  const selector = calldata.slice(0, 10).toLowerCase();

  const findLastCall = (predicate: (call: DecodedCall) => boolean): DecodedCall | null => {
    for (let i = flattenedCalls.length - 1; i >= 0; i--) {
      if (predicate(flattenedCalls[i])) return flattenedCalls[i];
    }
    return null;
  };

  const strict = flattenedCalls.filter(
    (call) =>
      addressesEqual(call.from, from) &&
      addressesEqual(call.to, target) &&
      call.input.slice(0, 10).toLowerCase() === selector,
  )[targetSelectorOrdinal];
  if (strict?.input === calldata) return { call: strict, kind: 'strict-from-calldata' };

  const targetAndCalldata = findLastCall(
    (call) => addressesEqual(call.to, target) && call.input === calldata,
  );
  if (targetAndCalldata) return { call: targetAndCalldata, kind: 'target-calldata' };

  const calldataOnly = findLastCall((call) => call.input === calldata);
  if (calldataOnly) return { call: calldataOnly, kind: 'calldata-only' };

  const targetSelectorMatches = flattenedCalls.filter(
    (call) => addressesEqual(call.to, target) && call.input.slice(0, 10).toLowerCase() === selector,
  );
  if (targetSelectorMatches.length > 0) {
    const ordinal = Math.min(targetSelectorOrdinal, targetSelectorMatches.length - 1);
    return { call: targetSelectorMatches[ordinal], kind: 'target-selector-order' };
  }

  const selectorMatches = flattenedCalls.filter(
    (call) => call.input.slice(0, 10).toLowerCase() === selector,
  );
  if (selectorMatches.length > 0) {
    const ordinal = Math.min(targetSelectorOrdinal, selectorMatches.length - 1);
    return { call: selectorMatches[ordinal], kind: 'selector-order' };
  }

  return null;
}

/**
 * Follow proxy delegation, including implementations changed earlier in the simulation.
 * Ordinary calls with identical calldata are not proxy implementations.
 */
function returnCallOrMatchingSubcall(calldata: string, call: DecodedCall): DecodedCall {
  const delegated = call.calls?.find(
    (child) =>
      child.input === calldata && (child.call_type ?? child.type)?.toUpperCase() === 'DELEGATECALL',
  );
  return delegated ? returnCallOrMatchingSubcall(calldata, delegated) : call;
}

/**
 * Given a call, generate a human-readable function signature
 */
function getSignature(call: DecodedCall) {
  // Return selector if call is not decoded, otherwise generate the signature
  if (!call.function_name) return call.input.slice(0, 10);
  let sig = `${call.function_name}(`;
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic decoded values from DecodedCall interface
  call.decoded_input?.forEach((arg: any, i: number) => {
    if (i !== 0) sig += ', ';
    sig += arg.soltype.type;
    sig += arg.soltype.name ? ` ${arg.soltype.name}` : '';
  });
  sig += ')(';
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic decoded values from DecodedCall interface
  call.decoded_output?.forEach((arg: any, i: number) => {
    if (i !== 0) sig += ', ';
    sig += arg.soltype.type;
    sig += arg.soltype.name ? ` ${arg.soltype.name}` : '';
  });
  sig += ')';
  return sig;
}

/**
 * Given a target, signature, and call, generate a human-readable description
 */
function getDescription(contractIdentifier: string, sig: string, call: DecodedCall) {
  let description = `On contract ${contractIdentifier}, call `;

  // If the call is not decoded, provide a generic description
  if (!call.decoded_input) {
    return `${description} \`${call.input}\` (not decoded)`;
  }

  description += `\`${sig}\` with arguments `;
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic decoded values from DecodedCall interface
  call.decoded_input?.forEach((arg: any, i: number) => {
    if (i !== 0) description += ', ';
    description += '`';
    description += arg.soltype.name ? `${arg.soltype.name}=` : '';
    description += arg.value;
    description += '`';
  });

  return `${description} (generic)`;
}

/**
 * Format arguments for human-readable display
 */
function formatArgs(args: readonly unknown[]): string {
  if (!args.length) return '';

  // If there's only one argument and it's undefined, return an empty string
  if (args.length === 1 && args[0] === undefined) {
    return '';
  }

  return args
    .map((arg) => {
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'bigint') {
        return arg.toString();
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          // Handle objects with BigInt values by converting them to strings
          return JSON.stringify(arg, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          );
        } catch {
          // If JSON.stringify fails, return a simple string representation
          return '[Complex Object]';
        }
      }
      return String(arg);
    })
    .join(', ');
}

function formatTransportCallDescription(
  functionName: string,
  args: readonly unknown[],
  call: DecodedCall,
  contractIdentifier: string,
): string | null {
  if (functionName === 'receiveMessage') {
    return `\`${call.from}\` calls \`receiveMessage(bytes)\` on ${contractIdentifier} (decoded from signature)`;
  }

  if (functionName === 'parseAndVerifyVM') {
    return `\`${call.from}\` calls \`parseAndVerifyVM(bytes)\` on ${contractIdentifier} (decoded from signature)`;
  }

  if (functionName === 'forward') {
    const [forwardTarget] = args;
    const targetLabel =
      typeof forwardTarget === 'string' && isAddress(forwardTarget)
        ? getAddress(forwardTarget)
        : 'target';
    return `\`${call.from}\` calls \`forward(${targetLabel}, bytes)\` on ${contractIdentifier} (decoded from signature)`;
  }

  return null;
}

/**
 * Given a call, return a human-readable description of the call
 */
async function prettifyCalldata(
  call: DecodedCall,
  target: string,
  warnings: string[],
  contract: TenderlyContract | undefined,
  deps: ProposalData,
  blockNumber: bigint,
): Promise<CalldataDescriptionResult> {
  const chainId = deps.chainConfig.chainId;
  const implementationCall = returnCallOrMatchingSubcall(call.input, call);
  // Handle ETH transfers (empty calldata with value)
  if (call.input === '0x' && call.value && BigInt(call.value) > 0n) {
    const ethAmount = formatUnits(BigInt(call.value), 18);
    return {
      description: `\`${call.from}\` transfers ${ethAmount} ETH to \`${target}\` (formatted)`,
      decodeSource: 'eth-transfer',
    };
  }

  // Get the function selector (first 4 bytes of the calldata)
  const selector = call.input.slice(0, 10);

  // Format the contract identifier using the contract information from the simulation
  const contractIdentifier = contract ? getContractNameFromTenderly(contract) : `\`${target}\``;

  // Try to decode using block explorer ABI first
  let abiDecodeError: string | null = null;
  try {
    let decoded = await BlockExplorerFactory.decodeFunctionWithAbi(
      target,
      call.input as `0x${string}`,
      chainId,
    );
    let implementation: string | null = null;
    if (!decoded) {
      if (implementationCall !== call) {
        implementation = implementationCall.to;
      } else {
        const proxy = await detectProxy(getAddress(target), deps.publicClient, blockNumber);
        if (proxy.kind !== 'none') implementation = proxy.implementation;
      }
      if (implementation) {
        decoded = await BlockExplorerFactory.decodeFunctionWithAbi(
          implementation,
          call.input,
          chainId,
        );
      }
    }

    if (decoded) {
      let description = `\`${call.from}\` calls \`${decoded.name}(`;
      const formattedArgs = formatArgs(decoded.args);
      if (formattedArgs) {
        description += formattedArgs;
      }

      description += implementation
        ? `)\` on ${contractIdentifier} (decoded from implementation ABI at \`${implementation}\`)`
        : `)\` on ${contractIdentifier} (decoded from ABI)`;
      return { description, decodeSource: 'abi' };
    }

    abiDecodeError = `Failed to decode function with selector ${selector} for contract ${target} using block explorer ABI`;
  } catch {
    abiDecodeError = `Could not resolve or decode implementation for contract ${target} with selector ${selector}`;
  }

  // Fallback: decode using known function signatures (useful for proxies where ABI lookup fails)
  const knownAbiItems = KNOWN_SIGNATURE_FALLBACKS[selector] ?? [];
  if (knownAbiItems.length > 0) {
    for (const knownAbiItem of knownAbiItems) {
      try {
        const parsed = parseAbiItem(knownAbiItem);
        if (parsed.type !== 'function') {
          continue;
        }
        const { args } = decodeFunctionData({
          abi: [parsed],
          data: call.input as `0x${string}`,
        });

        const fnName = parsed.name;

        const transportDescription = formatTransportCallDescription(
          fnName,
          args,
          call,
          contractIdentifier,
        );
        if (transportDescription) {
          return { description: transportDescription, decodeSource: 'signature' };
        }

        let description = `\`${call.from}\` calls \`${fnName}(`;
        const formattedArgs = formatArgs(args);
        if (formattedArgs) description += formattedArgs;
        description += `)\` on ${contractIdentifier} (decoded from signature)`;
        return { description, decodeSource: 'signature' };
      } catch {
        // Try next known candidate for this selector.
      }
    }
  }

  // Handle token-related actions
  const isTokenAction = selector in TOKEN_HANDLERS;
  if (isTokenAction) {
    const { symbol, decimals } = await fetchTokenMetadata(call.to as `0x${string}`);
    return {
      description: TOKEN_HANDLERS[selector](
        call,
        decimals || 0,
        symbol ?? null,
        contractIdentifier,
      ),
      decodeSource: 'token',
    };
  }

  if (abiDecodeError) warnings.push(abiDecodeError);

  const sig = getSignature(implementationCall);
  return {
    description: getDescription(contractIdentifier, sig, implementationCall),
    decodeSource: 'generic',
  };
}

// Handlers for token-related function calls
const TOKEN_HANDLERS: Record<
  string,
  (call: DecodedCall, decimals: number, symbol: string | null, contractIdentifier: string) => string
> = {
  [toFunctionSelector('approve(address,uint256)')]: (
    call: DecodedCall,
    decimals: number,
    symbol: string | null,
    contractIdentifier: string,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function approve(address spender, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [spender, value] = args;
    return `\`${call.from}\` approves \`${getAddress(spender)}\` to spend ${formatUnits(value, decimals)} ${symbol} on ${contractIdentifier} (formatted)`;
  },
  [toFunctionSelector('transfer(address,uint256)')]: (
    call: DecodedCall,
    decimals: number,
    symbol: string | null,
    contractIdentifier: string,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function transfer(address to, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [to, value] = args;
    return `\`${call.from}\` transfers ${formatUnits(value, decimals)} ${symbol} to \`${getAddress(to)}\` on ${contractIdentifier} (formatted)`;
  },
  [toFunctionSelector('transferFrom(address,address,uint256)')]: (
    call: DecodedCall,
    decimals: number,
    symbol: string | null,
    contractIdentifier: string,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function transferFrom(address from, address to, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [from, to, value] = args;
    return `\`${call.from}\` transfers ${formatUnits(value, decimals)} ${symbol} from \`${getAddress(from)}\` to \`${getAddress(to)}\` on ${contractIdentifier} (formatted)`;
  },
};
