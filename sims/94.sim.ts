/**
 * Simulation for ActivateOPBaseArbProposal: activate protocol fees on OP Mainnet,
 * Base, Arbitrum, and Ethereum mainnet, plus Celo governance handoff.
 *
 * Mirrors the 8 actions from the Solidity script. Replace placeholder addresses
 * (OP_FEE_ADAPTER, OP_TOKEN_JAR, etc.) with actual deployed addresses before
 * running against a real proposal or when deployments are available.
 */
import { encodeFunctionData, getAddress, parseAbi, parseEther, parseGwei } from 'viem';

import type { SimulationConfigNew } from '../types';
import ArbitrumDelayedInboxAbi from '../utils/abis/ArbitrumDelayedInboxAbi.json' assert {
  type: 'json',
};
import L2CrossChainAccount from '../utils/abis/L2CrossChainAccount.json' assert { type: 'json' };
import v3FactoryAbi from '../utils/abis/v3FactoryAbi.json' assert { type: 'json' };

// ─── Gas limits (match Solidity script) ───
const XDM_GAS_LIMIT = 200_000;
const ARB_GAS_LIMIT = 200_000n;
const ARB_MAX_FEE_PER_GAS = parseGwei('0.1');
const ARB_MAX_SUBMISSION_COST = parseEther('0.01');
const ARB_VALUE = ARB_MAX_SUBMISSION_COST + ARB_GAS_LIMIT * ARB_MAX_FEE_PER_GAS;

// ─── OP Mainnet ───
const OP_L1_MESSENGER = getAddress('0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1');
const OP_CROSS_CHAIN_ACCOUNT = getAddress('0xa1dD330d602c32622AA270Ea73d078B803Cb3518');
const OP_V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
const OP_V2_FACTORY = getAddress('0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf');

// ─── Base ───
const BASE_L1_MESSENGER = getAddress('0x866E82a600A1414e583f7F13623F1aC5d58b0Afa');
const BASE_CROSS_CHAIN_ACCOUNT = getAddress('0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9');
const BASE_V3_FACTORY = getAddress('0x33128a8fC17869897dcE68Ed026d694621f6FDfD');
const BASE_V2_FACTORY = getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6');

// ─── Arbitrum ───
const ARB_INBOX = getAddress('0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f');
const ARB_V3_FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
const ARB_ALIASED_TIMELOCK = getAddress('0x2BAD8182C09F50c8318d769245beA52C32Be46CD');
const ARB_V2_FACTORY = getAddress('0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9');

// ─── Mainnet V3 migration ───
// ─── Celo Wormhole ───
const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');
const WORMHOLE_BRIDGE = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');
const WORMHOLE_CELO_CHAIN_ID = 14;
const CELO_V3_FACTORY = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
const CELO_V2_FACTORY = getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f');
const CELO_V4_POOL_MANAGER = getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC');

// Placeholder addresses — replace with actual deployed addresses before real proposal run
const OP_FEE_ADAPTER = getAddress('0xec23Cf5A1db3dcC6595385D28B2a4D9B52503Be4');
const OP_TOKEN_JAR = getAddress('0xb13285DF724ea75f3f1E9912010B7e491dCd5EE3');
const BASE_FEE_ADAPTER = getAddress('0xaBEA76658b205696d49B5F91b2a03536cB8A3bE1');
const BASE_TOKEN_JAR = getAddress('0x9bD25e67bF390437C8fAF480AC735a27BcF6168c');
const ARB_FEE_ADAPTER = getAddress('0xFF7aD5dA31fECdC678796c88B05926dB896b0699');
const ARB_TOKEN_JAR = getAddress('0x95E337C5B155385945D407f5396387D0c2a3A263');
const MAINNET_V3_FEE_ADAPTER = getAddress('0x5E74C9f42EEd283bFf3744fBD1889d398d40867d');
const MAINNET_V3_OPEN_FEE_ADAPTER = getAddress('0xf2371551Fe3937Db7c750f4DfABe5c2fFFdcBf5A');
const CELO_CROSS_CHAIN_ACCOUNT = getAddress('0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7');

const SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
]);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)', 'function setFeeToSetter(address)']);
const V3_FEE_ADAPTER_ABI = parseAbi(['function setFactoryOwner(address newOwner)']);
const OWNED_ABI = parseAbi(['function transferOwnership(address newOwner)']);
const WORMHOLE_SENDER_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

// Action 0: OP Mainnet V3 factory → V3OpenFeeAdapter (XDM → CrossChainAccount.forward)
const opV3Forward = encodeFunctionData({
  abi: L2CrossChainAccount as unknown as readonly unknown[],
  functionName: 'forward',
  args: [
    OP_V3_FACTORY,
    encodeFunctionData({
      abi: v3FactoryAbi as unknown as readonly unknown[],
      functionName: 'setOwner',
      args: [OP_FEE_ADAPTER],
    }),
  ],
});
const call0 = {
  target: OP_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [OP_CROSS_CHAIN_ACCOUNT, opV3Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: '',
};

// Action 1: Base V3 factory → V3OpenFeeAdapter
const baseV3Forward = encodeFunctionData({
  abi: L2CrossChainAccount as unknown as readonly unknown[],
  functionName: 'forward',
  args: [
    BASE_V3_FACTORY,
    encodeFunctionData({
      abi: v3FactoryAbi as unknown as readonly unknown[],
      functionName: 'setOwner',
      args: [BASE_FEE_ADAPTER],
    }),
  ],
});
const call1 = {
  target: BASE_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [BASE_CROSS_CHAIN_ACCOUNT, baseV3Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: '',
};

// Action 2: Arbitrum V3 factory → V3OpenFeeAdapter (retryable ticket)
const call2 = {
  target: ARB_INBOX,
  calldata: encodeFunctionData({
    abi: ArbitrumDelayedInboxAbi as unknown as readonly unknown[],
    functionName: 'createRetryableTicket',
    args: [
      ARB_V3_FACTORY,
      0n,
      ARB_MAX_SUBMISSION_COST,
      ARB_ALIASED_TIMELOCK,
      ARB_ALIASED_TIMELOCK,
      ARB_GAS_LIMIT,
      ARB_MAX_FEE_PER_GAS,
      encodeFunctionData({
        abi: v3FactoryAbi as unknown as readonly unknown[],
        functionName: 'setOwner',

        args: [ARB_FEE_ADAPTER],
      }),
    ],
  }),
  value: ARB_VALUE,
  signature: '',
};

// Action 3: Mainnet V3FeeAdapter → V3OpenFeeAdapter
const call3 = {
  target: MAINNET_V3_FEE_ADAPTER,
  calldata: encodeFunctionData({
    abi: V3_FEE_ADAPTER_ABI,
    functionName: 'setFactoryOwner',
    args: [MAINNET_V3_OPEN_FEE_ADAPTER],
  }),
  value: 0n,
  signature: '',
};

// Action 4: OP Mainnet V2 factory feeTo → TokenJar
const opV2Forward = encodeFunctionData({
  abi: L2CrossChainAccount as unknown as readonly unknown[],
  functionName: 'forward',
  args: [
    OP_V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [OP_TOKEN_JAR],
    }),
  ],
});
const call4 = {
  target: OP_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [OP_CROSS_CHAIN_ACCOUNT, opV2Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: '',
};

// Action 5: Base V2 factory feeTo → TokenJar
const baseV2Forward = encodeFunctionData({
  abi: L2CrossChainAccount as unknown as readonly unknown[],
  functionName: 'forward',
  args: [
    BASE_V2_FACTORY,
    encodeFunctionData({
      abi: V2_FACTORY_ABI,
      functionName: 'setFeeTo',
      args: [BASE_TOKEN_JAR],
    }),
  ],
});
const call5 = {
  target: BASE_L1_MESSENGER,
  calldata: encodeFunctionData({
    abi: SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [BASE_CROSS_CHAIN_ACCOUNT, baseV2Forward, XDM_GAS_LIMIT],
  }),
  value: 0n,
  signature: '',
};

// Action 6: Arbitrum V2 factory feeTo → TokenJar (retryable ticket)
const call6 = {
  target: ARB_INBOX,
  calldata: encodeFunctionData({
    abi: ArbitrumDelayedInboxAbi as unknown as readonly unknown[],
    functionName: 'createRetryableTicket',
    args: [
      ARB_V2_FACTORY,
      0n,
      ARB_MAX_SUBMISSION_COST,
      ARB_ALIASED_TIMELOCK,
      ARB_ALIASED_TIMELOCK,
      ARB_GAS_LIMIT,
      ARB_MAX_FEE_PER_GAS,
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [ARB_TOKEN_JAR],
      }),
    ],
  }),
  value: ARB_VALUE,
  signature: '',
};

// Action 7: Celo Wormhole handoff — V3 setOwner, V2 setFeeToSetter, V4 PoolManager transferOwnership
const celoTargets = [CELO_V3_FACTORY, CELO_V2_FACTORY, CELO_V4_POOL_MANAGER] as const;
const celoValues = [0n, 0n, 0n] as const;
const celoDatas = [
  encodeFunctionData({
    abi: v3FactoryAbi as unknown as readonly unknown[],
    functionName: 'setOwner',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
  encodeFunctionData({
    abi: V2_FACTORY_ABI,
    functionName: 'setFeeToSetter',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
  encodeFunctionData({
    abi: OWNED_ABI,
    functionName: 'transferOwnership',
    args: [CELO_CROSS_CHAIN_ACCOUNT],
  }),
] as const;
const call7 = {
  target: WORMHOLE_SENDER,
  calldata: encodeFunctionData({
    abi: WORMHOLE_SENDER_ABI,
    functionName: 'sendMessage',
    args: [
      [...celoTargets],
      [...celoValues],
      [...celoDatas],
      WORMHOLE_BRIDGE,
      WORMHOLE_CELO_CHAIN_ID,
    ],
  }),
  value: 0n,
  signature: '',
};

const calls = [call0, call1, call2, call3, call4, call5, call6, call7];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
  governorType: 'bravo',
  targets: calls.map((c) => c.target),
  values: calls.map((c) => c.value),
  signatures: calls.map((c) => c.signature as `0x${string}`),
  calldatas: calls.map((c) => c.calldata),
  description: `# Protocol Fee Expansion: Vote 1

## Proposal Spec

If this proposal passes, it will execute ten transactions: 

\`\`\`
/// Transition to v3OpenFeeAdapter on Mainnet

/// Change the owner on UniswapV3Factory to v3OpenFeeAdapter
V3_FEE_ADAPTER.setFactoryOwner(address(v3OpenFeeAdapter));

/// Enable fees on Arbitrum, Base, and OP Mainnet. For each chain:

/// Set the owner of the V3 Factory to the V3OpenFeeAdapter
V3_FACTORY.setOwner(address(v3OpenFeeAdapter));

/// Set the recipient of V2 protocol fees to the TokenJar
V2_FACTORY.setFeeTo(address(tokenJar));

/// Transition to CrossChainAccount ownership on Celo

/// Transfer v2 setFeeToSetter role
V2_FACTORY.setFeeToSetter(CrossChainAccount)

/// Transfer UniswapV3Factory owner role 
V3_FACTORY.setOwner(CrossChainAccount)

// Transfer Uniswap v4 PoolManager owner role
POOL_MANAGER.transferOwnership(CrossChainAccount)
\`\`\`

Because these transactions are crosschain, governance front ends may not decode them correctly. We recommend reviewing the [Seatbelt simulation report](https://github.com/uniswapfoundation/governance-seatbelt/actions) to confirm their validity.

### Relevant Addresses

**Mainnet**

| **Contract** | **Address** |
| --- | --- |
| V3OpenFeeAdapter | [\`0x3e40DB80450f025b01E45c58b0aF763C7A29a8bd\`](https://etherscan.io/address/0x3e40DB80450f025b01E45c58b0aF763C7A29a8bd) |
| V3FeeAdapter | [\`0x5E74C9f42EEd283bFf3744fBD1889d398d40867d\`](https://etherscan.io/address/0x5E74C9f42EEd283bFf3744fBD1889d398d40867d) |

**Arbitrum**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x95E337C5B155385945D407f5396387D0c2a3A263\`](https://arbiscan.io/address/0x95E337C5B155385945D407f5396387D0c2a3A263) |
| Releaser (ArbitrumBridgedResourceFirepit) | [\`0xB8018422bcE25D82E70cB98FdA96a4f502D89427\`](https://arbiscan.io/address/0xB8018422bcE25D82E70cB98FdA96a4f502D89427) |
| V3OpenFeeAdapter | [\`0xFF7aD5dA31fECdC678796c88B05926dB896b0699\`](https://arbiscan.io/address/0xFF7aD5dA31fECdC678796c88B05926dB896b0699) |
| UniswapV3Factory | [\`0x1F98431c8aD98523631AE4a59f267346ea31F984\`](https://arbiscan.io/address/0x1F98431c8aD98523631AE4a59f267346ea31F984) |
| UniswapV2Factory | [\`0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9\`](https://arbiscan.io/address/0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9) |

**OP Mainnet**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0xb13285DF724ea75f3f1E9912010B7e491dCd5EE3\`](https://optimistic.etherscan.io/address/0xb13285DF724ea75f3f1E9912010B7e491dCd5EE3) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0x94460443Ca27FFC1baeCa61165fde18346C91AbD\`](https://optimistic.etherscan.io/address/0x94460443Ca27FFC1baeCa61165fde18346C91AbD) |
| V3OpenFeeAdapter | [\`0xec23Cf5A1db3dcC6595385D28B2a4D9B52503Be4\`](https://optimistic.etherscan.io/address/0xec23Cf5A1db3dcC6595385D28B2a4D9B52503Be4) |
| UniswapV3Factory | [\`0x1F98431c8aD98523631AE4a59f267346ea31F984\`](https://optimistic.etherscan.io/address/0x1F98431c8aD98523631AE4a59f267346ea31F984) |
| UniswapV2Factory | [\`0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf\`](https://optimistic.etherscan.io/address/0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf#readContract) |

**Base**

| **Contract** | **Address** |
| --- | --- |
| TokenJar | [\`0x9bD25e67bF390437C8fAF480AC735a27BcF6168c\`](https://basescan.org/address/0x9bD25e67bF390437C8fAF480AC735a27BcF6168c) |
| Releaser (OptimismBridgedResourceFirepit) | [\`0xFf77c0ED0B6b13A20446969107E5867abc46f53a\`](https://basescan.org/address/0xFf77c0ED0B6b13A20446969107E5867abc46f53a) |
| V3OpenFeeAdapter | [\`0xaBEA76658b205696d49B5F91b2a03536cB8A3bE1\`](https://basescan.org/address/0xaBEA76658b205696d49B5F91b2a03536cB8A3bE1) |
| UniswapV3Factory | [\`0x33128a8fC17869897dcE68Ed026d694621f6FDfD\`](https://basescan.org/address/0x33128a8fC17869897dcE68Ed026d694621f6FDfD) |
| UniswapV2Factory | [\`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6\`](https://basescan.org/address/0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6) |

**Celo**

| **Contract** | **Address** |
| --- | --- |
| CrossChainAccount | [\`0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7\`](https://celoscan.io/address/0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7) |
| UniswapV3Factory | [\`0xAfE208a311B21f13EF87E33A90049fC17A7acDEc\`](https://celoscan.io/address/0xAfE208a311B21f13EF87E33A90049fC17A7acDEc) |
| UniswapV2Factory | [\`0x114A43DF6C5f54EBB8A9d70Cd1951D3dD68004c7\`](https://celoscan.io/address/0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7#code) |

## Proposal

*This is the first proposal to use the new governance process [approved](https://gov.uniswap.org/t/unification-proposal/25881#p-57882-protocol-fee-rollout-4) in UNIfication. The new process only applies to fee parameter updates, where proposals can bypass the RFC stage and go directly to a five-day Snapshot followed by an onchain vote. This allows for faster updates to protocol fees, while retaining the security of onchain governance.*

Snapshot vote [here](https://snapshot.box/#/s:uniswapgovernance.eth/proposal/0x0242a914c60945d25873d2a98c6abd9f69cb889c6616e27f3c0ab759f9e8d783).

Since UNIfication went live in late December we have been monitoring protocol fees, which were rolled out gradually to ensure protocol health. This started with v2 and select v3 pools on Ethereum mainnet. This rollout has gone well, with market-adjusted TVL [up](https://defillama.com/protocol/uniswap?fees=false&events=false&denomination=ETH) on Ethereum mainnet since December. The burn system is working as expected, permissionlessly converting fees in [many different tokens](https://dune.com/queries/6711845) into UNI burns.

Now, we propose to:

- Expand protocol fees on v2 and v3 to Arbitrum, Base, Celo, OP Mainnet, Soneium, X Layer, Worldchain, and Zora
- Enable protocol fees on all v3 pools via a new tier-based [v3OpenFeeAdapter](https://github.com/Uniswap/protocol-fees/blob/main/src/feeAdapters/V3OpenFeeAdapter.sol) on mainnet and the above L2s

### **Implementation Details**

**Expand protocol fees to L2s and burn UNI on mainnet**

This proposal introduces v2 and v3 protocol fees on eight chains. Fees on each chain will be routed to the TokenJar on that respective chain.

UNI burned on L2s doesn't stay on L2s - it is bridged back to mainnet and sent to 0xdead. This uses the same infrastructure used for burning Unichain sequencer fees ([OptimismBridgedResourceFirepit](https://github.com/Uniswap/protocol-fees/blob/main/src/releasers/OptimismBridgedResourceFirepit.sol) for OP Stack chains, and [ArbitrumBridgedResourceFirepit](https://github.com/Uniswap/protocol-fees/blob/main/src/releasers/ArbitrumBridgedResourceFirepit.sol) for Arbitrum).

**Enable fees on all v3 pools**

The current v3FeeAdapter manages protocol fees pool by pool and governance maintains a list of individual pools and their fee levels. Today, those pools account for a significant majority of v3 volume on Ethereum mainnet.

v3OpenFeeAdapter replaces this with a tier-based system. Protocol fees are set uniformly across all pools sharing the same LP fee tier. For example, all 1bps LP fee pools could have protocol fees set to 25%. Any pool automatically gets the default protocol fee for its tier, no governance action is needed. This means if this proposal passes, protocol fees will be active on every v3 pool. Governance retains the ability to override fees on individual pools.

### **Governance Process**

Please note that because of GovernorBravo’s limit of 10 actions per proposal, there will be two separate onchain votes posted in parallel. One proposal will include the change to mainnet’s fee controller and turn on fees on Base, OP Mainnet, and Arbitrum, the other will turn on fees on Celo, Soneium, Worldchain, X Layer, and Zora.`,
};
