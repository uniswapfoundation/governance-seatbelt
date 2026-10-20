# Uniswap treasury accounts

The registry in `utils/treasury-movement.ts` tracks governance execution accounts and protocol-fee TokenJars on each supported chain. Ethereum additionally uses the governor's timelock read from chain. It does not treat pool liquidity or every governance-owned contract as treasury.

## Sources and verification

- [Protocol-fee deployments and governance scripts](https://github.com/Uniswap/protocol-fees/tree/0c071d199dc32556365c78e03ec3f4d09b9fbf37): TokenJars, releasers and governance owners.
- [Official factory deployments](https://github.com/Uniswap/briefcase/tree/eae30a8a1f86028a361270e5c23326fda90227f3/deployments): factory `owner()` / `feeToSetter()` and initial executors.
- [Proposal 102](https://vote.uniswapfoundation.org/proposals/102): Arc receiver and TokenJar.
- [Accountability Committee's deployment list](https://gov.uniswap.org/t/official-uniswap-v3-deployments-list/24323): BOB v3 factory.

Read-only verification on 2026-10-20 checked each TokenJar's `owner()` and `releaser()`, then the releaser's `owner()`. Both owners matched the governance account below. The exception is Zora: its owner was checked through the public RPC because the account's QuickNode endpoint returned HTTP 401; QuickNode simulation remains unavailable without its add-on. No purchase was made. Empty bytecode at the aliased timelock is expected.

| Chain | Governance account | TokenJar | Verification block |
| --- | --- | --- | --- |
| Ethereum (1) | `0x1a9c8182c09f50c8318d769245bea52c32be35bc` | `0xf38521f130fcCF29dB1961597bc5d2B60F995f85` | 26236414 |
| Unichain (130) | `0x2bad8182c09f50c8318d769245bea52c32be46cd` | `0xD576BDF6b560079a4c204f7644e556DbB19140b5` | 61782492 |
| World Chain (480) | `0xcb2436774c3e191c85056d248ef4260ce5f27a9d` | `0xbDb82c2dE7D8748A3e499e771604ef8ef8544918` | 36597606 |
| Soneium (1868) | `0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7` | `0x85aeb792b94a9d79741002FC871423Ec5dAD29e9` | 29698051 |
| Celo (42220) | `0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7` | `0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B` | 80630095 |
| Zora (7777777) | `0x36eec182d0b24df3dc23115d64db521a93d5154f` | `0x4753C137002D802f45302b118E265c41140e73C2` | public RPC owner read |
| X Layer (196) | `0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7` | `0x8Dd8B6D56e4a4A158EDbBfE7f2f703B8FFC1a754` | 73761818 |
| Arbitrum (42161) | `0x2bad8182c09f50c8318d769245bea52c32be46cd` | `0x95E337C5B155385945D407f5396387D0c2a3A263` | 516715647 |
| Optimism (10) | `0xa1dd330d602c32622aa270ea73d078b803cb3518` | `0xb13285DF724ea75f3f1E9912010B7e491dCd5EE3` | 158466039 |
| Base (8453) | `0x31fafd4889fa1269f7a13a66ee0fb458f27d72a9` | `0x9bD25e67bF390437C8fAF480AC735a27BcF6168c` | 52870754 |
| Polygon (137) | `0x8a1b966ac46f42275860f905dbc75efbfdc12374` | `0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A` | 95883658 |
| BNB (56) | `0x341c1511141022cf8ee20824ae0ffa3491f1302b` | `0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A` | 128816209 |
| Robinhood (4663) | `0x2bad8182c09f50c8318d769245bea52c32be46cd` | `0x2aC03e14Cfe755426DaAEe0a4994184Ce81482F8` | 93753765 |
| Arc (5042) | `0xbca30b5429935205037069cf5b8a165f55d05a75` | `0xfd39ac616e630e9db03EFB2c9a4Fe63eDB949233` | 27005114 |

Soneium and X Layer also track `0x2BAD8182C09F50c8318d769245beA52C32Be46CD`, used by direct portal calls. Celo retains the prior Wormhole receiver `0x0Eb863541278308c3A64F8E908BC646e27BFD071` alongside its current account; historical proposals transfer authority between them.

The remaining chains have no TokenJar listed in the protocol-fee deployment records. Their official v2 factories returned zero `feeTo`; the registry tracks their governance accounts only:

| Chain | Accounts | Evidence |
| --- | --- | --- |
| Monad (143) | `0xe783de89a7f0408687f051e3e6d0beb62719ebad` | Official factory roles at block 115144541; previous executors from deployment records where applicable |
| Tempo (4217) | `0xcfb43dc56b55be9611ded8384201cecf06a9811b` | Official factory roles at block 45088382; previous executors from deployment records where applicable |
| MegaETH (4326) | `0xa107580f73bd797bd8b87ff24e98346d99f93ddb`; `0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c` | Official factory roles at block 29733847; previous executors from deployment records where applicable |
| Ink (57073) | `0x2bad8182c09f50c8318d769245bea52c32be46cd`; `0x66c5d722fc52671c7f839bbbf752bc38e0520b91` | Official factory roles at block 59032448; previous executors from deployment records where applicable |
| Avalanche (43114) | `0x47eb0cf11a1626462da3c830bcde64c3f582b5a6`; `0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc` | Official factory roles at block 98091592; previous executors from deployment records where applicable |
| BOB (60808) | `0xa683c66045ad16abb1bce5ad46a64d95f9a25785` | `owner()` of official v3 factory `0xcb2436774C3e191c85056d248EF4260ce5f27A9D`, public RPC; no v2/TokenJar claim |

These are static, reviewed addresses, not automatic discovery of future deployments. Add newly approved treasury accounts to the registry when governance expands. Unknown governors/chains do not inherit Ethereum's timelock on destination chains.

## What the checks establish

Multi-call destination reports retain each call separately. USD thresholds are evaluated per call, not across the whole proposal.

Configured accounts get pinned native balances and before/after reads for detected tokens, even when untouched. New native recipients omitted by a node's prestate tracer are read separately. Failed reads and prices remain unavailable. This does not enumerate all treasury tokens, all rebasing holders, or exact historical ERC-20 transaction state.

Client fee rules differ. Verified clients that debit the gas budget receive exactly that budget for hypothetical bridge execution; the unused refund is removed afterwards. OP clients that skip that debit receive no extra balance. Arc's artificial refund is removed without adding funding. Native balance opcodes are checked in opt-in live tests. Nitro's fictional ArbOS fee-storage account cannot be overridden and is not carried as an EVM treasury/account; chain-internal fee state is not replayed across simulated calls.

Run `RUN_CHAIN_RPC_TESTS=1 bun test tests/rpc-chain-balances.live.test.ts` and `RUN_ARC_RPC_TESTS=1 bun test tests/rpc-arc.live.test.ts` with the relevant RPC environment variables. All calls use state overrides; nothing is signed or broadcast.
