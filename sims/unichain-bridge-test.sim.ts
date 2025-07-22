import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Simplified simulation for Unichain cross-chain functionality.
 * This simulation focuses on cross-chain messaging, multisend operations, and swaps.
 */

// Contract addresses
const L1_CROSS_DOMAIN_MESSENGER_UNICHAIN: Address = '0x9A3D64E386C18Cb1d6d5179a9596A4B5736e98A6';

// L2 recipient on Unichain (WETH address)
const L2_RECIPIENT_UNICHAIN: Address = '0x4200000000000000000000000000000000000006';

// Multisend contract on Unichain
const MULTISEND_CONTRACT_UNICHAIN: Address = '0xA686afDd83Be95E6CFde9e8Cf21af3E297cDF184';

// Uniswap V2 Router on Unichain
const UNISWAP_V2_ROUTER_UNICHAIN: Address = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// USDC address on Unichain
const USDC_UNICHAIN: Address = '0x078D782b760474a361dDA0AF3839290b0EF57AD6';

// Simple test message (deposit function)
const testMessage = '0xd0e30db0' as const;

// Multisend data: send WETH to 2 addresses
// Recipient 1: 0x1234567890123456789012345678901234567890
// Recipient 2: 0x0987654321098765432109876543210987654321
// Amount: 0.1 WETH each (100000000000000000 wei)
const recipient1 = '0x1234567890123456789012345678901234567890';
const recipient2 = '0x0987654321098765432109876543210987654321';
const wethAmount = 100000000000000000n; // 0.1 WETH

// Encode multisend call data
// multisend(bytes[] calldata transactions)
const multisendCalldata = encodeAbiParameters(
  [{ type: 'bytes[]' }],
  [
    [
      // Transaction 1: transfer WETH to recipient1
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [recipient1, wethAmount]),
      // Transaction 2: transfer WETH to recipient2
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [recipient2, wethAmount]),
    ],
  ],
);

// Encode WETH approval for Uniswap V2 Router
// approve(address spender, uint256 amount)
const wethApprovalCalldata = encodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }],
  [UNISWAP_V2_ROUTER_UNICHAIN, 1000000000000000000n], // Approve 1 WETH
);

// Encode swapExactTokensForTokens for WETH to USDC swap
// swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
const swapCalldata = encodeAbiParameters(
  [
    { type: 'uint256' }, // amountIn
    { type: 'uint256' }, // amountOutMin
    { type: 'address[]' }, // path
    { type: 'address' }, // to
    { type: 'uint256' }, // deadline
  ],
  [
    50000000000000000n, // 0.05 WETH
    0n, // amountOutMin (0 for testing)
    [L2_RECIPIENT_UNICHAIN, USDC_UNICHAIN], // WETH -> USDC path
    '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', // recipient (timelock)
    1753298783n, // deadline
  ],
);

// Call 1: Send cross-chain message to Unichain (WETH deposit)
const call1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_UNICHAIN,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT_UNICHAIN, testMessage, 1000000],
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 2: Send WETH approval to Uniswap V2 Router
const call2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_UNICHAIN,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT_UNICHAIN, wethApprovalCalldata, 1500000], // WETH approval
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 3: Send multisend operation to Unichain
const call3 = {
  target: L1_CROSS_DOMAIN_MESSENGER_UNICHAIN,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [MULTISEND_CONTRACT_UNICHAIN, multisendCalldata, 2000000], // Higher gas for multisend
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Call 4: Send swap operation to Uniswap V2 Router
const call4 = {
  target: L1_CROSS_DOMAIN_MESSENGER_UNICHAIN,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [UNISWAP_V2_ROUTER_UNICHAIN, swapCalldata, 2500000], // Higher gas for swap
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'UnichainBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call1.target, call2.target, call3.target, call4.target],
  values: [call1.value, call2.value, call3.value, call4.value],
  signatures: [
    call1.signature as `0x${string}`,
    call2.signature as `0x${string}`,
    call3.signature as `0x${string}`,
    call4.signature as `0x${string}`,
  ],
  calldatas: [call1.calldata, call2.calldata, call3.calldata, call4.calldata],
  description: `# Unichain Bridge Test with Multisend, WETH Approval, and Swap

This proposal tests the Unichain bridge integration with cross-chain messaging, WETH approval, multisend operations, and token swaps.

## Actions
1. **Cross-Chain Message 1**: Send deposit() call to WETH on Unichain
   - Gas: 1,000,000 for message execution
   - Target: WETH contract on Unichain

2. **Cross-Chain WETH Approval**: Approve WETH for Uniswap V2 Router
   - Gas: 1,500,000 for approval execution
   - Target: WETH contract on Unichain
   - Action: Approve 1 WETH for Uniswap V2 Router (0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)

3. **Cross-Chain Multisend**: Send multisend operation to distribute WETH
   - Gas: 2,000,000 for multisend execution
   - Target: Multisend contract on Unichain (0xA686afDd83Be95E6CFde9e8Cf21af3E297cDF184)
   - Action: Send 0.1 WETH each to 2 recipient addresses

4. **Cross-Chain Swap**: Perform WETH to USDC swap
   - Gas: 2,500,000 for swap execution
   - Target: Uniswap V2 Router on Unichain (0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)
   - Action: Swap 0.05 WETH for USDC

## Recipients
- Recipient 1: 0x1234567890123456789012345678901234567890
- Recipient 2: 0x0987654321098765432109876543210987654321

## Swap Details
- Input: 0.05 WETH
- Output: USDC (minimum 0)
- Path: WETH → USDC
- Recipient: Timelock contract

## Expected Events
- Cross-chain message events
- Bridge interaction events
- WETH approval events
- Multisend execution events
- WETH transfer events
- Uniswap V2 swap events
- Token transfer events

This simulation tests cross-chain messaging, WETH approval, multisend functionality, and token swaps on Unichain.`,
};
