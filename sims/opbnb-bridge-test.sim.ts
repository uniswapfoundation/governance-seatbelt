import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

/**
 * Comprehensive test simulation for OP BNB bridge functionality.
 * This simulation includes:
 * 1. WETH transfer to OP BNB
 * 2. Reading from contract 0x05D6f526876E8D76bE47e70C00D7d6c74f79EeE0 with userInfo function
 */

const L1_CROSS_DOMAIN_MESSENGER_OPBNB: Address = '0x09525eB7eEd671582dDc6f02f8D9082cbd55A606';

// Token addresses on OP BNB
const WBNB_OPBNB: Address = '0x4200000000000000000000000000000000000006'; // WBNB token
const ETH_OPBNB: Address = '0xe7798f023fc62146e8aa1b36da45fb70855a77ea'; // ETH token

// Contract to read from (userInfo function with selector 0x1959a002)
const TARGET_CONTRACT: Address = '0x05D6f526876E8D76bE47e70C00D7d6c74f79EeE0';

// Function selectors
const DEPOSIT_SELECTOR = '0xd0e30db0'; // deposit() function
const USERINFO_SELECTOR = '0x1959a002'; // userInfo() function

// Encode WETH deposit call
const wethDepositCall = {
  target: L1_CROSS_DOMAIN_MESSENGER_OPBNB,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [WBNB_OPBNB, DEPOSIT_SELECTOR, 1000000], // WBNB deposit with 1M gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Encode ETH deposit call
const ethDepositCall = {
  target: L1_CROSS_DOMAIN_MESSENGER_OPBNB,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [ETH_OPBNB, DEPOSIT_SELECTOR, 1000000], // ETH deposit with 1M gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

// Encode userInfo read call to the target contract
const userInfoReadCall = {
  target: L1_CROSS_DOMAIN_MESSENGER_OPBNB,
  calldata: encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'uint32' }],
    [TARGET_CONTRACT, USERINFO_SELECTOR, 1000000], // userInfo call with 1M gas limit
  ),
  value: 0n,
  signature: 'sendMessage(address,bytes,uint32)',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'OPBNBBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Using Uniswap governor for testing
  governorType: 'bravo',
  targets: [wethDepositCall.target, ethDepositCall.target, userInfoReadCall.target],
  values: [wethDepositCall.value, ethDepositCall.value, userInfoReadCall.value],
  signatures: [
    wethDepositCall.signature as `0x${string}`,
    ethDepositCall.signature as `0x${string}`,
    userInfoReadCall.signature as `0x${string}`,
  ],
  calldatas: [wethDepositCall.calldata, ethDepositCall.calldata, userInfoReadCall.calldata],
  description: `# OP BNB Bridge Test

This proposal tests the OP BNB bridge integration with comprehensive functionality.

## Actions
1. Send WETH deposit message to ${WBNB_OPBNB} on OP BNB
2. Send ETH deposit message to ${ETH_OPBNB} on OP BNB  
3. Send userInfo read call to ${TARGET_CONTRACT} on OP BNB

## Token Addresses
- WBNB: ${WBNB_OPBNB}
- ETH: ${ETH_OPBNB}
- Target Contract: ${TARGET_CONTRACT}

All messages use a gas limit of 1,000,000.`,
};
