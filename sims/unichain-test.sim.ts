import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Test simulation for Unichain cross-chain functionality.
 * This simulation sends ETH from mainnet to Unichain via the L1CrossDomainMessenger.
 */

const L1_CROSS_DOMAIN_MESSENGER_UNICHAIN: Address = '0x9A3D64E386C18Cb1d6d5179a9596A4B5736e98A6';

// Use WETH on L2 as the recipient - standard address across OP Stack chains
const L2_RECIPIENT: Address = '0x4200000000000000000000000000000000000006'; // WETH on L2

// Simple deposit() function selector for WETH
const testMessage = '0xd0e30db0' as const;

// Encode the sendMessage call for Unichain
const call = {
  target: L1_CROSS_DOMAIN_MESSENGER_UNICHAIN,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT, testMessage, 1000000], // 1M gas limit
  ),
  value: 0n, // Optimism-style bridges don't require ETH for gas
  signature: 'sendMessage(address,bytes,uint32)', // Standard OP Stack signature
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'UnichainBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Using Uniswap governor for testing
  governorType: 'bravo',
  targets: [call.target],
  values: [call.value],
  signatures: [call.signature as `0x${string}`],
  calldatas: [call.calldata],
  description: `# Unichain Bridge Test

This proposal tests the Unichain bridge integration by sending a message from Ethereum mainnet to Unichain.

## Actions
1. Send message to ${L2_RECIPIENT} (WETH) on Unichain via L1CrossDomainMessenger

The message calls the deposit() function with a gas limit of 1,000,000.

This is a test simulation to verify cross-chain message passing to Unichain works correctly.`,
};
