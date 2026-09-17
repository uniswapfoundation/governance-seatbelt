import { decodeFunctionData, getAddress, isHex, parseAbi, slice, toFunctionSelector } from 'viem';
import type { CrossChainExecutionCall, CrossChainExecutionJob } from '../../types.d';
import type {
  LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
  LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
} from './wormhole-runtime-state';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  WORMHOLE_LANE_SUPPORT_MATRIX,
  getAllSupportedWormholeSenderTargets,
  getWormholeLaneByChainId,
} from './wormhole-support';

export const WORMHOLE_SEND_MESSAGE_ABI = parseAbi([
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
]);

const WORMHOLE_SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessage(address[] targets, uint256[] values, bytes[] datas, address wormhole, uint16 chainId)',
);

export type WormholeLaneCapabilities =
  | {
      kind: 'direct';
      receiverCoreAddress: null;
    }
  | {
      kind: 'modern';
      receiverCoreAddress: `0x${string}`;
    }
  | {
      kind: 'legacy';
      receiverCoreAddress: `0x${string}`;
      payloadVersion: typeof LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION;
      nextSequenceStorageSlot: typeof LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT;
    };

export const SUPPORTED_WORMHOLE_CHAIN_IDS = Object.freeze(
  SUPPORTED_WORMHOLE_LANE_KEYS.map(
    (laneKey) => WORMHOLE_LANE_SUPPORT_MATRIX[laneKey].wormholeChainId,
  ),
);

const KNOWN_WORMHOLE_SENDER_TARGETS = new Set(
  getAllSupportedWormholeSenderTargets().map((target) => target.toLowerCase()),
);

function hasMatchingLengths(
  targets: readonly unknown[],
  values: readonly unknown[],
  datas: readonly unknown[],
): boolean {
  return targets.length === values.length && values.length === datas.length;
}

type WormholeDestinationContext = {
  destinationChainId: number;
  l2FromAddress: `0x${string}`;
  wormholeChainId: number;
};

type WormholeBatch = WormholeDestinationContext & {
  calls: CrossChainExecutionCall[];
};

type WormholeBatchDecodeResult =
  | { kind: 'supported'; batch: WormholeBatch }
  | { kind: 'unsupported'; wormholeChainId: number };

function normalizeWormholeProposalTarget(target: string): string | null {
  try {
    return getAddress(target).toLowerCase();
  } catch {
    return null;
  }
}

function isKnownWormholeProposalCall(target: string, data: string): boolean {
  if (!isHex(data) || data === '0x' || data.length < 10) {
    return false;
  }

  const normalizedTarget = normalizeWormholeProposalTarget(target);
  if (!normalizedTarget || !KNOWN_WORMHOLE_SENDER_TARGETS.has(normalizedTarget)) {
    return false;
  }

  return slice(data, 0, 4) === WORMHOLE_SEND_MESSAGE_SELECTOR;
}

function resolveWormholeDestinationContext(
  wormholeChainId: number,
): WormholeDestinationContext | null {
  const lane = getWormholeLaneByChainId(wormholeChainId);
  if (!lane) return null;

  return {
    destinationChainId: lane.destinationChainId,
    l2FromAddress: lane.l2FromAddress,
    wormholeChainId,
  };
}

function toWormholeBatchCalls(
  wormholeTargets: readonly unknown[],
  wormholeValues: readonly unknown[],
  wormholeDatas: readonly unknown[],
): CrossChainExecutionCall[] {
  const calls: CrossChainExecutionCall[] = [];

  for (let index = 0; index < wormholeTargets.length; index += 1) {
    const target = wormholeTargets[index];
    const value = wormholeValues[index];
    const calldata = wormholeDatas[index];

    if (typeof target !== 'string' || typeof value !== 'bigint' || !isHex(calldata)) {
      continue;
    }

    calls.push({
      l2TargetAddress: getAddress(target),
      l2InputData: calldata,
      l2Value: value.toString(),
    });
  }

  return calls;
}

function tryDecodeWormholeBatch(data: string): WormholeBatchDecodeResult | null {
  try {
    if (!isHex(data)) return null;

    const decoded = decodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      data,
    });

    if (decoded.functionName !== 'sendMessage') return null;

    const [wormholeTargets, wormholeValues, wormholeDatas, , wormholeChainId] = decoded.args;

    if (!hasMatchingLengths(wormholeTargets, wormholeValues, wormholeDatas)) {
      return null;
    }

    const resolvedChainId = Number(wormholeChainId);
    const context = resolveWormholeDestinationContext(resolvedChainId);
    if (!context) {
      return { kind: 'unsupported', wormholeChainId: resolvedChainId };
    }

    return {
      kind: 'supported',
      batch: {
        ...context,
        calls: toWormholeBatchCalls(wormholeTargets, wormholeValues, wormholeDatas),
      },
    };
  } catch {
    // Best-effort decode only; ignore malformed calldata and keep scanning.
    return null;
  }
}

/**
 * Extract wormhole destination calls from proposal calldata.
 *
 * Current coverage: BNB (4), Polygon (5), Avalanche (6), Celo (14), Monad (48), Tempo (68), and Arc (71).
 * Receiver-mode is enabled where the destination authority is a Wormhole receiver; other lanes
 * continue to use direct-mode simulation until their live destination contracts match that path.
 */
export function extractWormholeExecutionJobsFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
): CrossChainExecutionJob[] {
  const jobs: CrossChainExecutionJob[] = [];

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !isKnownWormholeProposalCall(target, data)) continue;

    const decodedBatch = tryDecodeWormholeBatch(data);
    if (!decodedBatch) continue;
    if (decodedBatch.kind === 'unsupported') {
      throw new Error(
        `Unsupported Wormhole chain id ${decodedBatch.wormholeChainId} in proposal calldata index ${i}`,
      );
    }

    jobs.push({
      bridgeType: 'WormholeL1L2',
      destinationChainId: decodedBatch.batch.destinationChainId,
      l2FromAddress: decodedBatch.batch.l2FromAddress,
      wormholeChainId: decodedBatch.batch.wormholeChainId,
      sourceOrder: i,
      calls: decodedBatch.batch.calls,
    });
  }

  if (jobs.length > 0) {
    console.log(
      `[Wormhole Parser] Extracted ${jobs.length} L1->L2 execution job(s) from proposal targets/calldatas.`,
    );
  }

  return jobs;
}

export function getWormholeLaneCapabilities(
  wormholeChainId: number | undefined,
): WormholeLaneCapabilities {
  if (wormholeChainId === undefined) {
    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'direct',
      receiverCoreAddress: null,
    });
  }

  const lane = getWormholeLaneByChainId(wormholeChainId);
  if (!lane) {
    throw new Error(`Unsupported Wormhole chain id ${wormholeChainId}`);
  }

  if (lane.executionMode === 'direct') {
    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'direct',
      receiverCoreAddress: null,
    });
  }

  if (!lane.wormholeReceiverCoreAddress) {
    throw new Error(`Wormhole lane ${wormholeChainId} missing wormholeReceiverCoreAddress`);
  }

  if (lane.executionMode === 'receiver-legacy') {
    if (!lane.legacyPayloadVersion || !lane.legacyNextSequenceStorageSlot) {
      throw new Error(`Wormhole lane ${wormholeChainId} missing legacy receiver metadata`);
    }

    return assertValidWormholeLaneCapabilities(wormholeChainId, {
      kind: 'legacy',
      receiverCoreAddress: lane.wormholeReceiverCoreAddress,
      payloadVersion: lane.legacyPayloadVersion,
      nextSequenceStorageSlot: lane.legacyNextSequenceStorageSlot,
    });
  }

  return assertValidWormholeLaneCapabilities(wormholeChainId, {
    kind: 'modern',
    receiverCoreAddress: lane.wormholeReceiverCoreAddress,
  });
}

export function assertValidWormholeLaneCapabilities(
  wormholeChainId: number | undefined,
  capabilities: WormholeLaneCapabilities,
): WormholeLaneCapabilities {
  if (capabilities.kind === 'direct') {
    if (capabilities.receiverCoreAddress !== null) {
      throw new Error(
        `Direct Wormhole lane ${String(wormholeChainId)} has inconsistent receiver config`,
      );
    }
    return capabilities;
  }

  if (capabilities.kind === 'modern') {
    if (
      typeof capabilities.receiverCoreAddress !== 'string' ||
      !isHex(capabilities.receiverCoreAddress) ||
      capabilities.receiverCoreAddress.length !== 42
    ) {
      throw new Error(
        `Modern Wormhole lane ${String(wormholeChainId)} has invalid receiverCoreAddress`,
      );
    }
    return capabilities;
  }

  if (
    typeof capabilities.receiverCoreAddress !== 'string' ||
    capabilities.receiverCoreAddress.length === 0 ||
    !isHex(capabilities.receiverCoreAddress) ||
    capabilities.receiverCoreAddress.length !== 42
  ) {
    throw new Error(
      `Legacy Wormhole lane ${String(wormholeChainId)} has invalid receiverCoreAddress`,
    );
  }
  if (!isHex(capabilities.payloadVersion) || capabilities.payloadVersion.length !== 66) {
    throw new Error(`Legacy Wormhole lane ${String(wormholeChainId)} has invalid payloadVersion`);
  }
  if (
    !isHex(capabilities.nextSequenceStorageSlot) ||
    capabilities.nextSequenceStorageSlot.length !== 66
  ) {
    throw new Error(
      `Legacy Wormhole lane ${String(wormholeChainId)} has invalid nextSequenceStorageSlot`,
    );
  }

  return capabilities;
}

export function getWormholeReceiverCoreAddressForChain(
  wormholeChainId: number | undefined,
): `0x${string}` | null {
  return getWormholeLaneCapabilities(wormholeChainId).receiverCoreAddress;
}
