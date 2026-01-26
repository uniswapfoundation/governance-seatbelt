import { encodeAbiParameters, encodeFunctionData, parseUnits } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';
import ArbTokenAbi from '../utils/abis/ArbTokenAbi.json' assert { type: 'json' };
import ArbitrumDelayedInboxAbi from '../utils/abis/ArbitrumDelayedInboxAbi.json' assert {
  type: 'json',
};

/**
 * Cross-chain "grokkability" stress test.
 *
 * Goal: produce multiple cross-chain messages across OP Stack + Arbitrum with a mix of
 * obvious call signatures and intentional failures, so Markdown + UI can be verified
 * as "ultra grokkable" at first glance.
 */

// --- OP Stack (OP Mainnet) ---
const L1_CROSS_DOMAIN_MESSENGER_OP: Address = '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1';
const L2_WETH_PREDEPLOY_OP: Address = '0x4200000000000000000000000000000000000006';

const opDepositMessage = '0xd0e30db0' as const; // deposit()
const opWithdrawMessage = encodeFunctionData({
  abi: [
    {
      type: 'function',
      name: 'withdraw',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'wad', type: 'uint256' }],
      outputs: [],
    },
  ],
  functionName: 'withdraw',
  args: [parseUnits('1', 18)],
});

const opCall1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_OP,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_WETH_PREDEPLOY_OP, opDepositMessage, 1_000_000],
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

const opCall2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_OP,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [L2_WETH_PREDEPLOY_OP, opWithdrawMessage, 1_000_000],
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// --- Arbitrum (L1→L2 via Delayed Inbox) ---
const ARB_DELAYED_INBOX_L1: Address = '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f';
const ARB_TOKEN_L2: Address = '0x912CE59144191C1204E64559FE8253a0e49E6548';
const ARB_TIMELOCK_ALIAS_L2: Address = '0x2BAD8182C09F50c8318d769245beA52C32Be46CD';

const recipientA: Address = '0xFd2892eFf2615C9F29AF83Fb528fAf3fE41c1426';
const recipientB: Address = '0x66cCbf509cD28c2fc0f40b4469D6b6AA1FC0FeD3';

// Likely-successful (no balance required): delegate(recipientA)
const arbDelegateBytes = encodeFunctionData({
  abi: ArbTokenAbi,
  functionName: 'delegate',
  args: [recipientA],
});

// Intentional failure candidate: transferFrom(recipientA, recipientB, 1)
// (requires allowance that should not exist in the default sim context)
const arbTransferFromBytes = encodeFunctionData({
  abi: ArbTokenAbi,
  functionName: 'transferFrom',
  args: [recipientA, recipientB, 1n],
});

function makeArbRetryableTicket(l2Calldata: `0x${string}`) {
  return {
    target: ARB_DELAYED_INBOX_L1,
    calldata: encodeFunctionData({
      abi: ArbitrumDelayedInboxAbi,
      functionName: 'createRetryableTicket',
      args: [
        ARB_TOKEN_L2, // to
        0n, // l2CallValue
        180_800_000_000_000n, // maxSubmissionCost
        ARB_TIMELOCK_ALIAS_L2, // excessFeeRefundAddress
        ARB_TIMELOCK_ALIAS_L2, // callValueRefundAddress
        200_000n, // gasLimit
        1_000_000_000n, // maxFeePerGas
        l2Calldata, // data
      ],
    }),
    value: 380_800_000_000_000n, // L1 ETH for L2 gas
    signature: '',
  } as const;
}

const arbCall1 = makeArbRetryableTicket(arbDelegateBytes);
const arbCall2 = makeArbRetryableTicket(arbTransferFromBytes);

const calls = [opCall1, opCall2, arbCall1, arbCall2];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'CrossChainGrokkability',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: calls.map((call) => call.target),
  values: calls.map((call) => call.value),
  signatures: calls.map((call) => call.signature as `0x${string}`),
  calldatas: calls.map((call) => call.calldata),
  description: `# Cross-Chain Grokkability Stress Test

This proposal is intentionally designed to stress cross-chain reporting in both Markdown and the UI.

## Intentional Failures (on purpose)

This simulation deliberately includes failing L2 calls to verify that per-message ✅/❌ status rendering and error surfacing are clear:

- OP Stack (Optimism): \`withdraw(uint256)\` is expected to fail in the destination simulation context.
- Arbitrum One: \`transferFrom(address,address,uint256)\` is expected to fail due to missing allowance/balance in the destination simulation context.

## Expected Preview

### OP Mainnet (OP Stack)
- WETH predeploy: deposit()
- WETH predeploy: withdraw(uint256) (likely failure in the destination simulation)

### Arbitrum One
- ARB token: delegate(address)
- ARB token: transferFrom(address,address,uint256) (likely failure in the destination simulation)
`,
};
