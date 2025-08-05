import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

const L1_CROSS_DOMAIN_MESSENGER_BOB: Address = '0xE3d981643b806FB8030CDB677D6E60892E547EdA';
const L2_WETH_BOB: Address = '0x4200000000000000000000000000000000000006';
const L2_COUNTER_BOB: Address = '0xff7f743670DB0188De8F123B420abBB4838b0175';
const depositMessage = '0xd0e30db0' as const;
const counterReadCalldata = '0x0c55699c' as const; // x() function

const call1 = {
  target: L1_CROSS_DOMAIN_MESSENGER_BOB,
  value: '0',
  signature: 'sendMessage(address,bytes,uint32)',
  calldata: encodeAbiParameters(
    [
      { name: '_target', type: 'address' },
      { name: '_message', type: 'bytes' },
      { name: '_minGasLimit', type: 'uint32' },
    ],
    [L2_WETH_BOB, depositMessage, 1000000],
  ),
};

const call2 = {
  target: L1_CROSS_DOMAIN_MESSENGER_BOB,
  value: '0',
  signature: 'sendMessage(address,bytes,uint32)',
  calldata: encodeAbiParameters(
    [
      { name: '_target', type: 'address' },
      { name: '_message', type: 'bytes' },
      { name: '_minGasLimit', type: 'uint32' },
    ],
    [L2_COUNTER_BOB, counterReadCalldata, 500000],
  ),
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'BobBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call1.target, call2.target],
  values: [BigInt(call1.value), BigInt(call2.value)],
  signatures: [call1.signature as `0x${string}`, call2.signature as `0x${string}`],
  calldatas: [call1.calldata, call2.calldata],
  description: `# Bob Bridge Test

This proposal tests the Bob bridge integration with basic cross-chain messaging and verified contract interaction.

## Actions

### 1. WETH Deposit
- **Target**: WETH contract on Bob (0x4200000000000000000000000000000000000006)
- **Action**: Call deposit() function to mint WETH
- **Gas**: 1,000,000 for message execution

### 2. Counter Contract Read
- **Target**: Verified counter contract on Bob (0xff7f743670DB0188De8F123B420abBB4838b0175)
- **Action**: Read counter value
- **Gas**: 500,000 for read execution

This test validates cross-chain message passing to Bob L2.`,
};
