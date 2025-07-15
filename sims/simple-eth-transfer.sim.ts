import type { SimulationConfigNew } from '../types';

/**
 * Simple ETH transfer test to verify timelock can execute value transfers
 */

const call = {
  target: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const,
  calldata: '0x' as const, // Empty calldata for simple ETH transfer
  value: 1n, // 1 wei
  signature: '',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'SimpleETHTransferTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call.target],
  values: [call.value],
  signatures: [call.signature as `0x${string}`],
  calldatas: [call.calldata],
  description: 'Simple ETH transfer test - Transfer 1 wei from timelock to 0xdeadbeef',
};