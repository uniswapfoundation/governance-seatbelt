/**
 * @notice Simulation configuration for proposal 97 (in progress).
 *
 * Action 1: Activate v2 and v3 protocol fees on Polygon via the PoS FxPortal bridge.
 * Actions 2–3: TBD.
 */
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseAbiParameters,
} from 'viem';

import type { SimulationConfigNew } from '../types';

// ─── Ethereum (FxPortal root) ───
const POLYGON_FX_ROOT = getAddress('0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2');
const POLYGON_FX_RECEIVER = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');

// ─── Polygon (destination chain) ───
const V2_FACTORY = getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C');
const V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
const TOKEN_JAR = getAddress('0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A');
const V3_OPEN_FEE_ADAPTER = getAddress('0x3F07F08b45912dCd6691C5B9412975D5113B2910');

const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const SEND_MESSAGE_TO_CHILD_ABI = parseAbi([
  'function sendMessageToChild(address _receiver, bytes calldata _data)',
]);

const polygonTargets = [V2_FACTORY, V3_FACTORY] as const;
const polygonValues = [0n, 0n] as const;
const polygonDatas = [
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeTo',
    args: [TOKEN_JAR],
  }),
  encodeFunctionData({
    abi: SET_OWNER_ABI,
    functionName: 'setOwner',
    args: [V3_OPEN_FEE_ADAPTER],
  }),
] as const;

const polygonBatch = encodeAbiParameters(
  parseAbiParameters('address[] targets, uint256[] values, bytes[] datas'),
  [[...polygonTargets], [...polygonValues], [...polygonDatas]],
);

// Action 1: Polygon FxPortal — V2 setFeeTo + V3 setOwner
const call0 = {
  target: POLYGON_FX_ROOT,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_TO_CHILD_ABI,
    functionName: 'sendMessageToChild',
    args: [POLYGON_FX_RECEIVER, polygonBatch],
  }),
  value: 0n,
  signature: '',
};

// TODO: add actions 2 and 3 when specified.
const calls = [call0];

const description = `# Protocol Fee Expansion: Proposal 97 (draft sim)

## Action 1 — Polygon

\`POLYGON_FX_ROOT.sendMessageToChild(ETHEREUM_PROXY, abi.encode(targets, values, datas))\` activates protocol fees on Polygon:

- \`V2_FACTORY.setFeeTo(TOKEN_JAR)\`
- \`V3_FACTORY.setOwner(V3_OPEN_FEE_ADAPTER)\`

### Relevant addresses (Polygon)

| Name | Address |
| --- | --- |
| V2 Factory | \`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C\` |
| V3 Factory | \`0x1F98431c8aD98523631AE4a59f267346ea31F984\` |
| TokenJar | \`0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A\` |
| V3OpenFeeAdapter | \`0x3F07F08b45912dCd6691C5B9412975D5113B2910\` |
| FxChild receiver (ETHEREUM_PROXY) | \`0x8a1B966aC46F42275860f905dbC75EfBfDC12374\` |

### Relevant addresses (Ethereum)

| Name | Address |
| --- | --- |
| Polygon FxRoot (POLYGON_FX_ROOT) | \`0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2\` |

Actions 2 and 3 are not yet included in this simulation file.

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
