# Cross-Chain Integration Guide

This document provides technical guidance for working with cross-chain governance proposals in the governance-seatbelt tool.

## Overview

The governance-seatbelt supports cross-chain proposal simulation for:
- **Arbitrum** (L1→L2 via DelayedInbox `createRetryableTicket`)
- **Optimism Stack** (L1→L2 via L1CrossDomainMessenger `sendMessage`)
  - OP Mainnet (Chain ID: 10)
  - Base (Chain ID: 8453)
  - Unichiain (Chain ID: 130)

## Architecture

### Bridge Types

The system supports two bridge architectures:

```typescript
type BridgeType = 'ArbitrumL1L2' | 'OptimismL1L2';
```

#### ArbitrumL1L2
- **Contract**: DelayedInbox (`0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f`)
- **Function**: `createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)`
- **Address Aliasing**: L1 addresses get +0x1111000000000000000000000000000000001111 on L2
- **Gas**: Uses `uint256` for gas parameters

#### OptimismL1L2
- **Contracts**: L1CrossDomainMessenger (varies by chain)
- **Function**: `sendMessage(address,bytes,uint32)`
- **Address Preservation**: L1 sender address preserved on L2
- **Gas**: Uses `uint32` for gas limit parameter

### Message Flow

1. **Source Chain Simulation**: Execute governance proposal on L1
2. **Message Extraction**: Parse transaction logs for cross-chain messages
3. **Destination Simulation**: Execute extracted messages on L2
4. **Report Generation**: Combine L1 and L2 analysis

## Common Issues & Troubleshooting

### Function Signature Mismatches

**Problem**: Optimism and Arbitrum use different parameter types for gas limits.

```typescript
// ❌ Wrong - Using Arbitrum pattern for Optimism
signature: 'sendMessage(address,bytes,uint256)'

// ✅ Correct - Optimism uses uint32 for gas
signature: 'sendMessage(address,bytes,uint32)'
```

**Solution**: Always check the actual contract ABI. Optimism uses `uint32` for gas limits, not `uint256`.

### Gas Limit Requirements

**Problem**: Optimism requires higher gas limits than initially expected.

```typescript
// ❌ Too low - Will fail
const gasLimit = 100000;

// ✅ Adequate - Based on Optimism's baseGas calculation
const gasLimit = 1000000; // 1M gas minimum recommended
```

**Solution**: Use generous gas limits (1M+) for Optimism L2 calls. The baseGas calculation requires significant overhead.

### Block Number Conflicts

**Problem**: Using `proposal.endBlock + 1n` causes arithmetic underflow in OptimismPortal2.

```typescript
// ❌ Can cause underflow
const simBlock = proposal.endBlock + 1n;

// ✅ Safe approach
const simBlock = latestBlock.number;
```

**Error**: `panic: arithmetic overflow / underflow`

**Root Cause**: OptimismPortal2 validates `block.number >= params.prevBlockNum`. Using a future block number violates this constraint.

**Solution**: Simulate at the latest available block number instead of a computed future block.

### ETH Balance Requirements

**Problem**: Proposals with ETH transfers fail due to insufficient balances.

```typescript
// Check if proposal requires ETH
const totalValue = config.values.reduce((sum, val) => sum + val, 0n);

if (totalValue > 0n) {
  // Override timelock balance
  simulationPayload.state_objects[timelock.address] = {
    balance: totalValue.toString(),
  };
}
```

**Solution**: Override account balances in simulation payloads when proposals transfer ETH.

## Adding New OP Stack Chains

### 1. Add Chain Configuration

Update `utils/clients/client.ts`:

```typescript
export const SUPPORTED_CHAINS = {
  // ... existing chains
  '424': { // Example: New OP Stack chain
    name: 'PGN',
    rpcUrl: process.env.PGN_RPC_URL || 'https://rpc.publicgoods.network',
    blockExplorerUrl: 'https://explorer.publicgoods.network',
    blockExplorerApiUrl: 'https://explorer.publicgoods.network/api',
  },
} as const;
```

### 2. Add L1CrossDomainMessenger Address

Update `utils/bridges/optimism.ts`:

```typescript
const OPTIMISM_MESSENGERS: Record<string, Address> = {
  '10': '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet
  '8453': '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base
  '424': '0x..........', // New chain - find from chain docs
};
```

### 3. Verify Contract Address

Find the L1CrossDomainMessenger address:
- Check the chain's official documentation
- Look for "L1CrossDomainMessenger" in deployed contracts
- Verify it implements `sendMessage(address,bytes,uint32)`

### 4. Test Integration

Create a test simulation:

```typescript
// sims/new-chain-test.sim.ts
import { encodeAbiParameters } from 'viem';
import type { SimulationConfigNew } from '../types';

const L1_CROSS_DOMAIN_MESSENGER = '0x..........'; // Your new chain's messenger
const L2_RECIPIENT = '0x4200000000000000000000000000000000000006'; // WETH9 on L2
const testMessage = encodeAbiParameters([{ type: 'bytes4' }], ['0xd0e30db0']); // deposit()

const call = {
  target: L1_CROSS_DOMAIN_MESSENGER,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_RECIPIENT, testMessage, 1000000] // Note: uint32 for gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)', // Correct signature
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'NewChainBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call.target],
  values: [call.value],
  signatures: [call.signature],
  calldatas: [call.calldata],
  description: 'Test cross-chain message to new OP Stack chain',
};
```

### 5. Run Test

```bash
SIM_NAME=new-chain-test bun start
```

Verify:
- ✅ Message detection: "Found message to [target] on chain [new-chain-id]"
- ✅ L2 simulation: "Destination sim SUCCESS"
- ✅ Report generation with cross-chain analysis

## Simulation Configuration Examples

### Basic ETH Transfer to L2

```typescript
// Transfer 1 ETH to L2 via Optimism bridge
const call = {
  target: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet Messenger
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [
      '0x4200000000000000000000000000000000000006', // L2 WETH9
      '0xd0e30db0', // deposit() function selector
      1000000 // gas limit (uint32)
    ]
  ),
  value: parseEther('1'), // 1 ETH
  signature: 'sendMessage(address,bytes,uint32)',
};
```

### Multi-Chain Governance Call

```typescript
// Send same governance action to multiple L2s
const targets = [
  '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet
  '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base
];

const governanceCalldata = encodeFunctionData({
  abi: governanceAbi,
  functionName: 'updateParameter',
  args: [newValue],
});

const calls = targets.map(messenger => ({
  target: messenger,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_GOVERNANCE_CONTRACT, governanceCalldata, 2000000]
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
}));
```

### Complex Contract Interaction

```typescript
// Deploy and initialize contract on L2
const deploymentCalldata = encodeFunctionData({
  abi: factoryAbi,
  functionName: 'createContract',
  args: [initParams],
});

const call = {
  target: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [
      '0x...', // L2 factory contract
      deploymentCalldata,
      3000000 // Higher gas for complex operations
    ]
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};
```

## Best Practices

### Gas Estimation
- **Minimum**: 1,000,000 gas for simple calls
- **Complex operations**: 2,000,000+ gas
- **Contract deployments**: 3,000,000+ gas

### Error Handling
- Always verify messenger contract addresses
- Check function signatures match exactly
- Test with small amounts first
- Validate L2 contract exists and is verified

### Testing Strategy
1. **Unit tests**: Verify message parsing logic
2. **Integration tests**: End-to-end simulation flow
3. **Manual testing**: Real proposal simulation
4. **Cross-validation**: Compare with Tenderly UI results

## Debugging Tools

### Tenderly Integration
The tool automatically saves failed simulations to Tenderly for debugging:

```typescript
save_if_fails: true, // Enables failed simulation persistence
```

### Console Logging
Enable detailed logging by checking console output for:
- `[Optimism Parser] Found message to ...`
- `[CrossChainHandler] Destination sim SUCCESS/FAILED`
- Error messages with specific failure reasons

### Manual Verification
Test proposals directly in Tenderly UI to isolate issues:
1. Copy transaction data from logs
2. Paste into Tenderly simulator
3. Compare results with tool output