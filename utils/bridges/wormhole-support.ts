import { getAddress } from 'viem';
import { arc, avalanche, bsc, celo, monad, polygon, tempo } from 'viem/chains';
import {
  LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
  LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
} from './wormhole-runtime-state';

export type WormholeLaneKey = 'bnb' | 'polygon' | 'avalanche' | 'celo' | 'monad' | 'tempo' | 'arc';

export type WormholeLaneValidationTargets = {
  v2Factory: `0x${string}`;
  v3Factory?: `0x${string}`;
  v4PoolManager?: `0x${string}`;
};

export type WormholeLaneExecutionMode = 'direct' | 'receiver-modern' | 'receiver-legacy';

export type WormholeLaneSupport = {
  key: WormholeLaneKey;
  chainName: string;
  destinationChainId: number;
  wormholeChainId: number;
  executionMode: WormholeLaneExecutionMode;
  l2FromAddress: `0x${string}`;
  senderTargets: readonly `0x${string}`[];
  wormholeReceiverCoreAddress?: `0x${string}`;
  legacyPayloadVersion?: typeof LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION;
  legacyNextSequenceStorageSlot?: typeof LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT;
  validationTargets: WormholeLaneValidationTargets;
};

// Mainnet sender reference:
// https://etherscan.io/address/0xf5F4496219F31CDCBa6130B5402873624585615a
const UNISWAP_WORMHOLE_SENDER = getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a');

export const WORMHOLE_LANE_SUPPORT_MATRIX: Record<WormholeLaneKey, WormholeLaneSupport> = {
  // Arc mainnet; receiver authority validated against all three targets.
  arc: {
    key: 'arc',
    chainName: arc.name,
    destinationChainId: arc.id,
    wormholeChainId: 71,
    executionMode: 'receiver-modern',
    l2FromAddress: getAddress('0xbCA30b5429935205037069cF5b8A165F55d05a75'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027'),
    validationTargets: {
      v2Factory: getAddress('0x89e5DB8B5aA49aA85AC63f691524311AEB649eba'),
      v3Factory: getAddress('0xf0db7b58379503491d857dB50AC9ece64c653918'),
      v4PoolManager: getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
    },
  },
  // BNB Smart Chain references:
  // - receiver: https://bscscan.com/address/0x341c1511141022cf8eE20824Ae0fFA3491F1302b
  // - wormhole core: https://bscscan.com/address/0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B
  // - validation target (v2): https://bscscan.com/address/0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6
  bnb: {
    key: 'bnb',
    chainName: 'BNB Smart Chain',
    destinationChainId: bsc.id,
    wormholeChainId: 4,
    executionMode: 'receiver-legacy',
    l2FromAddress: getAddress('0x341c1511141022cf8eE20824Ae0fFA3491F1302b'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
    legacyPayloadVersion: LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
    legacyNextSequenceStorageSlot: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
    validationTargets: {
      v2Factory: getAddress('0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6'),
    },
  },
  // Polygon references:
  // - executor: https://polygonscan.com/address/0x8a1B966aC46F42275860f905dbC75EfBfDC12374
  // - validation target (v2): https://polygonscan.com/address/0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C
  polygon: {
    key: 'polygon',
    chainName: 'Polygon',
    destinationChainId: polygon.id,
    wormholeChainId: 5,
    executionMode: 'direct',
    l2FromAddress: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
    },
  },
  // Avalanche references:
  // - executor: https://snowtrace.io/address/0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc
  // - validation target (v2): https://snowtrace.io/address/0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C
  avalanche: {
    key: 'avalanche',
    chainName: 'Avalanche',
    destinationChainId: avalanche.id,
    wormholeChainId: 6,
    executionMode: 'direct',
    l2FromAddress: getAddress('0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    validationTargets: {
      v2Factory: getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C'),
    },
  },
  // Celo references:
  // - receiver: https://celoscan.io/address/0x0Eb863541278308c3A64F8E908BC646e27BFD071
  // - wormhole core: https://celoscan.io/address/0xa321448d90d4e5b0A732867c18eA198e75CAC48E
  // - validation target (v2): https://celoscan.io/address/0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f
  // - validation target (v3): https://celoscan.io/address/0xAfE208a311B21f13EF87E33A90049fC17A7acDEc
  // - validation target (v4): https://celoscan.io/address/0x288dc841A52FCA2707c6947B3A777c5E56cd87BC
  celo: {
    key: 'celo',
    chainName: 'Celo',
    destinationChainId: celo.id,
    wormholeChainId: 14,
    executionMode: 'receiver-modern',
    l2FromAddress: getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0xa321448d90d4e5b0A732867c18eA198e75CAC48E'),
    validationTargets: {
      v2Factory: getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f'),
      v3Factory: getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
      v4PoolManager: getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC'),
    },
  },
  // Monad references:
  // - receiver: https://monadvision.com/address/0xe783de89a7f0408687f051e3e6d0beb62719ebad
  // - wormhole core: https://monadvision.com/address/0x194B123c5E96B9B2e49763619985790Dc241CAC0
  // - validation target (v2): https://monadvision.com/address/0x182a927119d56008d921126764bf884221b10f59
  // - validation target (v3): https://monadvision.com/address/0x204faca1764b154221e35c0d20abb3c525710498
  // - validation target (v4): https://monadvision.com/address/0x188d586ddcf52439676ca21a244753fa19f9ea8e
  monad: {
    key: 'monad',
    chainName: 'Monad',
    destinationChainId: monad.id,
    wormholeChainId: 48,
    executionMode: 'receiver-modern',
    l2FromAddress: getAddress('0xe783de89a7f0408687f051e3e6d0beb62719ebad'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0x194B123c5E96B9B2e49763619985790Dc241CAC0'),
    validationTargets: {
      v2Factory: getAddress('0x182a927119d56008d921126764bf884221b10f59'),
      v3Factory: getAddress('0x204faca1764b154221e35c0d20abb3c525710498'),
      v4PoolManager: getAddress('0x188d586ddcf52439676ca21a244753fa19f9ea8e'),
    },
  },
  // Tempo references:
  // - receiver: https://explore.tempo.xyz/address/0xCFB43dC56B55bE9611deD8384201cECf06A9811b
  // - wormhole core: https://explore.tempo.xyz/address/0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6
  // - validation target (v2): https://explore.tempo.xyz/address/0xf9EC577a4E45B5278BB7Cf60FCBc20c3acAef68f
  // - validation target (v3): https://explore.tempo.xyz/address/0x24a3d4757E330890A8b8978028c9e58E04611fd6
  // - validation target (v4): https://explore.tempo.xyz/address/0x33620f62C5b9B2086dD6b62F4A297A9f30347029
  tempo: {
    key: 'tempo',
    chainName: 'Tempo Mainnet',
    destinationChainId: tempo.id,
    wormholeChainId: 68,
    executionMode: 'receiver-modern',
    l2FromAddress: getAddress('0xCFB43dC56B55bE9611deD8384201cECf06A9811b'),
    senderTargets: [UNISWAP_WORMHOLE_SENDER],
    wormholeReceiverCoreAddress: getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6'),
    validationTargets: {
      v2Factory: getAddress('0xf9EC577a4E45B5278BB7Cf60FCBc20c3acAef68f'),
      v3Factory: getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6'),
      v4PoolManager: getAddress('0x33620f62C5b9B2086dD6b62F4A297A9f30347029'),
    },
  },
};

export const SUPPORTED_WORMHOLE_LANE_KEYS = [
  'bnb',
  'polygon',
  'avalanche',
  'celo',
  'monad',
  'tempo',
  'arc',
] as const satisfies readonly WormholeLaneKey[];

let wormholeSupportMatrixValidated = false;
function assertWormholeSupportMatrixValid(): void {
  if (wormholeSupportMatrixValidated) return;
  wormholeSupportMatrixValidated = true;

  const issues = getWormholeSupportMatrixIssues(WORMHOLE_LANE_SUPPORT_MATRIX);
  if (issues.length > 0) {
    throw new Error(`Invalid Wormhole support matrix:\n- ${issues.join('\n- ')}`);
  }
}

function getWormholeLaneKeys(
  supportMatrix: Record<WormholeLaneKey, WormholeLaneSupport>,
): WormholeLaneKey[] {
  return Object.keys(supportMatrix) as WormholeLaneKey[];
}

export function getWormholeLaneByChainId(wormholeChainId: number): WormholeLaneSupport | undefined {
  assertWormholeSupportMatrixValid();
  return SUPPORTED_WORMHOLE_LANE_KEYS.map((laneKey) => WORMHOLE_LANE_SUPPORT_MATRIX[laneKey]).find(
    (lane) => lane.wormholeChainId === wormholeChainId,
  );
}

export function getWormholeLaneByKey(laneKey: WormholeLaneKey): WormholeLaneSupport {
  assertWormholeSupportMatrixValid();
  return WORMHOLE_LANE_SUPPORT_MATRIX[laneKey];
}

export function getAllSupportedWormholeSenderTargets(): readonly `0x${string}`[] {
  assertWormholeSupportMatrixValid();
  return Array.from(
    new Set(
      SUPPORTED_WORMHOLE_LANE_KEYS.flatMap(
        (laneKey) => WORMHOLE_LANE_SUPPORT_MATRIX[laneKey].senderTargets,
      ),
    ),
  );
}

export function getWormholeSupportMatrixIssues(
  supportMatrix: Record<WormholeLaneKey, WormholeLaneSupport> = WORMHOLE_LANE_SUPPORT_MATRIX,
): string[] {
  const issues: string[] = [];
  const seenWormholeChainIds = new Set<number>();
  const seenDestinationChainIds = new Set<number>();

  function isValidAddress(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      getAddress(value);
      return true;
    } catch {
      return false;
    }
  }

  for (const laneKey of getWormholeLaneKeys(supportMatrix)) {
    const lane = supportMatrix[laneKey];
    if (seenWormholeChainIds.has(lane.wormholeChainId)) {
      issues.push(`Duplicate Wormhole chain id ${lane.wormholeChainId} for lane ${lane.key}`);
    }
    seenWormholeChainIds.add(lane.wormholeChainId);

    if (seenDestinationChainIds.has(lane.destinationChainId)) {
      issues.push(`Duplicate destination chain id ${lane.destinationChainId} for lane ${lane.key}`);
    }
    seenDestinationChainIds.add(lane.destinationChainId);

    if (lane.senderTargets.length === 0) {
      issues.push(`Lane ${lane.key} has no recognized Wormhole sender targets`);
    }

    if (!isValidAddress(lane.l2FromAddress)) {
      issues.push(`Lane ${lane.key} has invalid l2FromAddress`);
    }

    for (const target of lane.senderTargets) {
      if (!isValidAddress(target)) {
        issues.push(`Lane ${lane.key} has invalid sender target ${String(target)}`);
      }
    }

    if (!lane.validationTargets.v2Factory) {
      issues.push(`Lane ${lane.key} is missing required v2 validation target`);
    }
    if (!isValidAddress(lane.validationTargets.v2Factory)) {
      issues.push(`Lane ${lane.key} has invalid v2Factory validation target`);
    }
    if (
      lane.validationTargets.v3Factory !== undefined &&
      !isValidAddress(lane.validationTargets.v3Factory)
    ) {
      issues.push(`Lane ${lane.key} has invalid v3Factory validation target`);
    }
    if (
      lane.validationTargets.v4PoolManager !== undefined &&
      !isValidAddress(lane.validationTargets.v4PoolManager)
    ) {
      issues.push(`Lane ${lane.key} has invalid v4PoolManager validation target`);
    }

    if (lane.executionMode === 'direct') {
      if (lane.wormholeReceiverCoreAddress !== undefined) {
        issues.push(`Lane ${lane.key} is direct-mode but defines wormhole receiver core`);
      }
      if (lane.legacyPayloadVersion !== undefined) {
        issues.push(`Lane ${lane.key} is direct-mode but defines legacy payload version`);
      }
      if (lane.legacyNextSequenceStorageSlot !== undefined) {
        issues.push(`Lane ${lane.key} is direct-mode but defines legacy sequence storage slot`);
      }
    }

    if (lane.executionMode === 'receiver-modern' && !lane.wormholeReceiverCoreAddress) {
      issues.push(
        `Lane ${lane.key} uses modern receiver mode but is missing wormhole receiver core`,
      );
    }
    if (lane.executionMode === 'receiver-modern') {
      if (lane.legacyPayloadVersion !== undefined) {
        issues.push(`Lane ${lane.key} is modern receiver-mode but defines legacy payload version`);
      }
      if (lane.legacyNextSequenceStorageSlot !== undefined) {
        issues.push(
          `Lane ${lane.key} is modern receiver-mode but defines legacy sequence storage slot`,
        );
      }
    }

    if (lane.executionMode === 'receiver-legacy') {
      if (!lane.wormholeReceiverCoreAddress) {
        issues.push(
          `Lane ${lane.key} uses legacy receiver mode but is missing wormhole receiver core`,
        );
      }
      if (!lane.legacyPayloadVersion) {
        issues.push(`Lane ${lane.key} uses legacy receiver mode but is missing payload version`);
      }
      if (!lane.legacyNextSequenceStorageSlot) {
        issues.push(
          `Lane ${lane.key} uses legacy receiver mode but is missing next sequence storage slot`,
        );
      }
    }

    if (
      lane.wormholeReceiverCoreAddress !== undefined &&
      !isValidAddress(lane.wormholeReceiverCoreAddress)
    ) {
      issues.push(`Lane ${lane.key} has invalid wormhole receiver core address`);
    }
  }

  return issues;
}
