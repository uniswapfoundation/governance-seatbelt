import {
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  isHex,
  parseAbi,
  slice,
  toFunctionSelector,
} from 'viem';
import { avalanche } from 'viem/chains';
import type { CrossChainExecutionCall, CrossChainExecutionJob } from '../../types.d';
import { MEGAETH_CHAIN_ID, MEGAETH_CHAIN_NAME } from '../chains/megaeth';

export const LAYER_ZERO_EXECUTE_ABI = parseAbi([
  'function execute(uint16 remoteChainId, bytes payload, bytes adapterParams)',
]);

export const LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI = parseAbi([
  'function setTrustedRemoteAddress(uint16 remoteChainId, bytes remoteAddress)',
]);

const LAYER_ZERO_EXECUTE_SELECTOR = toFunctionSelector(
  'function execute(uint16 remoteChainId, bytes payload, bytes adapterParams)',
);
const LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_SELECTOR = toFunctionSelector(
  'function setTrustedRemoteAddress(uint16 remoteChainId, bytes remoteAddress)',
);

export const UNISWAP_OMNICHAIN_PROPOSAL_SENDER = getAddress(
  '0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc',
);
export const UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR = getAddress(
  '0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc',
);
export const UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR = getAddress(
  '0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c',
);

export type LayerZeroLaneKey = 'avalanche' | 'megaeth';

export type LayerZeroLaneSupport = {
  key: LayerZeroLaneKey;
  chainName: string;
  destinationChainId: number;
  layerZeroRemoteChainId: number;
  l2FromAddress: `0x${string}`;
  senderTargets: readonly `0x${string}`[];
  requiredTrustedRemoteAddress?: `0x${string}`;
};

export const LAYER_ZERO_LANE_SUPPORT_MATRIX: Record<LayerZeroLaneKey, LayerZeroLaneSupport> = {
  avalanche: {
    key: 'avalanche',
    chainName: 'Avalanche',
    destinationChainId: avalanche.id,
    layerZeroRemoteChainId: 106,
    l2FromAddress: UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR,
    senderTargets: [UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
  },
  megaeth: {
    key: 'megaeth',
    chainName: MEGAETH_CHAIN_NAME,
    destinationChainId: MEGAETH_CHAIN_ID,
    layerZeroRemoteChainId: 398,
    l2FromAddress: UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
    senderTargets: [UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
    requiredTrustedRemoteAddress: UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
  },
};

export const SUPPORTED_LAYER_ZERO_LANE_KEYS = [
  'avalanche',
  'megaeth',
] as const satisfies readonly LayerZeroLaneKey[];

const KNOWN_LAYER_ZERO_SENDER_TARGETS = new Set(
  SUPPORTED_LAYER_ZERO_LANE_KEYS.flatMap(
    (laneKey) => LAYER_ZERO_LANE_SUPPORT_MATRIX[laneKey].senderTargets,
  ).map((target) => target.toLowerCase()),
);

type DecodedLayerZeroPayload = {
  targets: readonly `0x${string}`[];
  values: readonly bigint[];
  calldatas: readonly Hex[];
  signatures?: readonly string[];
};

type LayerZeroPayloadDecodeResult =
  | { kind: 'supported'; payload: DecodedLayerZeroPayload }
  | { kind: 'malformed' };

function getLayerZeroLaneByRemoteChainId(remoteChainId: number): LayerZeroLaneSupport | undefined {
  return SUPPORTED_LAYER_ZERO_LANE_KEYS.map(
    (laneKey) => LAYER_ZERO_LANE_SUPPORT_MATRIX[laneKey],
  ).find((lane) => lane.layerZeroRemoteChainId === remoteChainId);
}

function normalizeProposalTarget(target: string): string | null {
  try {
    return getAddress(target).toLowerCase();
  } catch {
    return null;
  }
}

function isKnownLayerZeroProposalCall(target: string, data: string): boolean {
  if (!isHex(data) || data === '0x' || data.length < 10) {
    return false;
  }

  const normalizedTarget = normalizeProposalTarget(target);
  if (!normalizedTarget || !KNOWN_LAYER_ZERO_SENDER_TARGETS.has(normalizedTarget)) {
    return false;
  }

  return slice(data, 0, 4) === LAYER_ZERO_EXECUTE_SELECTOR;
}

function decodePackedAddress(value: Hex): `0x${string}` | null {
  if (value.length !== 42) return null;

  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function isTrustedRemoteSetupCall(
  target: string,
  data: string,
  lane: LayerZeroLaneSupport,
): boolean {
  if (!lane.requiredTrustedRemoteAddress || !isHex(data) || data.length < 10) {
    return false;
  }

  const normalizedTarget = normalizeProposalTarget(target);
  if (
    !normalizedTarget ||
    !lane.senderTargets.some((senderTarget) => senderTarget.toLowerCase() === normalizedTarget)
  ) {
    return false;
  }

  if (slice(data, 0, 4) !== LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_SELECTOR) {
    return false;
  }

  try {
    const decoded = decodeFunctionData({
      abi: LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
      data,
    });
    if (decoded.functionName !== 'setTrustedRemoteAddress') return false;

    const [remoteChainId, remoteAddress] = decoded.args;
    const decodedRemoteAddress = decodePackedAddress(remoteAddress);

    return (
      lane.layerZeroRemoteChainId === Number(remoteChainId) &&
      decodedRemoteAddress?.toLowerCase() === lane.requiredTrustedRemoteAddress.toLowerCase()
    );
  } catch {
    return false;
  }
}

function proposalConfiguresTrustedRemoteBeforeIndex(
  targets: readonly string[],
  calldatas: readonly string[],
  index: number,
  lane: LayerZeroLaneSupport,
): boolean {
  for (let i = 0; i < index; i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (target && data && isTrustedRemoteSetupCall(target, data, lane)) return true;
  }

  return false;
}

function decodeLayerZeroExecutorPayload(payload: Hex): LayerZeroPayloadDecodeResult {
  try {
    const [targets, values, signatures, calldatas] = decodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'string[]' }, { type: 'bytes[]' }],
      payload,
    );

    if (
      targets.length !== values.length ||
      values.length !== signatures.length ||
      signatures.length !== calldatas.length
    ) {
      return { kind: 'malformed' };
    }

    return { kind: 'supported', payload: { targets, values, signatures, calldatas } };
  } catch {
    // Fall through to the direct executor payload below.
  }

  try {
    const [targets, values, calldatas] = decodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }],
      payload,
    );

    if (targets.length !== values.length || values.length !== calldatas.length) {
      return { kind: 'malformed' };
    }

    return { kind: 'supported', payload: { targets, values, calldatas } };
  } catch {
    return { kind: 'malformed' };
  }
}

function calldataWithSignature(signature: string | undefined, calldata: Hex): Hex {
  const trimmed = signature?.trim();
  if (!trimmed) return calldata;

  const functionSignature = trimmed.startsWith('function ') ? trimmed : `function ${trimmed}`;
  const selector = toFunctionSelector(functionSignature);
  return `${selector}${calldata.slice(2)}` as Hex;
}

function toLayerZeroExecutionCalls(payload: DecodedLayerZeroPayload): CrossChainExecutionCall[] {
  const calls: CrossChainExecutionCall[] = [];

  for (let index = 0; index < payload.targets.length; index += 1) {
    const target = payload.targets[index];
    const value = payload.values[index];
    const calldata = payload.calldatas[index];
    const signature = payload.signatures?.[index];

    if (target === undefined || value === undefined || calldata === undefined) {
      throw new Error(`Malformed LayerZero executor payload call at index ${index}`);
    }

    calls.push({
      l2TargetAddress: getAddress(target),
      l2InputData: calldataWithSignature(signature, calldata),
      l2Value: value.toString(),
    });
  }

  return calls;
}

export function extractLayerZeroL1L2JobsFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
): CrossChainExecutionJob[] {
  const jobs: CrossChainExecutionJob[] = [];

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !isKnownLayerZeroProposalCall(target, data)) continue;

    const decoded = (() => {
      try {
        return decodeFunctionData({
          abi: LAYER_ZERO_EXECUTE_ABI,
          data: data as Hex,
        });
      } catch {
        throw new Error(`Malformed LayerZero execute calldata in proposal calldata index ${i}`);
      }
    })();

    if (decoded.functionName !== 'execute') continue;

    const [remoteChainId, payload] = decoded.args;
    const resolvedRemoteChainId = Number(remoteChainId);
    const lane = getLayerZeroLaneByRemoteChainId(resolvedRemoteChainId);
    if (!lane) {
      throw new Error(
        `Unsupported LayerZero remote chain id ${resolvedRemoteChainId} in proposal calldata index ${i}`,
      );
    }
    if (
      lane.requiredTrustedRemoteAddress &&
      !proposalConfiguresTrustedRemoteBeforeIndex(targets, calldatas, i, lane)
    ) {
      throw new Error(
        `LayerZero remote chain id ${resolvedRemoteChainId} requires setTrustedRemoteAddress before execute in proposal calldata index ${i}`,
      );
    }

    const decodedPayload = decodeLayerZeroExecutorPayload(payload);
    if (decodedPayload.kind !== 'supported') {
      throw new Error(
        `Could not decode LayerZero executor payload for remote chain id ${resolvedRemoteChainId} in proposal calldata index ${i}`,
      );
    }
    const calls = toLayerZeroExecutionCalls(decodedPayload.payload);
    if (calls.length === 0) {
      throw new Error(
        `LayerZero executor payload has no destination calls for remote chain id ${resolvedRemoteChainId} in proposal calldata index ${i}`,
      );
    }

    jobs.push({
      bridgeType: 'LayerZeroL1L2',
      destinationChainId: lane.destinationChainId,
      l2FromAddress: lane.l2FromAddress,
      sourceOrder: i,
      calls,
    });
  }

  if (jobs.length > 0) {
    console.log(
      `[LayerZero Parser] Extracted ${jobs.length} L1->L2 execution job(s) from proposal targets/calldatas.`,
    );
  }

  return jobs;
}
