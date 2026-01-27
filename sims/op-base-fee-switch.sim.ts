import { encodeFunctionData, getAddress, parseAbi } from 'viem';

import type { SimulationConfigNew } from '../types';
import L2CrossChainAccount from '../utils/abis/L2CrossChainAccount.json' assert { type: 'json' };

/**
 * Example cross-chain governance simulation: "turn on protocol fees" on Uniswap v3 pools
 * on Optimism + Base by sending OP Stack `sendMessage` calls from L1.
 *
 * This models the common pattern:
 * L1 governance → L1CrossDomainMessenger.sendMessage(target=L2CrossChainAccount, message=forward(...))
 * where the L2CrossChainAccount is the owner of the Uniswap v3 factory on that chain.
 */

const L1_CROSS_DOMAIN_MESSENGER_OP = getAddress('0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1');
const L1_CROSS_DOMAIN_MESSENGER_BASE = getAddress('0x866E82a600A1414e583f7F13623F1aC5d58b0Afa');

// Uniswap v3 factory owners on each chain (these are L2CrossChainAccount deployments).
// - Optimism factory owner: 0xa1dD... (owner() of 0x1F9843... on chain 10)
// - Base factory owner:     0x31FA... (owner() of 0x33128a... on chain 8453)
const L2_CROSS_CHAIN_ACCOUNT_OP = getAddress('0xa1dD330d602c32622AA270Ea73d078B803Cb3518');
const L2_CROSS_CHAIN_ACCOUNT_BASE = getAddress('0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9');

// Example pools (WETH/USDC 0.05%) on each chain.
// NOTE: These are illustrative; swap in the actual fee-switch target pools for the meeting if different.
const OP_WETH_USDC_005_POOL = getAddress('0x85149247691df622eaF1a8Bd0CaFd40BC45154a9'); // Optimism WETH/USDC.e 0.05%
const BASE_WETH_USDC_005_POOL = getAddress('0xd0b53D9277642d899DF5C87A3966A349A798F224'); // Base WETH/USDC 0.05%

const poolAbi = parseAbi(['function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1)']);

const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);

// A non-zero protocol fee turns the fee switch "on" for that pool.
// Uniswap v3 pools store both feeProtocol values in slot0; they start at 0 by default.
const FEE_PROTOCOL_0 = 4;
const FEE_PROTOCOL_1 = 4;

const opPoolCall = encodeFunctionData({
  abi: poolAbi,
  functionName: 'setFeeProtocol',
  args: [FEE_PROTOCOL_0, FEE_PROTOCOL_1],
});

const basePoolCall = encodeFunctionData({
  abi: poolAbi,
  functionName: 'setFeeProtocol',
  args: [FEE_PROTOCOL_0, FEE_PROTOCOL_1],
});

const opForward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [OP_WETH_USDC_005_POOL, opPoolCall],
});

const baseForward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [BASE_WETH_USDC_005_POOL, basePoolCall],
});

const callOp = {
  target: L1_CROSS_DOMAIN_MESSENGER_OP,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [L2_CROSS_CHAIN_ACCOUNT_OP, opForward, 1_000_000],
  }),
  value: 0n,
  signature: '',
};

const callBase = {
  target: L1_CROSS_DOMAIN_MESSENGER_BASE,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [L2_CROSS_CHAIN_ACCOUNT_BASE, baseForward, 1_000_000],
  }),
  value: 0n,
  signature: '',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [callOp.target, callBase.target],
  values: [callOp.value, callBase.value],
  signatures: [callOp.signature as `0x${string}`, callBase.signature as `0x${string}`],
  calldatas: [callOp.calldata, callBase.calldata],
  description: `# Fee switch example: Optimism + Base

This simulation models a cross-chain Uniswap governance action that turns on Uniswap v3 protocol fees
on two L2s by sending OP Stack messages from L1.

Actions:
1) Optimism: setFeeProtocol(${FEE_PROTOCOL_0}, ${FEE_PROTOCOL_1}) on ${OP_WETH_USDC_005_POOL}
2) Base: setFeeProtocol(${FEE_PROTOCOL_0}, ${FEE_PROTOCOL_1}) on ${BASE_WETH_USDC_005_POOL}
`,
};
