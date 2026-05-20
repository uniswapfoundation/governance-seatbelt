/**
 * @notice Simulation configuration for proposal 97.
 *
 * Action 1: Celo — Wormhole fee activation and CrossChainAccount handoff.
 * Action 2: BNB Chain — Wormhole fee activation (V2 setFeeTo, V3 setOwner).
 * Action 3: Polygon — FxPortal fee activation (V2 setFeeTo, V3 setOwner).
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseAbiParameters,
} from 'viem';

import type { SimulationConfigNew } from '../types';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../utils/bridges/wormhole';

const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');

// ─── Ethereum (FxPortal root) ───
const POLYGON_FX_ROOT = getAddress('0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2');
const POLYGON_FX_RECEIVER = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');

// ─── Polygon (destination) ───
const POLYGON_V2_FACTORY = getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C');
const POLYGON_V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
const POLYGON_TOKEN_JAR = getAddress('0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A');
const POLYGON_V3_OPEN_FEE_ADAPTER = getAddress('0x3F07F08b45912dCd6691C5B9412975D5113B2910');

// ─── Celo (destination) ───
const CELO_WORMHOLE_RECEIVER = getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071');
const CELO_V2_FACTORY = getAddress('0x114A43DF6C5f54EBB8A9d70Cd1951D3dD68004c7');
const CELO_V3_FACTORY = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
const CELO_V4_POOL_MANAGER = getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC');
const CELO_TOKEN_JAR = getAddress('0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B');
const CELO_V3_OPEN_FEE_ADAPTER = getAddress('0xB9952C01830306ea2fAAe1505f6539BD260Bfc48');
const CELO_CROSS_CHAIN_ACCOUNT = getAddress('0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7');
const WORMHOLE_CELO_CHAIN_ID = 14;

// ─── BNB Chain (destination) ───
const BNB_WORMHOLE_RECEIVER = getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b');
const BNB_V2_FACTORY = getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6');
const BNB_V3_FACTORY = getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7');
const BNB_TOKEN_JAR = getAddress('0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A');
const BNB_V3_OPEN_FEE_ADAPTER = getAddress('0x3F07F08b45912dCd6691C5B9412975D5113B2910');
const WORMHOLE_BNB_CHAIN_ID = 4;

const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)', 'function setFeeToSetter(address)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const OWNED_ABI = parseAbi(['function transferOwnership(address newOwner)']);
const SEND_MESSAGE_TO_CHILD_ABI = parseAbi([
  'function sendMessageToChild(address _receiver, bytes calldata _data)',
]);

// Action 1: Celo Wormhole — V2 fees + CrossChainAccount handoff + V3 fee adapter
const celoTargets = [
  CELO_V2_FACTORY,
  CELO_V2_FACTORY,
  CELO_V3_FACTORY,
  CELO_V4_POOL_MANAGER,
] as const;
const celoValues = [0n, 0n, 0n, 0n] as const;
const celoDatas = [
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeTo',
    args: [CELO_TOKEN_JAR],
  }),
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeToSetter',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
  encodeFunctionData({
    abi: SET_OWNER_ABI,
    functionName: 'setOwner',
    args: [CELO_V3_OPEN_FEE_ADAPTER],
  }),
  encodeFunctionData({
    abi: OWNED_ABI,
    functionName: 'transferOwnership',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
] as const;

const call0 = {
  target: WORMHOLE_SENDER,
  calldata: encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      [...celoTargets],
      [...celoValues],
      [...celoDatas],
      CELO_WORMHOLE_RECEIVER,
      WORMHOLE_CELO_CHAIN_ID,
    ],
  }),
  value: 0n,
  signature: '',
};

// Action 2: BNB Wormhole — V2 setFeeTo + V3 setOwner
const bnbTargets = [BNB_V2_FACTORY, BNB_V3_FACTORY] as const;
const bnbValues = [0n, 0n] as const;
const bnbDatas = [
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeTo',
    args: [BNB_TOKEN_JAR],
  }),
  encodeFunctionData({
    abi: SET_OWNER_ABI,
    functionName: 'setOwner',
    args: [BNB_V3_OPEN_FEE_ADAPTER],
  }),
] as const;

const call1 = {
  target: WORMHOLE_SENDER,
  calldata: encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      [...bnbTargets],
      [...bnbValues],
      [...bnbDatas],
      BNB_WORMHOLE_RECEIVER,
      WORMHOLE_BNB_CHAIN_ID,
    ],
  }),
  value: 0n,
  signature: '',
};

// Action 3: Polygon FxPortal — V2 setFeeTo + V3 setOwner
const polygonBatch = encodeAbiParameters(
  parseAbiParameters('address[] targets, uint256[] values, bytes[] datas'),
  [
    [POLYGON_V2_FACTORY, POLYGON_V3_FACTORY],
    [0n, 0n],
    [
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [POLYGON_TOKEN_JAR],
      }),
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [POLYGON_V3_OPEN_FEE_ADAPTER],
      }),
    ],
  ],
);

const call2 = {
  target: POLYGON_FX_ROOT,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_TO_CHILD_ABI,
    functionName: 'sendMessageToChild',
    args: [POLYGON_FX_RECEIVER, polygonBatch],
  }),
  value: 0n,
  signature: '',
};

const calls = [call0, call1, call2];

const description = `# Protocol Fee Expansion: Proposal 97

This proposal executes three cross-chain actions to activate protocol fees on Celo, BNB Chain, and Polygon.

## Action 1 — Celo

\`WORMHOLE_SENDER.sendMessage(targets, values, datas, UNISWAP_WORMHOLE_MESSAGE_RECEIVER, CELO_CHAIN_ID)\`:

- \`V2_FACTORY.setFeeTo(TOKEN_JAR)\`
- \`V2_FACTORY.setFeeToSetter(CROSS_CHAIN_ACCOUNT)\`
- \`V3_FACTORY.setOwner(V3_OPEN_FEE_ADAPTER)\`
- \`V4_POOL_MANAGER.transferOwnership(CROSS_CHAIN_ACCOUNT)\`

## Action 2 — BNB Chain

\`WORMHOLE_SENDER.sendMessage(targets, values, datas, UNISWAP_WORMHOLE_MESSAGE_RECEIVER, BNB_CHAIN_ID)\`:

- \`V2_FACTORY.setFeeTo(TOKEN_JAR)\`
- \`V3_FACTORY.setOwner(V3_OPEN_FEE_ADAPTER)\`

## Action 3 — Polygon

\`POLYGON_FX_ROOT.sendMessageToChild(ETHEREUM_PROXY, abi.encode(targets, values, datas))\`:

- \`V2_FACTORY.setFeeTo(TOKEN_JAR)\`
- \`V3_FACTORY.setOwner(V3_OPEN_FEE_ADAPTER)\`

Because these transactions are cross-chain, governance front ends may not decode them correctly. Review the Seatbelt simulation report to confirm validity.
`;

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorType: 'bravo',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  targets: calls.map((call) => call.target),
  values: calls.map((call) => call.value),
  signatures: calls.map((call) => call.signature as `0x${string}`),
  calldatas: calls.map((call) => call.calldata),
  description,
};
