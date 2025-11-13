import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Enhanced simulation for Ink cross-chain functionality.
 * This simulation tests basic cross-chain messaging with WETH operations and verified contract interaction.
 */

// Contract addresses
const L1_CROSS_DOMAIN_MESSENGER_INK: Address = '0x69d3cf86b2bf1a9e99875b7e2d9b6a84426c171f';

// L2 contracts on Ink
const L2_WETH_INK: Address = '0x4200000000000000000000000000000000000006'; // WETH on L2
const L2_COUNTER_INK: Address = '0x000998eBFE4866021b5D3F6B44b1e2fdF447A28E'; // Verified counter contract

// Test recipient for WETH transfer
const TEST_RECIPIENT: Address = '0x1234567890123456789012345678901234567890';

// Amounts for transfers
const WETH_AMOUNT = 100000000000000000n; // 0.1 WETH

// Simple deposit() function selector for WETH
const depositMessage = '0xd0e30db0' as const;

// Encode WETH transfer to test recipient
// transfer(address to, uint256 amount)
const wethTransferCalldata = encodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }],
  [TEST_RECIPIENT, WETH_AMOUNT],
);

// Encode counter read function
// x() function selector: 0x0c55699c
const counterReadCalldata = '0x0c55699c' as const;

// Call 1: Send WETH deposit to Ink
const call1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_INK,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_WETH_INK, depositMessage, 1000000], // 1M gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 2: Send WETH transfer to test recipient
const call2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_INK,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_WETH_INK, wethTransferCalldata, 1500000], // 1.5M gas for transfer
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 3: Read from verified counter contract on Ink
const call3 = {
  target: L1_CROSS_DOMAIN_MESSENGER_INK,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_COUNTER_INK, counterReadCalldata, 500000], // 500K gas for read
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'InkBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Using Uniswap governor for testing
  governorType: 'bravo',
  targets: [call1.target, call2.target, call3.target],
  values: [call1.value, call2.value, call3.value],
  signatures: [
    call1.signature as `0x${string}`,
    call2.signature as `0x${string}`,
    call3.signature as `0x${string}`,
  ],
  calldatas: [call1.calldata, call2.calldata, call3.calldata],
  description: `# Enhanced Ink Bridge Test with WETH Operations and Verified Contract

This proposal tests the Ink bridge integration with basic cross-chain messaging, WETH operations, and verified contract interaction.

## Actions

### 1. WETH Deposit
- **Target**: WETH contract on Ink (0x4200000000000000000000000000000000000006)
- **Action**: Call deposit() function to mint WETH
- **Gas**: 1,000,000 for message execution

### 2. WETH Transfer
- **Target**: WETH contract on Ink
- **Action**: Transfer 0.1 WETH to test recipient
- **Gas**: 1,500,000 for transfer execution
- **Recipient**: 0x1234567890123456789012345678901234567890

### 3. Counter Contract Read
- **Target**: Verified Counter contract on Ink (0x000998eBFE4866021b5D3F6B44b1e2fdF447A28E)
- **Action**: Read the counter value (x() function)
- **Gas**: 500,000 for read operation
- **Purpose**: Test Blockscout verification for verified contracts

## Expected Events
- Cross-chain message events from L1CrossDomainMessenger
- WETH deposit events on Ink
- WETH transfer events to recipient
- Counter read operation (should show as verified on Blockscout)

## Gas Usage
- **Total L1 Gas**: ~3,000,000 (3 cross-chain messages)
- **Total L2 Gas**: ~3,000,000 (deposit + transfer + read)

This simulation tests cross-chain messaging, basic WETH operations, and verified contract interaction on the Ink network.`,
};
