/**
 * @notice Simulation configuration for proposal 96.
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

// ─── Ethereum ───
const POLYGON_FX_ROOT = getAddress('0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2');
const POLYGON_FX_RECEIVER = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');
const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');

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

// ─── Polygon (destination) ───
const POLYGON_V2_FACTORY = getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C');
const POLYGON_V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
const POLYGON_TOKEN_JAR = getAddress('0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A');
const POLYGON_V3_OPEN_FEE_ADAPTER = getAddress('0x3F07F08b45912dCd6691C5B9412975D5113B2910');

// ─── ABI fragments ───
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
  parseAbiParameters('address[] targets, bytes[] datas, uint256[] values'),
  [
    [POLYGON_V2_FACTORY, POLYGON_V3_FACTORY],
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
    [0n, 0n],
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

const description = `# Protocol Fee Expansion: Vote 3

## Proposal Spec

If this proposal passes, it will execute three actions, each of which has multiple inner calls.

On BNB Chain and Polygon, the actions will execute the following transactions: 

\`\`\`
/// Set the recipient of V2 protocol fees to the TokenJar
V2_FACTORY.setFeeTo(address(tokenJar));

/// Set the owner of the V3 Factory to the V3OpenFeeAdapter
V3_FACTORY.setOwner(address(v3OpenFeeAdapter));
\`\`\`

On Celo, the action will execute the following transactions:

\`\`\`
/// Set the recipient of V2 protocol fees to the TokenJar
V2_FACTORY.setFeeTo(address(tokenJar));

/// Transfer feeToSetter role from Wormhole to the CrossChainAccount
V2_FACTORY.setFeeToSetter(address(crossChainAccount));

/// Set the owner of the V3 Factory to the V3OpenFeeAdapter
V3_FACTORY.setOwner(address(v3OpenFeeAdapter));

/// Transfer ownership of the V4 PoolManager to the CrossChainAccount
POOL_MANAGER.transferOwnership(address(crossChainAccount));
\`\`\`

### Relevant Addresses

**Celo**

| **Contract** | **Network** | **Address** |
| --- | --- | --- |
| TokenJar | Celo | [\`0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B\`](https://celoscan.io/address/0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B) |
| V3OpenFeeAdapter | Celo | [\`0xB9952C01830306ea2fAAe1505f6539BD260Bfc48\`](https://celoscan.io/address/0xB9952C01830306ea2fAAe1505f6539BD260Bfc48) |
| UniswapV3Factory | Celo | [\`0xAfE208a311B21f13EF87E33A90049fC17A7acDEc\`](https://celoscan.io/address/0xAfE208a311B21f13EF87E33A90049fC17A7acDEc) |
| UniswapV2Factory | Celo | [\`0x114A43DF6C5f54EBB8A9d70Cd1951D3dD68004c7\`](https://celoscan.io/address/0x114A43DF6C5f54EBB8A9d70Cd1951D3dD68004c7) |
| PoolManager | Celo | [\`0x288dc841A52FCA2707c6947B3A777c5E56cd87BC\`](https://celoscan.io/address/0x288dc841A52FCA2707c6947B3A777c5E56cd87BC) |
| UniswapWormholeMessageReceiver | Celo | [\`0x0Eb863541278308c3A64F8E908BC646e27BFD071\`](https://celoscan.io/address/0x0Eb863541278308c3A64F8E908BC646e27BFD071) |
| Celo CrossChainAccount | Celo | [\`0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7\`](https://celoscan.io/address/0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7) |
| Wormhole Sender | Ethereum | [\`0xf5F4496219F31CDCBa6130B5402873624585615a\`](https://etherscan.io/address/0xf5F4496219F31CDCBa6130B5402873624585615a) |

**BNB Chain**

| **Contract** | **Network** | **Address** |
| --- | --- | --- |
| TokenJar | BNB Chain | [\`0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A\`](https://bscscan.com/address/0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A) |
| V3OpenFeeAdapter | BNB Chain | [\`0x3F07F08b45912dCd6691C5B9412975D5113B2910\`](https://bscscan.com/address/0x3F07F08b45912dCd6691C5B9412975D5113B2910) |
| UniswapV3Factory | BNB Chain | [\`0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7\`](https://bscscan.com/address/0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7) |
| UniswapV2Factory | BNB Chain | [\`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6\`](https://bscscan.com/address/0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6) |
| UniswapWormholeMessageReceiver | BNB Chain | [\`0x341c1511141022cf8eE20824Ae0fFA3491F1302b\`](https://bscscan.com/address/0x341c1511141022cf8eE20824Ae0fFA3491F1302b) |
| Wormhole Sender | Ethereum | [\`0xf5F4496219F31CDCBa6130B5402873624585615a\`](https://etherscan.io/address/0xf5F4496219F31CDCBa6130B5402873624585615a) |

**Polygon**

| **Contract** | **Network** | **Address** |
| --- | --- | --- |
| TokenJar | Polygon | [\`0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A\`](https://polygonscan.com/address/0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A) |
| V3OpenFeeAdapter | Polygon | [\`0x3F07F08b45912dCd6691C5B9412975D5113B2910\`](https://polygonscan.com/address/0x3F07F08b45912dCd6691C5B9412975D5113B2910) |
| UniswapV3Factory | Polygon | [\`0x1F98431c8aD98523631AE4a59f267346ea31F984\`](https://polygonscan.com/address/0x1F98431c8aD98523631AE4a59f267346ea31F984) |
| UniswapV2Factory | Polygon | [\`0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C\`](https://polygonscan.com/address/0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C) |
| Ethereum Proxy | Polygon | [\`0x8a1B966aC46F42275860f905dbC75EfBfDC12374\`](https://polygonscan.com/address/0x8a1B966aC46F42275860f905dbC75EfBfDC12374) |
| Polygon Fx Root | Ethereum | [\`0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2\`](https://etherscan.io/address/0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2) |

## Proposal

This proposal continues the protocol fee rollout, following proposals [#93](https://vote.uniswapfoundation.org/proposals/93), [#94](https://vote.uniswapfoundation.org/proposals/94), and [#95](https://vote.uniswapfoundation.org/proposals/95). It uses the expedited governance process [approved](https://gov.uniswap.org/t/unification-proposal/25881#p-57882-protocol-fee-rollout-4) in UNIfication, where fee parameter update proposals can bypass the RFC stage and go directly to a five-day Snapshot followed by an onchain vote.

Since protocol fees went live on Ethereum mainnet in late December, the rollout has extended to 73 additional chains (Arbitrum, Base, OP Mainnet, Soneium, X Layer, Worldchain, and Zora). The burn system is working as designed, with fees accumulating in TokenJars across chains. From there, searchers claim them in exchange for burning UNI by bridging it back to mainnet and sending it to the burn address.

This proposal:

* Extends the infrastructure for collecting and burning protocol fees to BNB Chain and Polygon
* Enables v2 and v3 protocol fees on these chains
* Completes Celo's fee activation through a corrected cross-chain governance path, which was approved in a previous [proposal](https://vote.uniswapfoundation.org/proposals/94) but did not execute due to a configuration error

## Implementation Details

Fees on each chain will be routed to the TokenJar on that respective chain. UNI burned on these chains is bridged back to Ethereum mainnet and sent to the burn address.

Celo uses the [same architecture](https://github.com/Uniswap/protocol-fees/blob/main/src/releasers/OptimismBridgedResourceFirepit.sol) as other OP-stack chains. On BNB and Polygon, we make use of Wormhole’s Native Token Transfer (NTT) mechanism for multichain token management. Details on our implementation can be found [here](https://github.com/Uniswap/protocol-fees/blob/main/script/proposal-4/Index.md).

Protocol fee levels are the same on all other chains where fees are live, see breakdown [here](https://developers.uniswap.org/docs/protocols/protocol-fee/concepts/fees#fee-split-table).
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
