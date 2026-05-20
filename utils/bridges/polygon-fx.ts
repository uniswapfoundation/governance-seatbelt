import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isHex,
  parseAbi,
  slice,
  toFunctionSelector,
} from 'viem';
import { polygon } from 'viem/chains';
import type { CrossChainExecutionJob } from '../../types.d';

export const POLYGON_FX_ROOT: Address = getAddress('0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2');
export const POLYGON_FX_CHILD: Address = getAddress('0x8397259c983751DAf40400790063935a11afa28a');

export const POLYGON_FX_SEND_MESSAGE_ABI = parseAbi([
  'function sendMessageToChild(address receiver, bytes data)',
]);

export const POLYGON_FX_PROCESS_MESSAGE_ABI = parseAbi([
  'function processMessageFromRoot(uint256 stateId, address rootMessageSender, bytes data)',
]);

const POLYGON_FX_SEND_MESSAGE_SELECTOR = toFunctionSelector(
  'function sendMessageToChild(address receiver, bytes data)',
);

const ZERO_ADDRESS = getAddress('0x0000000000000000000000000000000000000000');

function normalizeAddress(value: string): Address | null {
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function isPolygonFxRootCall(target: string, data: string): boolean {
  if (!isHex(data) || data === '0x' || data.length < 10) {
    return false;
  }

  const normalizedTarget = normalizeAddress(target);
  if (!normalizedTarget || normalizedTarget.toLowerCase() !== POLYGON_FX_ROOT.toLowerCase()) {
    return false;
  }

  return slice(data, 0, 4) === POLYGON_FX_SEND_MESSAGE_SELECTOR;
}

/**
 * Extract Polygon FxPortal L1 -> L2 messages from proposal calldata.
 *
 * FxRoot forwards a root message to Polygon's FxChild, which then calls
 * processMessageFromRoot(stateId, rootMessageSender, data) on the receiver.
 * The destination simulation mirrors that Polygon-side handoff directly.
 */
export function extractPolygonFxL1L2JobsFromProposal(
  targets: readonly string[],
  calldatas: readonly string[],
  l1Sender?: Address,
): CrossChainExecutionJob[] {
  const jobs: CrossChainExecutionJob[] = [];
  const rootMessageSender = l1Sender ? getAddress(l1Sender) : ZERO_ADDRESS;

  for (let i = 0; i < Math.min(targets.length, calldatas.length); i += 1) {
    const target = targets[i];
    const data = calldatas[i];
    if (!target || !isPolygonFxRootCall(target, data)) continue;

    try {
      const decoded = decodeFunctionData({
        abi: POLYGON_FX_SEND_MESSAGE_ABI,
        data: data as Hex,
      });

      if (decoded.functionName !== 'sendMessageToChild') continue;

      const [receiver, messageData] = decoded.args;
      const l2InputData = encodeFunctionData({
        abi: POLYGON_FX_PROCESS_MESSAGE_ABI,
        functionName: 'processMessageFromRoot',
        args: [BigInt(i + 1), rootMessageSender, messageData as Hex],
      });

      jobs.push({
        bridgeType: 'PolygonFxL1L2',
        destinationChainId: polygon.id,
        l2FromAddress: POLYGON_FX_CHILD,
        sourceOrder: i,
        calls: [
          {
            l2TargetAddress: getAddress(receiver),
            l2InputData,
            l2Value: '0',
          },
        ],
      });
    } catch {
      // Best-effort decode only; ignore malformed calldata and keep scanning.
    }
  }

  if (jobs.length > 0) {
    console.log(
      `[Polygon Fx Parser] Extracted ${jobs.length} L1->L2 job(s) from proposal targets/calldatas.`,
    );
  }

  return jobs;
}
