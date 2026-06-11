# Cross-Chain Integration Guide

This document describes the bridge architecture, supported Uniswap cross-chain lanes, and the hosted review workflow in `governance-seatbelt`.

## Overview

Seatbelt simulates a governance proposal on the source chain, extracts bridge-specific execution jobs, runs destination simulations, and produces one combined report.

Today the tool supports five bridge families:

- `ArbitrumL1L2`
- `OptimismL1L2`
- `PolygonFxL1L2`
- `WormholeL1L2`
- `LayerZeroL1L2`

Cross-chain proposal support is intentionally lane-based. Seatbelt only guarantees behavior for the lanes that are explicitly configured and validated in code.

## Bridge Adapter Architecture

Cross-chain extraction and execution now flow through a shared bridge-adapter seam in [adapter.ts](../utils/bridges/adapter.ts).

Each adapter is responsible for:

- extracting destination execution jobs from proposal targets and calldata
- preparing any bridge-specific execution state before the destination simulation runs
- keeping bridge-specific runtime behavior out of the main execution engine

The execution engine in [tenderly-execution-engine.ts](../utils/cross-chain/tenderly-execution-engine.ts) orchestrates adapters and bridge execution flow.

### Supported Bridge Types

```typescript
type BridgeType =
  | 'ArbitrumL1L2'
  | 'OptimismL1L2'
  | 'PolygonFxL1L2'
  | 'WormholeL1L2'
  | 'LayerZeroL1L2';
```

### ArbitrumL1L2

- Source bridge call: `DelayedInbox.createRetryableTicket(...)`
- Address model: L1 sender is alias-adjusted on L2
- Main job: extract retryable ticket payload and simulate the L2 call

### OptimismL1L2

- Source bridge call: `L1CrossDomainMessenger.sendMessage(address,bytes,uint32)`
- Address model: L1 sender is preserved on L2
- Main job: extract messenger payload and simulate the L2 call

### PolygonFxL1L2

- Source bridge call: `FxRoot.sendMessageToChild(address,bytes)`
- Address model: destination execution calls the Polygon receiver from canonical `FxChild`
- Main job: wrap the Fx message as `processMessageFromRoot(stateId, rootMessageSender, data)` and simulate the Polygon-side handoff

### WormholeL1L2

- Source bridge call: Uniswap Wormhole sender contract
- Address model: destination execution uses an explicit lane-specific `l2FromAddress`
- Main job: decode the Wormhole message, map it onto a supported lane, and prepare any receiver-mode runtime state required for simulation

Wormhole support is defined centrally by the support matrix in [wormhole-support.ts](../utils/bridges/wormhole-support.ts).

### LayerZeroL1L2

- Source bridge call: Uniswap `OmnichainProposalSender.execute(uint16,bytes,bytes)`
- Address model: destination execution uses the configured remote `OmnichainGovernanceExecutor`
- Main job: decode the LayerZero executor payload and simulate the destination calls directly

LayerZero support exists for migration proposals that still use the old LayerZero path to update remote governance configuration. Future proposals that call Wormhole directly should use `WormholeL1L2`.

The supplied Uniswap `OmnichainProposalSender` has a confirmed trusted remote for Avalanche LayerZero V1 endpoint id `106`. MegaETH uses LayerZero V1 endpoint id `398`, but that id is not configured on the supplied Ethereum sender until the migration proposal calls `setTrustedRemoteAddress(398, 0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c)`. Seatbelt only treats a MegaETH LayerZero `execute` call as supported when that trusted-remote setup call appears earlier in the same proposal.

## Wormhole Support Model

Each supported Wormhole lane defines:

- a stable lane key
- destination chain id
- Wormhole chain id
- execution mode: `direct` or `receiver`
- expected L2 executor address
- recognized sender target set
- optional receiver-core address for receiver-mode chains
- validation targets used by live support checks

Current supported lanes:

- `bnb`
- `polygon`
- `avalanche`
- `celo`
- `monad`
- `tempo`

Unknown lanes, unknown sender targets, or partially configured lanes are treated as unsupported. Seatbelt should not silently guess.

### Source of Truth

These files should stay aligned:

- support matrix: [wormhole-support.ts](../utils/bridges/wormhole-support.ts)
- parser / extraction: [wormhole.ts](../utils/bridges/wormhole.ts)
- execution prep: [wormhole-execution.ts](../utils/bridges/wormhole-execution.ts)
- live validation: [wormhole-lane-validation.test.ts](../checks/tests/wormhole-lane-validation.test.ts)
- support-matrix drift checks: [wormhole-support-matrix.test.ts](../checks/tests/wormhole-support-matrix.test.ts)

If a lane is declared supported, it should also have parser coverage, execution coverage, and validation coverage.

## Message Flow

1. Simulate the proposal on the source chain.
2. Ask each bridge adapter to extract execution jobs.
3. For each extracted job, prepare bridge-specific runtime state if needed.
4. Simulate each destination job on its destination chain.
5. Combine source and destination results into one report.

For Wormhole receiver-mode lanes, runtime prep may include:

- reading live receiver configuration
- computing synthetic receiver calls
- injecting simulation-only state needed to mimic the bridge handoff
- cleaning up simulation-only state after the destination step commits

## Hosted Report Trust And Provenance

The hosted report remains proposal-data driven. It does not create proposal contents. It exists to review, share, and act on a simulation result.

Structured reports may include:

- trust metadata: `ready`, `warning`, or `blocked`
- publish metadata: `publishId`, `artifactHash`, `artifactUrl`, `metadataUrl`, `publishedAt`
- authenticity metadata for published artifacts, verified from an `ed25519`-signed publish envelope

These values are defined in [types.d.ts](../types.d.ts) and surfaced in the hosted UI through:

- [DecisionHeader.tsx](../frontend/src/components/DecisionHeader.tsx)
- [action/page.tsx](../frontend/src/app/action/page.tsx)
- [simulation-results/route.ts](../frontend/src/app/api/simulation-results/route.ts)

### What Is Guaranteed

- The viewer can expose the raw published artifact and publish metadata.
- Trust and authenticity state are displayed alongside the report.
- Published authenticity verification uses the relay's `ed25519` public key when configured.
- The existing review and submit flow remains intact.

### What Is Informational

- A `warning` trust state is advisory, not a workflow gate.
- Provenance improves operator visibility, but it is not a substitute for understanding the underlying proposal.
- Only configured authenticity verification is enforced. Unsigned artifacts are reported as such.

## Troubleshooting

### Tenderly Encode `413`

Problem:

- very large Bravo proposals can exceed Tenderly's encode payload ceiling during governor/timelock state override setup
- this usually shows up before destination simulation starts

Why it happens:

- Seatbelt encodes the full proposal action arrays into governor storage overrides for simulation
- more actions or larger calldatas increase the encode request size

What to do:

- split oversized representative rollouts into smaller bundles
- keep historical or special-case migrations out of "upcoming rollout" fixtures
- treat the issue as proposal-size related, not automatically as a bridge correctness failure

### Function Signature Mismatches

Problem:

```typescript
// Wrong for Optimism
signature: 'sendMessage(address,bytes,uint256)'

// Correct for Optimism
signature: 'sendMessage(address,bytes,uint32)'
```

Solution:

- verify the real bridge ABI before assuming a signature

### ETH Balance Requirements

Problem:

- proposals that transfer ETH can fail if the simulated executor lacks balance

Solution:

- seed the required balance in `stateObjectsByChain` or the source-chain simulation payload

### Unsupported Wormhole Lane

Problem:

- the proposal references a Wormhole message that does not match a configured lane

Solution:

- add the lane to the support matrix only after the parser, execution prep, and validation coverage are ready
- do not treat partial lane definitions as supported

## Adding A New Wormhole Lane

1. Add the lane to [wormhole-support.ts](../utils/bridges/wormhole-support.ts).
2. Add or update parser coverage in [wormhole.ts](../utils/bridges/wormhole.ts) and [wormhole-parser.test.ts](../tests/wormhole-parser.test.ts).
3. Add execution coverage in [wormhole-execution.ts](../utils/bridges/wormhole-execution.ts) and [cross-chain-execution-engine.test.ts](../checks/tests/cross-chain-execution-engine.test.ts).
4. Add live validation coverage in [wormhole-lane-validation.test.ts](../checks/tests/wormhole-lane-validation.test.ts).
5. Update representative rollout fixtures only if the lane belongs in the forward-looking rollout bundle.

Do not claim support for a new lane until all of those steps are done.

## Adding A New OP Stack Chain

1. Add the chain to [client.ts](../utils/clients/client.ts).
2. Add the correct `L1CrossDomainMessenger` mapping in [optimism.ts](../utils/bridges/optimism.ts).
3. Verify the messenger implements `sendMessage(address,bytes,uint32)`.
4. Add extraction or execution coverage if the chain behaves differently from the existing OP-stack set.
5. Validate the lane with a representative simulation before claiming support.
