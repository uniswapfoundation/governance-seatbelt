import {
  decodeFunctionData,
  formatUnits,
  getAddress,
  parseAbiItem,
  toFunctionSelector,
} from 'viem';
import type { DecodedCall, ProposalCheck, TenderlyContract, TenderlySimulation } from '../types';
import { decodeFunctionWithAbi } from '../utils/clients/etherscan';
import { getContractNameFromTenderly } from '../utils/clients/tenderly';
import { fetchTokenMetadata } from '../utils/contracts/erc20';

// Cache for decoded function data to avoid redundant decoding
const decodedFunctionCache: Record<string, { name: string; args: unknown[] }> = {};

/**
 * Decodes proposal target calldata into a human-readable format
 */
export const checkDecodeCalldata: ProposalCheck = {
  name: 'Decodes target calldata into a human-readable format',
  async checkProposal(proposal, sim, deps, l2Simulations) {
    const warnings: string[] = [];

    // Check if we're running on L2 and have cross-chain message data available
    const isL2Chain = deps.chainConfig?.chainId !== 1;
    const hasL2Data = l2Simulations && l2Simulations.length > 0;

    if (isL2Chain && hasL2Data) {
      // Handle L2 cross-chain calldata decoding
      return await handleL2CrossChainCalldata(
        l2Simulations,
        sim,
        warnings,
        deps.chainConfig.chainId,
      );
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
    const descriptions = await Promise.all(
      calldatas.map(async (calldata, i) => {
        // Find the first matching call
        let call = findMatchingCall(getAddress(deps.timelock.address), calldata, calls || []);
        if (!call) {
          // If we can't find the call in the trace, add a warning
          // Skip the warning for ETH transfers which might not appear in the trace
          if (!(calldata === '0x' && BigInt(proposal.values?.[i].toString() ?? '0') > 0n)) {
            const msg = `Could not find matching call for target ${proposal.targets[i]} with calldata ${calldata}`;
            warnings.push(msg);
          }

          // Create a synthetic call
          call = {
            from: deps.timelock.address,
            to: proposal.targets[i],
            input: calldata,
            value: proposal.values?.[i].toString() ?? '0',
          } as DecodedCall;
        } else {
          // If we found the call, check for subcalls with the same input data
          call = returnCallOrMatchingSubcall(calldata, call);
        }

        // Get the contract information from the simulation
        const targetAddress = proposal.targets[i];
        const contract = sim.contracts.find(
          (c) => getAddress(c.address) === getAddress(targetAddress),
        );

        return prettifyCalldata(call, targetAddress, warnings, contract, deps.chainConfig.chainId);
      }),
    );

    const info = descriptions.filter((d) => d !== null).map((d) => d);
    return { info, warnings, errors: [] };
  },
};

/**
 * Handle L2 cross-chain calldata decoding using the actual L2 execution data
 */
async function handleL2CrossChainCalldata(
  l2Simulations: Array<{ chainId: number; sim: TenderlySimulation }>,
  sim: TenderlySimulation,
  warnings: string[],
  chainId: number,
) {
  // We need to access the destination simulations to get l2Params
  // Since l2Simulations doesn't include l2Params, we need to get it from the global result
  // For now, let's extract L2 calldata from the simulation traces and decode what we can find

  const allL2Calls: DecodedCall[] = [];

  // Extract calls from all L2 simulations
  for (const l2Sim of l2Simulations) {
    if (l2Sim.sim?.transaction?.transaction_info?.call_trace?.calls) {
      // Find calls that aren't just system calls
      const meaningfulCalls = extractMeaningfulL2Calls(
        l2Sim.sim.transaction.transaction_info.call_trace,
      );
      allL2Calls.push(...meaningfulCalls);
    }
  }

  if (allL2Calls.length === 0) {
    warnings.push('No meaningful L2 execution calls found in cross-chain simulation');
    return { info: [], warnings, errors: [] };
  }

  // Process each meaningful L2 call
  const descriptions = await Promise.all(
    allL2Calls.map(async (call) => {
      // Get contract information from the simulation
      const contract = sim.contracts.find(
        (c: TenderlyContract) => getAddress(c.address) === getAddress(call.to),
      );

      return prettifyCalldata(call, call.to, warnings, contract, chainId);
    }),
  );

  const validDescriptions = descriptions.filter((d) => d !== null);
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
        // Skip Arbitrum system addresses
        const isSystemAddress =
          call.to.toLowerCase().includes('fffff') || call.to.toLowerCase().includes('00000');

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
 * Given an array of calls, find the call matching the provided from address and calldata by
 * recursively traversing all calls in the trace. This is required because the call we're looking
 * for is not always at the same depth of the call stack. If all governor `execute` calls were made
 * from an EOA this would be true, but because calls to `execute` can also be made from contracts
 * we don't know the depth of the call containing `calldata`
 * @dev Using any[] due to incompatible call types (CallTraceCall, DecodedCall) that share common properties
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function findMatchingCall(from: string, calldata: string, calls: any[]): DecodedCall | null {
  const callMatches = (f: string, c: string) =>
    getAddress(f) === getAddress(from) && c === calldata;
  for (const call of calls) {
    if (callMatches(call.from, call.input)) return call;
    if (call.calls) {
      const foundCall = findMatchingCall(from, calldata, call.calls);
      if (foundCall) return foundCall;
    }
  }
  return null;
}

/**
 * Given a call, check if any subcalls have matching calldata. If so, return the deepest call as
 * this will be the decoded call (e.g. if there are proxies the top level call with matching
 * calldata will be the fallback function)
 */
function returnCallOrMatchingSubcall(calldata: string, call: DecodedCall): DecodedCall {
  if (!call.calls || !call.calls?.length) return call;
  return call.calls[0].input === calldata
    ? returnCallOrMatchingSubcall(calldata, call.calls[0] as DecodedCall)
    : call;
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
function formatArgs(args: unknown[]): string {
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

/**
 * Given a call, return a human-readable description of the call
 */
async function prettifyCalldata(
  call: DecodedCall,
  target: string,
  warnings: string[],
  contract: TenderlyContract | undefined,
  chainId: number,
) {
  // Handle ETH transfers (empty calldata with value)
  if (call.input === '0x' && call.value && BigInt(call.value) > 0n) {
    const ethAmount = formatUnits(BigInt(call.value), 18);
    return `\`${call.from}\` transfers ${ethAmount} ETH to \`${target}\` (formatted)`;
  }

  // Get the function selector (first 4 bytes of the calldata)
  const selector = call.input.slice(0, 10);

  // Format the contract identifier using the contract information from the simulation
  const contractIdentifier = contract ? getContractNameFromTenderly(contract) : `\`${target}\``;

  // Check if we have a cached decoded function
  const cacheKey = `${target}-${call.input}`;
  if (decodedFunctionCache[cacheKey]) {
    const decoded = decodedFunctionCache[cacheKey];
    let description = `\`${call.from}\` calls \`${decoded.name}(`;
    const formattedArgs = formatArgs(decoded.args);
    if (formattedArgs) {
      description += formattedArgs;
    }
    description += `)\` on ${contractIdentifier} (decoded from cache)`;
    return description;
  }

  // Try to decode using Etherscan ABI first
  try {
    const decoded = await decodeFunctionWithAbi(target, call.input as `0x${string}`, chainId);
    if (decoded) {
      // Cache the decoded function
      decodedFunctionCache[cacheKey] = decoded;

      // Format the decoded function call
      let description = `\`${call.from}\` calls \`${decoded.name}(`;

      // Format the arguments
      const formattedArgs = formatArgs(decoded.args);

      // Add the arguments to the description (if any)
      if (formattedArgs) {
        description += formattedArgs;
      }

      description += `)\` on ${contractIdentifier} (decoded from ABI)`;
      return description;
    }

    warnings.push(
      `Failed to decode function with selector ${selector} for contract ${target} using Etherscan ABI`,
    );
  } catch (error) {
    console.warn(`Failed to decode using Etherscan ABI for ${target}:`, error);
    warnings.push(
      `Error decoding function with selector ${selector} for contract ${target}: ${error}`,
    );
  }

  // Handle token-related actions
  const isTokenAction = selector in TOKEN_HANDLERS;
  if (isTokenAction) {
    const { symbol, decimals } = await fetchTokenMetadata(call.to as `0x${string}`);
    return TOKEN_HANDLERS[selector](call, decimals || 0, symbol ?? null, contractIdentifier);
  }

  // Generic handling for non-token actions
  const sig = getSignature(call);
  return getDescription(contractIdentifier, sig, call);
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
