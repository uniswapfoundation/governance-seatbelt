import { encodeFunctionData, formatEther, parseUnits } from 'viem';
/**
 * @notice Sample simulation configuration file for the arb lm distribution proposal.
 */
import type { SimulationConfigNew } from '../types';
import ArbTokenAbi from '../utils/abis/ArbTokenAbi.json' assert { type: 'json' };
import ArbitrumDelayedInboxAbi from '../utils/abis/ArbitrumDelayedInboxAbi.json' assert {
  type: 'json',
};

// Get interfaces to facilitate encoding the calls we want to execute.
const delayedInboxAddress = '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f' as const;
const arbTokenAddress = '0x912CE59144191C1204E64559FE8253a0e49E6548' as const;
const timelockAliasAddress = '0x2BAD8182C09F50c8318d769245beA52C32Be46CD' as const;
const gauntletAddress = '0xFd2892eFf2615C9F29AF83Fb528fAf3fE41c1426' as const;
const openBlockAddress = '0x66cCbf509cD28c2fc0f40b4469D6b6AA1FC0FeD3' as const;
const multisigAddress = '0xB3f1AdE4eF508fe8379f44fA6A25111977B9AEB6' as const;

const gauntletAmount = parseUnits('100000', 18);
const openBlockAmount = parseUnits('100000', 18);
const multisigAmount = parseUnits('100000', 18);

const ethAmount = formatEther(380800000000000n);
console.log({ ethAmount });

// get encoded function calls
const openBlockCallBytes = encodeFunctionData({
  abi: ArbTokenAbi,
  functionName: 'transfer',
  args: [openBlockAddress, openBlockAmount],
});
const gauntletCallBytes = encodeFunctionData({
  abi: ArbTokenAbi,
  functionName: 'transfer',
  args: [gauntletAddress, gauntletAmount],
});
const multisigCallBytes = encodeFunctionData({
  abi: ArbTokenAbi,
  functionName: 'transfer',
  args: [multisigAddress, multisigAmount],
});

console.log({ openBlockCallBytes, gauntletCallBytes, multisigCallBytes });

// send OpenBlock their ARB
const call1 = {
  target: delayedInboxAddress,
  calldata: encodeFunctionData({
    abi: ArbitrumDelayedInboxAbi,
    functionName: 'createRetryableTicket',
    args: [
      // to string address
      arbTokenAddress,
      // l2CallValue uint256
      0n,
      // maxSubmissionCost unit256
      180800000000000n,
      // excessFeeRefundAddress address
      timelockAliasAddress,
      // callValueRefundAddress address
      timelockAliasAddress,
      // gasLimit uint256
      200000n,
      // maxFeePerGas uint256
      1000000000n,
      // data
      openBlockCallBytes,
    ],
  }),
  value: 380800000000000n,
  signature: '',
};

// send Gauntlet their ARB
const call2 = {
  target: delayedInboxAddress,
  calldata: encodeFunctionData({
    abi: ArbitrumDelayedInboxAbi,
    functionName: 'createRetryableTicket',
    args: [
      // to string address
      arbTokenAddress,
      // l2CallValue uint256
      0n,
      // maxSubmissionCost unit256
      180800000000000n,
      // excessFeeRefundAddress address
      timelockAliasAddress,
      // callValueRefundAddress address
      timelockAliasAddress,
      // gasLimit uint256
      200000n,
      // maxFeePerGas uint256
      1000000000n,
      // data
      gauntletCallBytes,
    ],
  }),
  value: 380800000000000n,
  signature: '',
};

// send Multisig its ARB
const call3 = {
  target: delayedInboxAddress,
  calldata: encodeFunctionData({
    abi: ArbitrumDelayedInboxAbi,
    functionName: 'createRetryableTicket',
    args: [
      // to string address
      arbTokenAddress,
      // l2CallValue uint256
      0n,
      // maxSubmissionCost unit256
      180800000000000n,
      // excessFeeRefundAddress address
      timelockAliasAddress,
      // callValueRefundAddress address
      timelockAliasAddress,
      // gasLimit uint256
      200000n,
      // maxFeePerGas uint256
      1000000000n,
      // data
      multisigCallBytes,
    ],
  }),
  value: 380800000000000n,
  signature: '',
};

const calls = [call1, call2, call3];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  governorType: 'bravo',
  targets: calls.map((item) => item.target),
  values: calls.map((item) => item.value),
  signatures: calls.map((item) => item.signature as `0x${string}`),
  calldatas: calls.map((item) => item.calldata),
  description: 'Send ARB to three recipients',
};
