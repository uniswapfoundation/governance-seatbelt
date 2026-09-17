import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import type { SimulationConfigNew } from '../../types';
import {
  WORMHOLE_LANE_SUPPORT_MATRIX,
  type WormholeLaneKey,
  type WormholeLaneValidationTargets,
} from '../../utils/bridges/wormhole-support';
import {
  TEST_ONLY_WORMHOLE_LANES,
  TEST_ONLY_WORMHOLE_LANE_ARTIFACTS,
  type TestOnlyLaneArtifacts,
  type TestOnlyWormholeLaneKey,
  buildTestOnlyWormholeLaneState,
} from './test-only-wormhole-lane-state';

const WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');
const WORMHOLE_BRIDGE = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');

const WORMHOLE_SENDER_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);
const FORWARD_ABI = parseAbi(['function forward(address target, bytes data)']);
const SET_OWNER_ABI = parseAbi(['function setOwner(address _owner)']);
const V2_FACTORY_ABI = parseAbi(['function setFeeTo(address)', 'function setFeeToSetter(address)']);
const OWNED_ABI = parseAbi(['function transferOwnership(address newOwner)']);

export const REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS = [
  'bnb',
  'polygon',
  'avalanche',
  'monad',
  'tempo',
] as const satisfies ReadonlyArray<
  Extract<TestOnlyWormholeLaneKey, 'bnb' | 'polygon' | 'avalanche' | 'monad' | 'tempo'>
>;

export const LIVE_WORMHOLE_LANE_VALIDATION_TARGETS = {
  bnb: WORMHOLE_LANE_SUPPORT_MATRIX.bnb.validationTargets,
  polygon: WORMHOLE_LANE_SUPPORT_MATRIX.polygon.validationTargets,
  avalanche: WORMHOLE_LANE_SUPPORT_MATRIX.avalanche.validationTargets,
  celo: WORMHOLE_LANE_SUPPORT_MATRIX.celo.validationTargets,
  monad: WORMHOLE_LANE_SUPPORT_MATRIX.monad.validationTargets,
  tempo: WORMHOLE_LANE_SUPPORT_MATRIX.tempo.validationTargets,
  arc: WORMHOLE_LANE_SUPPORT_MATRIX.arc.validationTargets,
} satisfies Record<WormholeLaneKey, WormholeLaneValidationTargets>;

function buildWormholeProposalCall(
  laneKey: TestOnlyWormholeLaneKey,
  targets: readonly `0x${string}`[],
  calldatas: readonly `0x${string}`[],
) {
  const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
  return {
    target: WORMHOLE_SENDER,
    calldata: encodeFunctionData({
      abi: WORMHOLE_SENDER_ABI,
      functionName: 'sendMessage',
      args: [
        [...targets],
        new Array(targets.length).fill(0n),
        [...calldatas],
        WORMHOLE_BRIDGE,
        lane.wormholeChainId,
      ],
    }),
    value: 0n,
    signature: '',
  };
}

function buildRepresentativeWormholeSetupAction(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
) {
  return buildWormholeProposalCall(
    laneKey,
    [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
    [
      encodeFunctionData({
        abi: SET_OWNER_ABI,
        functionName: 'setOwner',
        args: [artifacts.crossChainAccount],
      }),
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeToSetter',
        args: [artifacts.crossChainAccount],
      }),
      encodeFunctionData({
        abi: OWNED_ABI,
        functionName: 'transferOwnership',
        args: [artifacts.crossChainAccount],
      }),
    ],
  );
}

function buildRepresentativeWormholeFollowupAction(
  laneKey: TestOnlyWormholeLaneKey,
  artifacts: TestOnlyLaneArtifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey],
) {
  const v2Forward = encodeFunctionData({
    abi: FORWARD_ABI,
    functionName: 'forward',
    args: [
      artifacts.v2Factory,
      encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'setFeeTo',
        args: [artifacts.tokenJar],
      }),
    ],
  });

  return buildWormholeProposalCall(laneKey, [artifacts.crossChainAccount], [v2Forward]);
}

function buildRepresentativeWormholeRolloutState(): NonNullable<
  SimulationConfigNew['stateObjectsByChain']
> {
  const stateObjectsByChain: NonNullable<SimulationConfigNew['stateObjectsByChain']> = {};

  for (const laneKey of REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS) {
    const lane = TEST_ONLY_WORMHOLE_LANES[laneKey];
    const artifacts = TEST_ONLY_WORMHOLE_LANE_ARTIFACTS[laneKey];
    stateObjectsByChain[lane.chainId] = buildTestOnlyWormholeLaneState(
      lane.chainId,
      lane.l2FromAddress,
      [artifacts.v3Factory, artifacts.v2Factory, artifacts.v4PoolManager],
      artifacts.crossChainAccount,
    )[lane.chainId]!;
  }

  return stateObjectsByChain;
}

function buildRepresentativeLaneSummary(): string {
  return REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS.map(
    (laneKey) => TEST_ONLY_WORMHOLE_LANES[laneKey].name,
  ).join(', ');
}

function buildRepresentativeWormholeRolloutActions(kind: 'setup' | 'followup') {
  return REPRESENTATIVE_WORMHOLE_ROLLOUT_LANE_KEYS.map((laneKey) =>
    kind === 'setup'
      ? buildRepresentativeWormholeSetupAction(laneKey)
      : buildRepresentativeWormholeFollowupAction(laneKey),
  );
}

function buildRepresentativeWormholeRolloutConfig(kind: 'setup' | 'followup'): SimulationConfigNew {
  const actions = buildRepresentativeWormholeRolloutActions(kind);
  const description =
    kind === 'setup'
      ? `# Representative Wormhole rollout setup (test only)\n\nThis representative multi-lane setup proposal uses the live Wormhole authorities for ${buildRepresentativeLaneSummary()} as the destination senders and hands ownership of fresh fake V2/V3/V4 targets to fresh fake CrossChainAccounts. It exists to model the kind of consolidated rollout proposal governance would likely use across upcoming lanes without bundling historical Celo-only migration steps.`
      : `# Representative Wormhole rollout follow-up (test only)\n\nThis representative multi-lane follow-up proposal mirrors the fee-setting step in the historical Celo 94 -> 95 story without including Celo itself. A plain run should fail because the fresh fake V2 factories are still controlled by the live Wormhole authorities, while the fake CrossChainAccounts are not yet the fee setters. Running this proposal derived from the matching setup proposal should pass after the setup ownership handoff for ${buildRepresentativeLaneSummary()}.`;

  return {
    type: 'new',
    daoName: 'Uniswap',
    governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
    governorType: 'bravo',
    targets: actions.map((action) => action.target),
    values: actions.map((action) => action.value),
    signatures: actions.map((action) => action.signature),
    calldatas: actions.map((action) => action.calldata),
    stateObjectsByChain: buildRepresentativeWormholeRolloutState(),
    description,
  };
}

export function buildTestOnlyWormholeRolloutSetupConfig(): SimulationConfigNew {
  return buildRepresentativeWormholeRolloutConfig('setup');
}

export function buildTestOnlyWormholeRolloutFollowupConfig(): SimulationConfigNew {
  return buildRepresentativeWormholeRolloutConfig('followup');
}
