import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Test simulation for Optimism bridge functionality.
 * This simulation sends ETH from mainnet to both OP Mainnet and Base.
 */

const L1_CROSS_DOMAIN_MESSENGER_OP: Address = '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1';
const L1_CROSS_DOMAIN_MESSENGER_BASE: Address = '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa';

// Use the same L2 recipient as successful tx 0x9021641e61b6d20a78b2c6aaf6cb77a1629ad6f86d26e9d73453f59dcf39b655
const L2_RECIPIENT_OP: Address = '0x4200000000000000000000000000000000000006'; // Same as successful tx
const L2_RECIPIENT_BASE: Address = '0x4200000000000000000000000000000000000006'; // Use same for Base

// Use the exact same simple message pattern as successful tx 0x9021641e61b6d20a78b2c6aaf6cb77a1629ad6f86d26e9d73453f59dcf39b655
// This is just deposit() function selector - 0xd0e30db0
const testMessage = '0xd0e30db0' as const;

// Based on successful tx 0x9021641e61b6d20a78b2c6aaf6cb77a1629ad6f86d26e9d73453f59dcf39b655
// Optimism sendMessage calls use 0 ETH value - gas is paid differently than Arbitrum
const l2GasPayment = 0n; // Optimism doesn't require ETH payment for sendMessage

// Encode the sendMessage calls using the working pattern from OptimismExample.sol
// Use abi.encode() pattern with string signature like the working example
const call1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_OP,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT_OP, testMessage, 1000000], // Fixed: uint32 gas limit, not uint256
  ),
  value: l2GasPayment,
  signature: 'sendMessage(address,bytes,uint32)', // Fixed: uint32 not uint256
};

const call2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_BASE,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT_BASE, testMessage, 1000000], // Fixed: uint32 gas limit, not uint256
  ),
  value: l2GasPayment,
  signature: 'sendMessage(address,bytes,uint32)', // Fixed: uint32 not uint256
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'OptimismBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Using Uniswap governor for testing
  governorType: 'bravo',
  targets: [call1.target, call2.target],
  values: [call1.value, call2.value],
  signatures: [call1.signature as `0x${string}`, call2.signature as `0x${string}`],
  calldatas: [call1.calldata, call2.calldata],
  description: `# Optimism Bridge Test

This proposal tests the Optimism bridge integration by sending messages to both OP Mainnet and Base.

## Actions
1. Send message to ${L2_RECIPIENT_OP} on OP Mainnet
2. Send message to ${L2_RECIPIENT_BASE} on Base

Both messages use a gas limit of 1,000,000.`,
};
