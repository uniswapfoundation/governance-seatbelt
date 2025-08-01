import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Enhanced simulation for Soneium cross-chain functionality.
 * This simulation tests basic cross-chain messaging with WETH operations and verified contract interaction.
 */

// Contract addresses
const L1_CROSS_DOMAIN_MESSENGER_SONEIUM: Address = '0x9cf951e3f74b644e621b36ca9cea147a78d4c39f';

// L2 contracts on Soneium
const L2_WETH_SONEIUM: Address = '0x4200000000000000000000000000000000000006'; // WETH on L2
const L2_COUNTER_SONEIUM: Address = '0x2C3491999d2140F5d5250066aa9556772dbbfbB2'; // Verified counter contract

// Simple deposit() function selector for WETH
const depositMessage = '0xd0e30db0' as const;

// Encode counter read function
// count() function selector: 0x06661abd
const counterReadCalldata = '0x06661abd' as const;

// Call 1: Send WETH deposit to Soneium
const call1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_SONEIUM,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_WETH_SONEIUM, depositMessage, 1000000], // 1M gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 2: Read from verified counter contract on Soneium
const call2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_SONEIUM,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_COUNTER_SONEIUM, counterReadCalldata, 500000], // 500K gas for read
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'SoneiumBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call1.target, call2.target],
  values: [call1.value, call2.value],
  signatures: [call1.signature as `0x${string}`, call2.signature as `0x${string}`],
  calldatas: [call1.calldata, call2.calldata],
  description: `# Soneium Bridge Test

This proposal tests the Soneium bridge integration with basic cross-chain messaging and verified contract interaction.

## Actions

### 1. WETH Deposit
- **Target**: WETH contract on Soneium (0x4200000000000000000000000000000000000006)
- **Action**: Call deposit() function to mint WETH
- **Gas**: 1,000,000 for message execution

### 2. Counter Contract Read
- **Target**: Verified counter contract on Soneium (0x2C3491999d2140F5d5250066aa9556772dbbfbB2)
- **Action**: Read counter value
- **Gas**: 500,000 for read execution

This test validates cross-chain message passing to Soneium L2.`,
};
