import { encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, parseAbi, parseAbiParameter, parseAbiParameters, parseEther, parseGwei, toBytes } from 'viem';

import type { SimulationConfigNew } from "../types";

const OMNICHAIN_PROPOSAL_SENDER_ABI = parseAbi([
    "function execute(uint16 remoteChainId, bytes calldata payload, bytes calldata adapterParams)",
    "function setTrustedRemoteAddress(uint16 remoteChainId, bytes calldata remoteAddress)"
]);

const PROXY_ADMIN_ABI = parseAbi([
    "function transferOwnership(address)",
    "function changeProxyAdmin(address proxy, address newAdmin)"
]);

const V2_FACTORY_ABI = parseAbi([
    "function setFeeToSetter(address)"
]);

const V3_FACTORY_ABI = parseAbi([
    "function setOwner(address)"
]);

const POOL_MANAGER_ABI = parseAbi([
    "function transferOwnership(address)"
]);

const OP_PORTAL2_ABI = parseAbi([
    "function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes memory _data)"
]);

const ETHEREUM = {
    OMNICHAIN_PROPOSAL_SENDER: getAddress("0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc"),
};

const MEGA = {
    OMNICHAIN_GOVERNANCE_EXECUTOR: getAddress("0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c"),
    OMNICHAIN_GOVERNANCE_EXECUTOR_2: getAddress("0x51F9629C1e75aF07421E662DBEb2B7dc8deDefd9"),
    LZ_ENDPOINT: getAddress("0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7"),
    WORMHOLE_RECEIVER: getAddress("0xa107580F73BD797Bd8b87Ff24e98346D99F93DdB"),
    V2_FACTORY: getAddress("0xbf56488c857A881ae7e3BED27Cf99c10A7Ab7e50"),
    V3_FACTORY: getAddress("0x3a5F0CD7d62452b7f899B2A5758BFa57be0dE478"),
    POOL_MANAGER: getAddress("0xaCB7e78fa05D562e0A5D3089ec896D57D057d38E"),
    V3_PROXY_ADMIN: getAddress("0xdaFBcEB5cA32Dc1DD27A413dA361F32636694BC4"),
    V4_PROXY_ADMIN: getAddress("0x07e7c1cEd961e2C11196751A1aC76E64b0e8b007"),
    V3_POSITION_DESCRIPTOR: getAddress("0x8D9F62d363486ebadD3F3d735301a99a487a8fD8"),
    V4_POSITION_DESCRIPTOR: getAddress("0xA9fDbB9D3dce2e1cFB91c4AF1B8Cf4ed62c0041A"),
};

const AVAX = {
    OMNICHAIN_GOVERNANCE_EXECUTOR: getAddress("0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc"),
    LZ_ENDPOINT: getAddress("0x3c2269811836af69497E5F486A85D7316753cf62"),
    WORMHOLE_RECEIVER: getAddress("0x47eB0Cf11a1626462Da3C830bCDe64c3F582B5a6"),
    V2_FACTORY: getAddress("0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C"),
    V3_FACTORY: getAddress("0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD"),
    POOL_MANAGER: getAddress("0x06380C0e0912312B5150364B9DC4542BA0DbBc85"),
    V3_PROXY_ADMIN: getAddress("0x9AdA7D7879214073F40183F3410F2b3f088c6381"),
    V4_PROXY_ADMIN: getAddress("0x9b0481d2A2912051f56dC0B806cafe6bdE461c3D"),
    V3_POSITION_DESCRIPTOR: getAddress("0xE1f93a7cB6fFa2dB4F9d5A2FD43158A428993C09"),
    V4_POSITION_DESCRIPTOR: getAddress("0x2b1AED9445B05AC1A3B203eCCC1e25dD9351F0A9"),
};

const SONEIUM = {
    V2_FACTORY: getAddress("0x97FeBbC2AdBD5644ba22736E962564B23F5828CE"),
    POOL_MANAGER: getAddress("0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32"),
    OPTIMISM_PORTAL2: getAddress("0x88e529A6ccd302c948689Cd5156C83D4614FAE92"),
    CROSS_CHAIN_ACCOUNT: getAddress("0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7"),
};

const X_LAYER = {
    V2_FACTORY: getAddress("0xDf38F24fE153761634Be942F9d859f3DBA857E95"),
    POOL_MANAGER: getAddress("0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32"),
    OPTIMISM_PORTAL2: getAddress("0x64057ad1DdAc804d0D26A7275b193D9DACa19993"),
    CROSS_CHAIN_ACCOUNT: getAddress("0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7"),
};

const LZ_AVAX_CHAIN_ID = 106;
const LZ_MEGA_CHAIN_ID = 398;

// -------------------------------------------------------------------------------------------------
// NN: (Ethereum) Set Layer Zero Trusted Remote For Mega
//
const ethSetTrustedRemoteToMega0x88 = {
    target: ETHEREUM.OMNICHAIN_PROPOSAL_SENDER,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OMNICHAIN_PROPOSAL_SENDER_ABI,
        functionName: "setTrustedRemoteAddress",
        args: [
            LZ_MEGA_CHAIN_ID,
            encodePacked(["address"], [MEGA.OMNICHAIN_GOVERNANCE_EXECUTOR])
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: (Mega) Transfer Ownership on MegaETH from Layer Zero to Wormhole
//
const megaLzTransferOwnershipCalls = [
    {
        target: MEGA.V2_FACTORY,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: V2_FACTORY_ABI,
            functionName: "setFeeToSetter",
            args: [MEGA.WORMHOLE_RECEIVER]
        })
    },
    {
        target: MEGA.V3_FACTORY,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: V3_FACTORY_ABI,
            functionName: "setOwner",
            args: [MEGA.WORMHOLE_RECEIVER]
        })
    },
    {
        target: MEGA.POOL_MANAGER,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: POOL_MANAGER_ABI,
            functionName: "transferOwnership",
            args: [MEGA.WORMHOLE_RECEIVER]
        })
    },
    {
        target: MEGA.V4_PROXY_ADMIN,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: PROXY_ADMIN_ABI,
            functionName: "transferOwnership",
            args: [MEGA.WORMHOLE_RECEIVER]
        })
    },
];

const megaTransferOwnershipFromLzToWormhole = {
    target: ETHEREUM.OMNICHAIN_PROPOSAL_SENDER,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OMNICHAIN_PROPOSAL_SENDER_ABI,
        functionName: "execute",
        args: [
            LZ_MEGA_CHAIN_ID,
            encodeAbiParameters(
                parseAbiParameters("address[] targets, uint256[] values, string[] signatures, bytes[] datas"),
                [
                    megaLzTransferOwnershipCalls.map(lzCall => lzCall.target),
                    megaLzTransferOwnershipCalls.map(lzCall => lzCall.value),
                    megaLzTransferOwnershipCalls.map(lzCall => lzCall.signature),
                    megaLzTransferOwnershipCalls.map(lzCall => lzCall.calldata),
                ]
            ),
            "0x"
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: Transfer Ownership on Avax from Layer Zero to Wormhole
//
const avaxLzTransferOwnershipCalls = [
        {
        target: AVAX.V2_FACTORY,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: V2_FACTORY_ABI,
            functionName: "setFeeToSetter",
            args: [AVAX.WORMHOLE_RECEIVER]
        })
    },
    {
        target: AVAX.V3_FACTORY,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: V3_FACTORY_ABI,
            functionName: "setOwner",
            args: [AVAX.WORMHOLE_RECEIVER]
        })
    },
    {
        target: AVAX.POOL_MANAGER,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: POOL_MANAGER_ABI,
            functionName: "transferOwnership",
            args: [AVAX.WORMHOLE_RECEIVER]
        })
    },
    {
        target: AVAX.V3_PROXY_ADMIN,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: PROXY_ADMIN_ABI,
            functionName: "changeProxyAdmin",
            args: [
                AVAX.V3_POSITION_DESCRIPTOR,
                AVAX.V4_PROXY_ADMIN,
            ]
        })
    },
    {
        target: AVAX.V4_PROXY_ADMIN,
        value: 0n,
        signature: "",
        calldata: encodeFunctionData({
            abi: PROXY_ADMIN_ABI,
            functionName: "transferOwnership",
            args: [
                AVAX.WORMHOLE_RECEIVER
            ]
        })
    }
];

const avaxTransferOwnershipFromLztoWormhole = {
    target: ETHEREUM.OMNICHAIN_PROPOSAL_SENDER,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OMNICHAIN_PROPOSAL_SENDER_ABI,
        functionName: "execute",
        args: [
            LZ_AVAX_CHAIN_ID,
            encodeAbiParameters(
                parseAbiParameters("address[] targets, uint256[] values, string[] signatures, bytes[] datas"),
                [
                    avaxLzTransferOwnershipCalls.map(lzCall => lzCall.target),
                    avaxLzTransferOwnershipCalls.map(lzCall => lzCall.value),
                    avaxLzTransferOwnershipCalls.map(lzCall => lzCall.signature),
                    avaxLzTransferOwnershipCalls.map(lzCall => lzCall.calldata),
                ]
            ),
            "0x"
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: Transfer V2 Fee Setter on Soneium from OptimismPortal2 to CrossChainAccount
//
const soneiumV2SetFeeToSetter = {
    target: SONEIUM.OPTIMISM_PORTAL2,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OP_PORTAL2_ABI,
        functionName: "depositTransaction",
        args: [
            SONEIUM.V2_FACTORY,
            0n,
            200_000n,
            false,
            encodeFunctionData({
                abi: V2_FACTORY_ABI,
                functionName: "setFeeToSetter",
                args: [SONEIUM.CROSS_CHAIN_ACCOUNT]
            })
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: Transfer V4 Ownership on Soneium from OptimismPortal2 to CrossChainAccount
//
const soneiumPoolManagerTransferOwnership = {
    target: SONEIUM.OPTIMISM_PORTAL2,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OP_PORTAL2_ABI,
        functionName: "depositTransaction",
        args: [
            SONEIUM.POOL_MANAGER,
            0n,
            200_000n,
            false,
            encodeFunctionData({
                abi: POOL_MANAGER_ABI,
                functionName: "transferOwnership",
                args: [SONEIUM.CROSS_CHAIN_ACCOUNT]
            })
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// 06: Transfer V2 Fee Setter on XLayer from OptimismPortal2 to CrossChainAccount
//
const xLayerV2SetFeeToSetter = {
    target: X_LAYER.OPTIMISM_PORTAL2,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OP_PORTAL2_ABI,
        functionName: "depositTransaction",
        args: [
            X_LAYER.V2_FACTORY,
            0n,
            200_000n,
            false,
            encodeFunctionData({
                abi: V2_FACTORY_ABI,
                functionName: "setFeeToSetter",
                args: [X_LAYER.CROSS_CHAIN_ACCOUNT]
            })
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: Transfer V4 Ownership on XLayer from OptimismPortal2 to CrossChainAccount
//
const xLayerPoolManagerTransferOwnership = {
    target: X_LAYER.OPTIMISM_PORTAL2,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OP_PORTAL2_ABI,
        functionName: "depositTransaction",
        args: [
            X_LAYER.POOL_MANAGER,
            0n,
            200_000n,
            false,
            encodeFunctionData({
                abi: POOL_MANAGER_ABI,
                functionName: "transferOwnership",
                args: [X_LAYER.CROSS_CHAIN_ACCOUNT]
            })
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: (Ethereum) Set Layer Zero Trusted Remote For Mega (OPTIONAL)
//
const ethSetTrustedRemoteToMega0x55 = {
    target: ETHEREUM.OMNICHAIN_PROPOSAL_SENDER,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OMNICHAIN_PROPOSAL_SENDER_ABI,
        functionName: "setTrustedRemoteAddress",
        args: [
            LZ_MEGA_CHAIN_ID,
            encodePacked(["address"], [MEGA.OMNICHAIN_GOVERNANCE_EXECUTOR_2])
        ]
    })
};

// -------------------------------------------------------------------------------------------------
// NN: (Mega) Change ProxyAdmin for NonfungiblePositionDescriptor (OPTIONAL)
//
const megaChangeProxyAdmin = {
    target: ETHEREUM.OMNICHAIN_PROPOSAL_SENDER,
    value: 0n,
    signature: "",
    calldata: encodeFunctionData({
        abi: OMNICHAIN_PROPOSAL_SENDER_ABI,
        functionName: "execute",
        args: [
            LZ_MEGA_CHAIN_ID,
            encodeAbiParameters(
                parseAbiParameters("address[] targets, uint256[] values, string[] signatures, bytes[] datas"),
                [
                    [MEGA.V3_PROXY_ADMIN],
                    [0n],
                    [""],
                    [
                        encodeFunctionData({
                            abi: PROXY_ADMIN_ABI,
                            functionName: "changeProxyAdmin",
                            args: [
                                MEGA.V3_POSITION_DESCRIPTOR,
                                MEGA.V4_PROXY_ADMIN
                            ]
                        })
                    ],
                ]
            ),
            "0x"
        ]
    })
};

const actions = [
    ethSetTrustedRemoteToMega0x88,
    megaTransferOwnershipFromLzToWormhole,
    avaxTransferOwnershipFromLztoWormhole,
    soneiumV2SetFeeToSetter,
    soneiumPoolManagerTransferOwnership,
    xLayerV2SetFeeToSetter,
    xLayerPoolManagerTransferOwnership,
    ethSetTrustedRemoteToMega0x55,
    megaChangeProxyAdmin,
];

export const config: SimulationConfigNew = {
    type: "new",
    daoName: "Uniswap",
    governorAddress: getAddress("0x408ED6354d4973f66138C91495F2f2FCbd8724C3"),
    governorType: "bravo",
    targets: actions.map(action => action.target),
    values: actions.map(action => action.value),
    signatures: actions.map(action => action.signature),
    calldatas: actions.map(action => action.calldata),
    description: `
# [RFC] Update Crosschain Governance Parameters for Avalanche, MegaETH, Soneium, and X Layer

## Summary

Secure crosschain messaging is an integral part of Uniswap's governance model. Governance votes like protocol fee adjustments are executed by UNI holders on Ethereum Mainnet and must subsequently be relayed to destination chains.



This proposal updates Uniswap's crosschain governance system to accommodate the latest best practices. Specifically, we propose to:



* Transition ownership of the Uniswap v2 and v4 contracts on Soneium and X Layer to CrossChainAccount contracts, which we consider to be the current best practice for executing messages from Ethereum Mainnet on the OP Stack

* Migrate the entire messaging system for the Avalanche and MegaETH deployments from LayerZero v1 (part of which is [being deprecated](https://layerzero.network/blog/ongoing-security-updates)) to Wormhole 



Note that because Uniswap v3 on both Soneium and X Layer is owned by the \`v3OpenFeeAdapter\`, which is owned by the CrossChainAccount, we do not need to change the parameter on v3 on these chains.



---

## Specification

### Current Configuration - Avalanche and MegaETH

Both chains currently use LayerZero v1 for governance messaging:

| Contract | Chain | Address |
| :---- | :---- | :---- |
| OmnichainProposalSender | Ethereum | [0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc](https://etherscan.io/address/0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc) |
| OmnichainGovernanceExecutor | Avalanche | [0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc](https://snowtrace.io/address/0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc) |
| OmnichainGovernanceExecutor | MegaETH | [0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c](https://explorer.megaeth.com/address/0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c) |

### Proposed Configuration - Avalanche and MegaETH

The LayerZero contracts are replaced with the Wormhole bridge infrastructure from [uniswapfoundation/Uniswap-Wormhole-Bridge](https://github.com/uniswapfoundation/Uniswap-Wormhole-Bridge):

**UniswapWormholeSender (Ethereum):** The existing sender contract already deployed on mainnet will be reused — no new deployment required. 

**UniswapWormholeReceiver (Avalanche and MegaETH):** Uniswap Labs has deployed new UniswapWormholeReceiver contracts on both chains. This proposal will authorize them as the trusted governance executors for each chain.

| Contract | Chain | Address |
| :---- | :---- | :---- |
| UniswapWormholeSender | Ethereum | [0xf5F4496219F31CDCBa6130B5402873624585615a](https://etherscan.io/address/0xf5F4496219F31CDCBa6130B5402873624585615a) |
| UniswapWormholeReceiver | Avalanche | [0x47eB0Cf11a1626462Da3C830bCDe64c3F582B5a6](https://snowtrace.io/address/0x47eB0Cf11a1626462Da3C830bCDe64c3F582B5a6) |
| UniswapWormholeReceiver | MegaETH | [0xa107580F73BD797Bd8b87Ff24e98346D99F93DdB](https://explorer.megaeth.com/address/0xa107580F73BD797Bd8b87Ff24e98346D99F93DdB) |

For a detailed discussion of how Wormhole works, please see [this report](https://uniswap.notion.site/Assessment-dac583c6db1240c7b9d294afd7f18035) by the Uniswap Foundation's Bridge Assessment Committee.

### Current Configuration - Soneium and X Layer

On both chains, the UniswapV2Factory's feeToSetter parameter and the v4 PoolManager's owner parameter are configured as the mainnet Timelock's alias address.
| Account | Chain | Address |
| :---- | :---- | :---- |
| Alias Address | X Layer | [0x2BAD8182C09F50c8318d769245beA52C32Be46CD](https://www.oklink.com/x-layer/evm/address/0x2bad8182c09f50c8318d769245bea52c32be46cd) |
| Alias Address | Soneium | [0x2BAD8182C09F50c8318d769245beA52C32Be46CD](https://soneium.blockscout.com/address/0x2BAD8182C09F50c8318d769245beA52C32Be46CD) |

### Proposed Configuration - Soneium and X Layer

This proposal will change those parameters to a CrossChainAccount contract deployed by Uniswap Labs.
| Contract | Chain | Address |
| :---- | :---- | :---- |
| CrossChainAccount | X Layer | [0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7](https://www.oklink.com/x-layer/evm/address/0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7) |
| CrossChainAccount | Soneium | [0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7](https://soneium.blockscout.com/address/0x044aAF330d7fD6AE683EEc5c1C1d1fFf5196B6b7?tab=contract) |

### Onchain Proposal Spec

**Pre-proposal** (already completed by Uniswap Labs):

* Deploy \`UniswapWormholeReceiver\` on Avalanche C-Chain, configured with the Wormhole Core Bridge address for Avalanche and the address of the existing UniswapWormholeSender.

* Deploy \`UniswapWormholeReceiver\` on MegaETH, configured with the Wormhole Core Bridge address for MegaETH and the address of the existing UniswapWormholeSender.

* Deploy \`CrossChainAccount\` contracts on Soneium and X Layer

**In this proposal** (executed if the vote passes):

Execute seven actions:

1. Finalize LayerZero configuration on MegaETH

2. Transfer ownership of the protocol on MegaETH from LayerZero to Wormhole 

3. Transfer ownership of the protocol on Avalanche from LayerZero to Wormhole

4. Change v2's \`feeToSetter\` on X Layer from the alias address to the \`CrosschainAccount\`

5. Change v4's \`owner\` on X Layer from the alias address to the \`CrosschainAccount\`

6. Change v2's \`feeToSetter\` on Soneium from the alias address to the \`CrosschainAccount\`

7. Change v4's \`owner\` on Soneium from the alias address to the \`CrosschainAccount\`



---

## Next Steps / Timeline

* **RFC:** Jun 19, 2026

* **Snapshot:** \~1 week after RFC

* **Onchain vote:** Following Snapshot, per standard governance cadence

---

## Supporting Documents

* [Uniswap Foundation Bridge Assessment Report](https://uniswap.notion.site/Bridge-Assessment-Report-0c8477afadce425abac9c0bd175ca382)

* [Uniswap-Wormhole-Bridge GitHub](https://github.com/uniswapfoundation/Uniswap-Wormhole-Bridge)

* [LayerZero v1 deprecation announcement](https://layerzero.network/blog/ongoing-security-updates)

* [Original Avalanche deployment proposal](https://gov.uniswap.org/t/deploy-uniswap-v3-on-avalanche/20587)
`
};
