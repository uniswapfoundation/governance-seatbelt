import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
} from 'viem';
import { bsc, celo, mainnet, monad, polygon, tempo } from 'viem/chains';
import type { TenderlySimulation } from '../../types.d';
import {
  LAYER_ZERO_EXECUTE_ABI,
  LAYER_ZERO_LANE_SUPPORT_MATRIX,
  LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
  UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
} from '../../utils/bridges/layerzero';
import {
  POLYGON_FX_CHILD,
  POLYGON_FX_PROCESS_MESSAGE_ABI,
  POLYGON_FX_ROOT,
  POLYGON_FX_SEND_MESSAGE_ABI,
} from '../../utils/bridges/polygon-fx';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../../utils/bridges/wormhole';
import {
  LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION,
  LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
} from '../../utils/bridges/wormhole-runtime-state';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  getWormholeLaneByKey,
} from '../../utils/bridges/wormhole-support';
import { createMockSimulation } from './test-utils';

process.env.ETHERSCAN_API_KEY ??= 'test-etherscan-key';
process.env.TENDERLY_ACCESS_TOKEN ??= 'test-tenderly-token';
process.env.TENDERLY_USER ??= 'test-user';
process.env.TENDERLY_PROJECT_SLUG ??= 'test-project';
process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';

const RECEIVER_PAYLOAD_VERSION = LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION;
const TEMPO_RECEIVER = getWormholeLaneByKey('tempo').l2FromAddress;
const CELO_RECEIVER = getWormholeLaneByKey('celo').l2FromAddress;
const MONAD_RECEIVER = getWormholeLaneByKey('monad').l2FromAddress;
const BNB_RECEIVER = getWormholeLaneByKey('bnb').l2FromAddress;
const CELO_WORMHOLE_CORE = getWormholeLaneByKey('celo').wormholeReceiverCoreAddress;
const MONAD_WORMHOLE_CORE = getWormholeLaneByKey('monad').wormholeReceiverCoreAddress;

if (!CELO_WORMHOLE_CORE || !MONAD_WORMHOLE_CORE) {
  throw new Error('Expected Celo and Monad Wormhole core addresses to be configured');
}

type ReceiverReadRequest = { address: `0x${string}`; functionName: string; blockNumber?: bigint };

async function resolveMockedReceiverReadContract(
  request: ReceiverReadRequest,
): Promise<Hex | bigint> {
  const receiverAddress = getAddress(request.address);

  if (
    receiverAddress === getAddress(TEMPO_RECEIVER) ||
    receiverAddress === getAddress(CELO_RECEIVER) ||
    receiverAddress === getAddress(MONAD_RECEIVER)
  ) {
    if (request.functionName === 'nextMinimumSequence') return 7n;
    if (request.functionName === 'EXPECTED_MESSAGE_PAYLOAD_VERSION') {
      return RECEIVER_PAYLOAD_VERSION;
    }
  }

  if (receiverAddress === getAddress(BNB_RECEIVER)) {
    throw new Error(`Legacy BNB receiver should not probe ${request.functionName}`);
  }

  throw new Error(`Unexpected readContract call for ${request.functionName} on ${request.address}`);
}

const mockedReceiverReadContract = mock(async (request: ReceiverReadRequest) =>
  resolveMockedReceiverReadContract(request),
);

async function defaultGetBlockNumber() {
  return 100n;
}

async function defaultGetBlock(request?: { blockNumber?: bigint }) {
  const blockNumber = request?.blockNumber ?? 100n;
  return {
    number: blockNumber,
    timestamp: 1_600_000_000n + blockNumber,
  };
}

const mockedGetBlockNumber = mock(defaultGetBlockNumber);
const mockedGetBlock = mock(defaultGetBlock);

type ReceiverStorageRequest = {
  address: `0x${string}`;
  slot: `0x${string}`;
  blockNumber?: bigint;
};

async function resolveMockedGetStorageAt(
  request: ReceiverStorageRequest,
): Promise<Hex | undefined> {
  expect(request.slot).toBe(LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT);
  if (getAddress(request.address) === BNB_RECEIVER) {
    return '0x0b';
  }
  return undefined;
}

const mockedGetStorageAt = mock(async (request: ReceiverStorageRequest) =>
  resolveMockedGetStorageAt(request),
);

const mockedGetClientForChain = mock(() => ({
  getBlockNumber: mockedGetBlockNumber,
  getBlock: mockedGetBlock,
  readContract: mockedReceiverReadContract,
  getStorageAt: mockedGetStorageAt,
}));

mock.module('../../utils/clients/client', () => ({
  BlockExplorerSource: {
    Blockscout: 'blockscout',
    Etherscan: 'etherscan',
  },
  VerificationBackend: {
    EtherscanV2: 'etherscan-v2',
    Blockscout: 'blockscout',
    Tempo: 'tempo',
    SourcifyOnly: 'sourcify-only',
  },
  formatVerificationBackend: (backend: string) => backend,
  getBlockExplorerBaseUrlForChain: () => 'https://etherscan.io',
  getClientForChain: mockedGetClientForChain,
  getChainConfig: () => ({
    chainId: mainnet.id,
    blockExplorer: { baseUrl: 'https://etherscan.io' },
    rpcUrl: 'http://localhost:8545',
  }),
  resolveVerificationConfig: () => ({
    backend: 'etherscan-v2',
    apiUrl: 'https://api.etherscan.io/v2/api',
    apiKey: 'test-etherscan-key',
    degradedReason: undefined,
  }),
  CHAIN_CONFIGS: {
    [mainnet.id]: {
      chainId: mainnet.id,
      blockExplorer: { baseUrl: 'https://etherscan.io' },
      rpcUrl: 'http://localhost:8545',
    },
  },
  publicClient: {
    getChainId: async () => mainnet.id,
    getBlock: async () => ({
      number: 31_000_000n,
      timestamp: 1_600_000_000n,
    }),
  },
}));

const mockedSendSimulation = mock(
  async (payload: Record<string, unknown>): Promise<TenderlySimulation> => {
    transportCalls.push(payload);
    const next = transportQueue.shift();

    if (!next) {
      throw new Error('Unexpected simulation call');
    }

    if (next.type === 'throw') {
      throw next.error;
    }

    return next.sim;
  },
);

mock.module('../../utils/clients/tenderly-api', () => ({
  getLatestBlock: async () => {
    throw new Error('Unexpected getLatestBlock call');
  },
  getTenderlySaveFlags: () => ({ save: true, saveIfFails: true }),
  sendEncodeRequest: async () => {
    throw new Error('Unexpected sendEncodeRequest call');
  },
  sendSimulation: mockedSendSimulation,
}));

const WORMHOLE_PROPOSAL_TARGET = '0xf5F4496219F31CDCBa6130B5402873624585615a' as const;
const WORMHOLE_ADDRESS = '0x00000000000000000000000000000000000000AA' as const;
const DIRECT_DESTINATION_CHAIN_ID = polygon.id;
const CELO_CHAIN_ID = celo.id;
const TIMELOCK_ADDRESS = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';

type CrossChainHandler = typeof import('../../utils/clients/tenderly').handleCrossChainSimulations;
type CrossChainSourceResult = Parameters<CrossChainHandler>[0];

type TransportOutcome =
  | { type: 'return'; sim: TenderlySimulation }
  | { type: 'throw'; error: Error };

const transportCalls: Array<Record<string, unknown> | undefined> = [];
const transportQueue: TransportOutcome[] = [];

let handleCrossChainSimulations: CrossChainHandler;
let tenderlyImportVersion = 0;

beforeEach(async () => {
  ({ handleCrossChainSimulations } = await import(
    `../../utils/clients/tenderly?execution-engine-test=${tenderlyImportVersion++}`
  ));
});

afterEach(() => {
  transportCalls.length = 0;
  transportQueue.length = 0;
  mockedSendSimulation.mockClear();
  mockedGetClientForChain.mockClear();
  mockedGetBlockNumber.mockClear();
  mockedGetBlock.mockClear();
  mockedGetBlockNumber.mockImplementation(defaultGetBlockNumber);
  mockedGetBlock.mockImplementation(defaultGetBlock);
  mockedReceiverReadContract.mockClear();
  mockedReceiverReadContract.mockImplementation(resolveMockedReceiverReadContract);
  mockedGetStorageAt.mockClear();
  mockedGetStorageAt.mockImplementation(resolveMockedGetStorageAt);
});

afterAll(() => {
  mock.restore();
});

function enqueueSimulation(sim: TenderlySimulation) {
  transportQueue.push({ type: 'return', sim });
}

function enqueueFailure(error: string) {
  transportQueue.push({ type: 'throw', error: new Error(error) });
}

function makeSimulation(params: {
  id: string;
  status?: boolean;
  chainId?: number;
  stateDiff?: Array<{ address: string; key: string; dirty: string; original?: string }>;
  errorReason?: string;
}): TenderlySimulation {
  const sim = createMockSimulation([]);
  const chainId = params.chainId ?? DIRECT_DESTINATION_CHAIN_ID;

  sim.simulation.id = params.id;
  sim.simulation.network_id = String(chainId);
  sim.simulation.block_number = 31_000_000;
  sim.simulation.status = params.status ?? true;

  sim.transaction.network_id = String(chainId);
  sim.transaction.block_number = 31_000_000;
  sim.transaction.status = params.status ?? true;

  const callTrace = sim.transaction.transaction_info
    .call_trace as typeof sim.transaction.transaction_info.call_trace & {
    error_reason?: string;
  };
  callTrace.error_reason = params.errorReason;
  sim.transaction.transaction_info.state_diff =
    params.stateDiff?.map((entry) => ({
      soltype: null,
      original: entry.original ?? '0x0',
      dirty: entry.dirty,
      raw: [
        {
          address: entry.address,
          key: entry.key,
          original: entry.original ?? '0x0',
          dirty: entry.dirty,
        },
      ],
    })) ?? [];

  return sim;
}

function makeWormholeCalldata(
  calls: Array<{
    target: `0x${string}`;
    value?: bigint;
    data: `0x${string}`;
  }>,
  wormholeChainId = 5,
): `0x${string}` {
  return encodeFunctionData({
    abi: WORMHOLE_SEND_MESSAGE_ABI,
    functionName: 'sendMessage',
    args: [
      calls.map((call) => call.target),
      calls.map((call) => call.value ?? 0n),
      calls.map((call) => call.data),
      WORMHOLE_ADDRESS,
      wormholeChainId,
    ],
  });
}

function makeLayerZeroCalldata(
  laneKey: keyof typeof LAYER_ZERO_LANE_SUPPORT_MATRIX,
  calls: Array<{
    target: `0x${string}`;
    value?: bigint;
    data: `0x${string}`;
  }>,
): `0x${string}` {
  const lane = LAYER_ZERO_LANE_SUPPORT_MATRIX[laneKey];
  const payload = encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }],
    [
      calls.map((call) => call.target),
      calls.map((call) => call.value ?? 0n),
      calls.map((call) => call.data),
    ],
  );

  return encodeFunctionData({
    abi: LAYER_ZERO_EXECUTE_ABI,
    functionName: 'execute',
    args: [lane.layerZeroRemoteChainId, payload, '0x'],
  });
}

function makeLayerZeroTrustedRemoteCalldata(
  laneKey: keyof typeof LAYER_ZERO_LANE_SUPPORT_MATRIX,
): `0x${string}` {
  const lane = LAYER_ZERO_LANE_SUPPORT_MATRIX[laneKey];
  if (!lane.requiredTrustedRemoteAddress) {
    throw new Error(`LayerZero lane ${laneKey} does not require trusted remote setup`);
  }

  return encodeFunctionData({
    abi: LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
    functionName: 'setTrustedRemoteAddress',
    args: [lane.layerZeroRemoteChainId, lane.requiredTrustedRemoteAddress],
  });
}

function makeSourceResult(
  calldatas: readonly `0x${string}`[],
  options?: { simulationTimestamp?: bigint; targets?: readonly `0x${string}`[] },
): CrossChainSourceResult {
  const sim = createMockSimulation([]);
  sim.transaction.status = true;
  const targets = options?.targets ?? calldatas.map(() => WORMHOLE_PROPOSAL_TARGET);

  return {
    sim,
    proposal: {
      id: 999n,
      proposalId: 999n,
      proposer: TIMELOCK_ADDRESS,
      targets: [...targets],
      values: calldatas.map(() => 0n),
      signatures: calldatas.map(() => ''),
      calldatas: [...calldatas],
      startBlock: 1000n,
      endBlock: 2000n,
      description: 'Test wormhole proposal',
    },
    deps: {
      governor: null,
      timelock: { address: TIMELOCK_ADDRESS },
      publicClient: null,
      chainConfig: {
        chainId: mainnet.id,
        blockExplorer: { baseUrl: 'https://etherscan.io' },
        rpcUrl: 'http://localhost:8545',
      },
      targets: [...targets],
      touchedContracts: [],
    },
    latestBlock: {
      number: 1500n,
      timestamp: 1_600_000_000n,
    },
    simulationTimestamp: options?.simulationTimestamp,
  };
}

describe('cross-chain destination execution engine', () => {
  test('executes Polygon FxPortal messages through the FxChild handoff', async () => {
    const polygonReceiver = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');
    const childMessage = '0x12345678' as const;
    const calldata = encodeFunctionData({
      abi: POLYGON_FX_SEND_MESSAGE_ABI,
      functionName: 'sendMessageToChild',
      args: [polygonReceiver, childMessage],
    });

    enqueueSimulation(
      makeSimulation({
        id: 'polygon-fx-step',
        chainId: polygon.id,
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { targets: [POLYGON_FX_ROOT] }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${polygon.id}`,
      from: POLYGON_FX_CHILD,
      to: polygonReceiver,
      value: '0',
    });

    const payloadInput = transportCalls[0]?.input;
    expect(typeof payloadInput).toBe('string');
    const decoded = decodeFunctionData({
      abi: POLYGON_FX_PROCESS_MESSAGE_ABI,
      data: payloadInput as Hex,
    });
    expect(decoded.functionName).toBe('processMessageFromRoot');
    expect(decoded.args).toEqual([1n, getAddress(TIMELOCK_ADDRESS), childMessage]);
    expect(result.destinationJobResults[0]?.bridgeType).toBe('PolygonFxL1L2');
    expect(result.destinationJobResults[0]?.status).toBe('success');
  });

  test('executes LayerZero migration payloads on MegaETH and Avalanche after MegaETH setup', async () => {
    const avalancheTarget = getAddress('0x0000000000000000000000000000000000000a60');
    const firstMegaethTarget = getAddress('0x0000000000000000000000000000000000000a61');
    const secondMegaethTarget = getAddress('0x0000000000000000000000000000000000000a62');
    const megaethSetupCalldata = makeLayerZeroTrustedRemoteCalldata('megaeth');
    const avalancheCalldata = makeLayerZeroCalldata('avalanche', [
      { target: avalancheTarget, data: '0x11111111' },
    ]);
    const megaethCalldata = makeLayerZeroCalldata('megaeth', [
      { target: firstMegaethTarget, value: 3n, data: '0x22222222' },
      { target: secondMegaethTarget, value: 0n, data: '0x33333333' },
    ]);

    enqueueSimulation(
      makeSimulation({
        id: 'layerzero-megaeth-step-1',
        chainId: LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.destinationChainId,
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'layerzero-megaeth-step-2',
        chainId: LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.destinationChainId,
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'layerzero-avalanche-step',
        chainId: LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.destinationChainId,
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([megaethSetupCalldata, megaethCalldata, avalancheCalldata], {
        targets: [
          UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
          UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
          UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
        ],
      }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(3);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.destinationChainId}`,
      from: UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      to: firstMegaethTarget,
      input: '0x22222222',
      value: '3',
    });
    expect(transportCalls[1]).toMatchObject({
      network_id: `${LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.destinationChainId}`,
      from: UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      to: secondMegaethTarget,
      input: '0x33333333',
      value: '0',
    });
    expect(transportCalls[2]).toMatchObject({
      network_id: `${LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.destinationChainId}`,
      from: UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR,
      to: avalancheTarget,
      input: '0x11111111',
      value: '0',
    });
    expect(result.destinationJobResults.map((job) => job.bridgeType)).toEqual([
      'LayerZeroL1L2',
      'LayerZeroL1L2',
    ]);
    expect(result.destinationJobResults.map((job) => job.stepResults.length)).toEqual([2, 1]);
    expect(result.destinationJobResults.map((job) => job.status)).toEqual(['success', 'success']);
  });

  test('executes one simulated destination job per supported Wormhole lane', async () => {
    const calldatas = SUPPORTED_WORMHOLE_LANE_KEYS.map((laneKey) => {
      const lane = getWormholeLaneByKey(laneKey);
      const target = getAddress('0x00000000000000000000000000000000000000A1');
      return makeWormholeCalldata([{ target, data: '0x11111111' }], lane.wormholeChainId);
    });

    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      const lane = getWormholeLaneByKey(laneKey);
      enqueueSimulation(
        makeSimulation({
          id: `${laneKey}-step-1`,
          chainId: lane.destinationChainId,
        }),
      );
    }

    const result = await handleCrossChainSimulations(makeSourceResult(calldatas));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(SUPPORTED_WORMHOLE_LANE_KEYS.length);
    expect(result.destinationJobResults).toHaveLength(SUPPORTED_WORMHOLE_LANE_KEYS.length);

    for (const laneKey of SUPPORTED_WORMHOLE_LANE_KEYS) {
      const lane = getWormholeLaneByKey(laneKey);
      const jobResult = result.destinationJobResults.find(
        (job) => job.chainId === lane.destinationChainId,
      );
      expect(jobResult?.bridgeType).toBe('WormholeL1L2');
      expect(jobResult?.status).toBe('success');
    }
  });

  test('does not leak committed state across different destination chains', async () => {
    const bnbTarget = getAddress('0x0000000000000000000000000000000000000B56');
    const celoTarget = getAddress('0x0000000000000000000000000000000000000CE0');

    const bnbCalldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x11111111' }], 4);
    const celoCalldata = makeWormholeCalldata([{ target: celoTarget, data: '0x22222222' }], 14);

    enqueueSimulation(
      makeSimulation({
        id: 'bnb-step-1',
        chainId: 56,
        stateDiff: [{ address: bnbTarget, key: '0x01', dirty: '0xaa' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'celo-step-1',
        chainId: CELO_CHAIN_ID,
        stateDiff: [{ address: celoTarget, key: '0x02', dirty: '0xbb' }],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([bnbCalldata, celoCalldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[0]?.network_id).toBe('56');
    expect(transportCalls[1]?.network_id).toBe(String(CELO_CHAIN_ID));

    const secondPayload = transportCalls[1];
    const secondStateObjectsRaw = secondPayload?.state_objects;
    const secondStateObjects =
      secondStateObjectsRaw &&
      typeof secondStateObjectsRaw === 'object' &&
      !Array.isArray(secondStateObjectsRaw)
        ? (secondStateObjectsRaw as Record<string, unknown>)
        : null;
    expect(secondStateObjects?.[bnbTarget]).toBeUndefined();
    expect(result.destinationStateByChain[56]?.[bnbTarget]?.storage?.['0x01']).toBe('0xaa');
    expect(result.destinationStateByChain[CELO_CHAIN_ID]?.[celoTarget]?.storage?.['0x02']).toBe(
      '0xbb',
    );
  });

  test('keeps step results and commits merged state for a successful multi-step job', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000A1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000A2');
    const calldata = makeWormholeCalldata([
      { target: firstTarget, data: '0x11111111' },
      { target: secondTarget, data: '0x22222222' },
    ]);

    enqueueSimulation(
      makeSimulation({
        id: 'step-1',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xaa' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'step-2',
        stateDiff: [{ address: secondTarget, key: '0x02', dirty: '0xbb' }],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xaa',
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('success');
    expect(jobResult?.stepResults).toHaveLength(2);
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('step-1');
    expect(jobResult?.stepResults[1]?.sim?.simulation.id).toBe('step-2');
    expect(jobResult?.accumulatedSim?.simulation.id).toBe('step-2');
    expect(result.crossChainFailure).toBe(false);
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[firstTarget]?.storage?.['0x01'],
    ).toBe('0xaa');
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[secondTarget]?.storage?.[
        '0x02'
      ],
    ).toBe('0xbb');
  });

  test('preserves earlier successful steps but does not commit state when a later step fails', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000B1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000B2');
    const calldata = makeWormholeCalldata([
      { target: firstTarget, data: '0x33333333' },
      { target: secondTarget, data: '0x44444444' },
    ]);

    enqueueSimulation(
      makeSimulation({
        id: 'step-success',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xcc' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'step-failure',
        status: false,
        errorReason: 'bridge reverted',
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xcc',
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('failure');
    expect(jobResult?.stepResults).toHaveLength(2);
    expect(jobResult?.stepResults[0]?.status).toBe('success');
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('step-success');
    expect(jobResult?.stepResults[1]?.status).toBe('failure');
    expect(jobResult?.stepResults[1]?.sim?.simulation.id).toBe('step-failure');
    expect(jobResult?.error).toBe('bridge reverted');
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]).toBeUndefined();
  });

  test('later jobs on the same chain start from committed state of earlier successful jobs', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000C1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000C2');
    const firstJob = makeWormholeCalldata([{ target: firstTarget, data: '0x55555555' }]);
    const secondJob = makeWormholeCalldata([{ target: secondTarget, data: '0x66666666' }]);

    enqueueSimulation(
      makeSimulation({
        id: 'job-1-step',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xdd' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'job-2-step',
        stateDiff: [{ address: secondTarget, key: '0x02', dirty: '0xee' }],
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([firstJob, secondJob]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xdd',
        },
      },
    });

    expect(result.crossChainFailure).toBe(false);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults.every((jobResult) => jobResult.status === 'success')).toBe(
      true,
    );
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[firstTarget]?.storage?.['0x01'],
    ).toBe('0xdd');
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[secondTarget]?.storage?.[
        '0x02'
      ],
    ).toBe('0xee');
  });

  test('later failed jobs on the same chain do not roll back earlier committed state', async () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000D1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000D2');
    const firstJob = makeWormholeCalldata([{ target: firstTarget, data: '0x77777777' }]);
    const secondJob = makeWormholeCalldata([{ target: secondTarget, data: '0x88888888' }]);

    enqueueSimulation(
      makeSimulation({
        id: 'job-1-step',
        stateDiff: [{ address: firstTarget, key: '0x01', dirty: '0xff' }],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'job-2-step',
        status: false,
        errorReason: 'second job reverted',
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([firstJob, secondJob]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);
    expect(transportCalls[1]?.state_objects).toMatchObject({
      [firstTarget]: {
        storage: {
          '0x01': '0xff',
        },
      },
    });

    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationJobResults[1]?.status).toBe('failure');
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[firstTarget]?.storage?.['0x01'],
    ).toBe('0xff');
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[secondTarget],
    ).toBeUndefined();
  });

  test('records API exceptions without recording a sim or committing state', async () => {
    const target = getAddress('0x00000000000000000000000000000000000000E1');
    const seededAddress = getAddress('0x00000000000000000000000000000000000000E2');
    const calldata = makeWormholeCalldata([{ target, data: '0x77777777' }]);

    enqueueFailure('network down');

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]), {
      initialStateByChain: {
        [DIRECT_DESTINATION_CHAIN_ID]: {
          [seededAddress]: {
            storage: {
              '0x09': '0xseed',
            },
          },
        },
      },
    });

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('failure');
    expect(jobResult?.stepResults).toHaveLength(1);
    expect(jobResult?.stepResults[0]?.sim).toBeUndefined();
    expect(jobResult?.error).toContain('network down');
    expect(result.crossChainFailure).toBe(true);
    expect(
      result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[seededAddress]?.storage?.[
        '0x09'
      ],
    ).toBe('0xseed');
    expect(result.destinationStateByChain[DIRECT_DESTINATION_CHAIN_ID]?.[target]).toBeUndefined();
  });

  test('uses wormhole receiver mode for tempo and stubs the Wormhole core contract', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoWormholeCore = getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-receiver-step',
        chainId: tempo.id,
        stateDiff: [
          {
            address: TEMPO_RECEIVER,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x01',
          },
        ],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(mockedGetClientForChain).toHaveBeenCalledWith(tempo.id);
    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${tempo.id}`,
      from: '0x0000000000000000000000000000000000001234',
      to: TEMPO_RECEIVER,
      value: '0',
    });
    expect(String(transportCalls[0]?.input ?? '')).toMatch(/^0xf953cec7/);
    expect(transportCalls[0]?.state_objects).toMatchObject({
      [tempoWormholeCore]: {
        code: expect.stringMatching(/^0x/),
      },
    });
    const decodedTransportInput = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: transportCalls[0]?.input as `0x${string}`,
    });
    const [whMessage] = decodedTransportInput.args;
    const [timestamp, sequence, payload] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );
    const [payloadVersion, targets, values, datas, receiverAddress, wormholeChainId] =
      decodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address[]' },
          { type: 'uint256[]' },
          { type: 'bytes[]' },
          { type: 'address' },
          { type: 'uint16' },
        ],
        payload,
      );
    expect(timestamp).toBe(1_600_000_321);
    expect(sequence).toBe(7n);
    expect(payloadVersion).toBe(RECEIVER_PAYLOAD_VERSION);
    expect(targets).toEqual([tempoTarget]);
    expect(values).toEqual([0n]);
    expect(datas).toEqual(['0x8da5cb5b']);
    expect(receiverAddress).toBe(TEMPO_RECEIVER);
    expect(wormholeChainId).toBe(68);

    const [jobResult] = result.destinationJobResults;
    expect(jobResult?.status).toBe('success');
    expect(jobResult?.stepResults).toHaveLength(1);
    expect(jobResult?.stepResults[0]?.sim?.simulation.id).toBe('tempo-receiver-step');
    expect(result.crossChainFailure).toBe(false);
    expect(
      result.destinationStateByChain[tempo.id]?.[TEMPO_RECEIVER]?.storage?.[
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ],
    ).toBe('0x01');
    expect(result.destinationStateByChain[tempo.id]?.[tempoWormholeCore]).toBeUndefined();
  });

  test('uses receiver mode for the legacy BNB Wormhole receiver with storage fallback', async () => {
    const bnbTarget = getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7');
    const bnbWormholeCore = getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B');
    const calldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x8da5cb5b' }], 4);

    enqueueSimulation(
      makeSimulation({
        id: 'bnb-receiver-step',
        chainId: bsc.id,
        stateDiff: [
          {
            address: BNB_RECEIVER,
            key: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
            dirty: '0x0c',
          },
        ],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(mockedReceiverReadContract).not.toHaveBeenCalled();
    expect(mockedGetClientForChain).toHaveBeenCalledWith(bsc.id);
    expect(mockedGetStorageAt).toHaveBeenCalledWith({
      address: BNB_RECEIVER,
      slot: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
      blockNumber: 100n,
    });
    expect(transportCalls[0]).toMatchObject({
      network_id: `${bsc.id}`,
      from: '0x0000000000000000000000000000000000001234',
      to: BNB_RECEIVER,
      value: '0',
    });
    expect(transportCalls[0]?.state_objects).toMatchObject({
      [bnbWormholeCore]: {
        code: expect.stringMatching(/^0x/),
      },
    });

    const decodedTransportInput = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: transportCalls[0]?.input as `0x${string}`,
    });
    const [whMessage] = decodedTransportInput.args;
    const [, sequence, payload] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );
    const [payloadVersion, targets, values, datas, receiverAddress, wormholeChainId] =
      decodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address[]' },
          { type: 'uint256[]' },
          { type: 'bytes[]' },
          { type: 'address' },
          { type: 'uint16' },
        ],
        payload,
      );

    expect(sequence).toBe(11n);
    expect(payloadVersion).toBe(RECEIVER_PAYLOAD_VERSION);
    expect(targets).toEqual([bnbTarget]);
    expect(values).toEqual([0n]);
    expect(datas).toEqual(['0x8da5cb5b']);
    expect(receiverAddress).toBe(BNB_RECEIVER);
    expect(wormholeChainId).toBe(4);
    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(
      result.destinationStateByChain[bsc.id]?.[BNB_RECEIVER]?.storage?.[
        LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT
      ],
    ).toBe('0x0c');
  });

  test.each([
    {
      name: 'Celo',
      chainId: 42220,
      wormholeChainId: 14,
      receiver: CELO_RECEIVER,
      core: CELO_WORMHOLE_CORE,
      target: getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
    },
    {
      name: 'Monad',
      chainId: monad.id,
      wormholeChainId: 48,
      receiver: MONAD_RECEIVER,
      core: MONAD_WORMHOLE_CORE,
      target: getAddress('0x204faca1764b154221e35c0d20abb3c525710498'),
    },
  ])(
    'uses receiver mode for $name wormhole lanes',
    async ({ chainId, wormholeChainId, receiver, core, target }) => {
      const calldata = makeWormholeCalldata([{ target, data: '0x8da5cb5b' }], wormholeChainId);

      enqueueSimulation(
        makeSimulation({
          id: `${chainId}-receiver-step`,
          chainId,
          stateDiff: [
            {
              address: receiver,
              key: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
              dirty: '0x01',
            },
          ],
        }),
      );

      const result = await handleCrossChainSimulations(
        makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
      );

      expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
      expect(mockedGetClientForChain).toHaveBeenCalledWith(chainId);
      expect(mockedReceiverReadContract).toHaveBeenCalledWith({
        address: receiver,
        abi: expect.any(Array),
        functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
        blockNumber: 100n,
      });
      expect(mockedReceiverReadContract).toHaveBeenCalledWith({
        address: receiver,
        abi: expect.any(Array),
        functionName: 'nextMinimumSequence',
        blockNumber: 100n,
      });
      expect(transportCalls[0]).toMatchObject({
        network_id: `${chainId}`,
        from: '0x0000000000000000000000000000000000001234',
        to: receiver,
        value: '0',
      });
      expect(transportCalls[0]?.state_objects).toMatchObject({
        [core]: {
          code: expect.stringMatching(/^0x/),
        },
      });

      const decodedTransportInput = decodeFunctionData({
        abi: parseAbi(['function receiveMessage(bytes whMessage)']),
        data: transportCalls[0]?.input as `0x${string}`,
      });
      const [whMessage] = decodedTransportInput.args;
      const [, sequence, payload] = decodeAbiParameters(
        [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
        whMessage,
      );
      const [payloadVersion, targets, values, datas, receiverAddress, decodedChainId] =
        decodeAbiParameters(
          [
            { type: 'bytes32' },
            { type: 'address[]' },
            { type: 'uint256[]' },
            { type: 'bytes[]' },
            { type: 'address' },
            { type: 'uint16' },
          ],
          payload,
        );

      expect(sequence).toBe(7n);
      expect(payloadVersion).toBe(RECEIVER_PAYLOAD_VERSION);
      expect(targets).toEqual([target]);
      expect(values).toEqual([0n]);
      expect(datas).toEqual(['0x8da5cb5b']);
      expect(receiverAddress).toBe(receiver);
      expect(decodedChainId).toBe(wormholeChainId);
      expect(result.destinationJobResults[0]?.status).toBe('success');
    },
  );

  test('keeps polygon wormhole lanes on direct mode when the destination authority is not a receiver', async () => {
    const polygonTarget = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
    const calldata = makeWormholeCalldata([{ target: polygonTarget, data: '0x8da5cb5b' }], 5);

    enqueueSimulation(
      makeSimulation({
        id: 'polygon-direct-step',
        chainId: polygon.id,
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(mockedReceiverReadContract).not.toHaveBeenCalled();
    expect(mockedGetStorageAt).not.toHaveBeenCalled();
    expect(transportCalls[0]).toMatchObject({
      network_id: `${polygon.id}`,
      from: getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374'),
      to: polygonTarget,
      input: '0x8da5cb5b',
      value: '0',
    });
    expect(result.destinationJobResults[0]?.status).toBe('success');
  });

  test('contains legacy receiver storage read failures to the BNB job', async () => {
    const bnbTarget = getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7');
    const polygonTarget = getAddress('0x00000000000000000000000000000000000000F1');
    const bnbCalldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x8da5cb5b' }], 4);
    const polygonCalldata = makeWormholeCalldata(
      [{ target: polygonTarget, data: '0x99999999' }],
      5,
    );

    mockedGetStorageAt.mockImplementation(async (request) => {
      if (getAddress(request.address) === BNB_RECEIVER) {
        throw new Error('receiver storage unavailable');
      }

      expect(request.slot).toBe(LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT);
      return undefined;
    });

    enqueueSimulation(
      makeSimulation({
        id: 'polygon-after-bnb-setup-failure',
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([bnbCalldata, polygonCalldata]),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${polygon.id}`,
      to: polygonTarget,
    });
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain('receiver storage unavailable');
    expect(result.destinationJobResults[0]?.stepResults).toHaveLength(0);
    expect(result.destinationJobResults[1]?.status).toBe('success');
  });

  test('contains receiver metadata read failures to the tempo job', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const polygonTarget = getAddress('0x00000000000000000000000000000000000000F1');
    const tempoCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);
    const polygonCalldata = makeWormholeCalldata(
      [{ target: polygonTarget, data: '0x99999999' }],
      5,
    );

    mockedReceiverReadContract.mockImplementation(async () => {
      throw new Error('receiver metadata unavailable');
    });

    enqueueSimulation(
      makeSimulation({
        id: 'polygon-after-tempo-setup-failure',
        chainId: polygon.id,
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([tempoCalldata, polygonCalldata]),
    );

    expect(mockedSendSimulation).toHaveBeenCalledTimes(1);
    expect(transportCalls[0]).toMatchObject({
      network_id: `${polygon.id}`,
      to: polygonTarget,
    });
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults).toHaveLength(2);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain('receiver metadata unavailable');
    expect(result.destinationJobResults[0]?.stepResults).toHaveLength(0);
    expect(result.destinationJobResults[1]?.status).toBe('success');
  });

  test('retries a transient tempo historical block read before succeeding', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    mockedGetBlock.mockImplementationOnce(async () => {
      throw new Error('tempo historical block unavailable');
    });

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-retry-success',
        chainId: tempo.id,
        stateDiff: [
          {
            address: TEMPO_RECEIVER,
            key: LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT,
            dirty: '0x01',
          },
        ],
      }),
    );

    const result = await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_321n }),
    );

    expect(mockedGetBlock).toHaveBeenCalledTimes(2);
    expect(result.crossChainFailure).toBe(false);
    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationJobResults[0]?.stepResults).toHaveLength(1);
  });

  test('fails closed when modern receiver metadata reads fail', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    mockedReceiverReadContract.mockImplementation(async (request) => {
      if (
        getAddress(request.address) === TEMPO_RECEIVER &&
        request.functionName === 'EXPECTED_MESSAGE_PAYLOAD_VERSION'
      ) {
        throw new Error('tempo metadata RPC unavailable');
      }

      return await resolveMockedReceiverReadContract(request);
    });

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).not.toHaveBeenCalled();
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain('tempo metadata RPC unavailable');
  });

  test('fails closed when legacy receiver storage is missing', async () => {
    const bnbTarget = getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7');
    const calldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x8da5cb5b' }], 4);

    mockedGetStorageAt.mockImplementation(async (request) => {
      expect(request.slot).toBe(LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT);
      return undefined;
    });

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).not.toHaveBeenCalled();
    expect(mockedReceiverReadContract).not.toHaveBeenCalled();
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain(
      'Missing legacy Wormhole receiver sequence storage',
    );
  });

  test('fails closed when legacy receiver storage is empty hex', async () => {
    const bnbTarget = getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7');
    const calldata = makeWormholeCalldata([{ target: bnbTarget, data: '0x8da5cb5b' }], 4);

    mockedGetStorageAt.mockImplementation(async (request) => {
      expect(request.slot).toBe(LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT);
      return '0x';
    });

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]));

    expect(mockedSendSimulation).not.toHaveBeenCalled();
    expect(mockedReceiverReadContract).not.toHaveBeenCalled();
    expect(result.crossChainFailure).toBe(true);
    expect(result.destinationJobResults[0]?.status).toBe('failure');
    expect(result.destinationJobResults[0]?.error).toContain(
      'Missing legacy Wormhole receiver sequence storage',
    );
  });

  test('preserves non-code Wormhole core overrides after receiver-mode cleanup', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoWormholeCore = getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-core-override-preserved',
        chainId: tempo.id,
      }),
    );

    const result = await handleCrossChainSimulations(makeSourceResult([calldata]), {
      initialStateByChain: {
        [tempo.id]: {
          [tempoWormholeCore]: {
            balance: '0x2a',
            storage: {
              '0x99': '0x77',
            },
          },
        },
      },
    });

    expect(result.destinationJobResults[0]?.status).toBe('success');
    expect(result.destinationStateByChain[tempo.id]?.[tempoWormholeCore]).toEqual({
      balance: '0x2a',
      storage: {
        '0x99': '0x77',
      },
    });
  });

  test('pins initial receiver metadata reads to the simulation timestamp block', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const calldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-historical-read-block',
        chainId: tempo.id,
      }),
    );

    await handleCrossChainSimulations(
      makeSourceResult([calldata], { simulationTimestamp: 1_600_000_050n }),
    );

    expect(mockedGetBlockNumber).toHaveBeenCalledTimes(1);
    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(mockedReceiverReadContract.mock.calls[0]?.[0]).toMatchObject({
      functionName: 'EXPECTED_MESSAGE_PAYLOAD_VERSION',
      blockNumber: 50n,
    });
    expect(mockedReceiverReadContract.mock.calls[1]?.[0]).toMatchObject({
      functionName: 'nextMinimumSequence',
      blockNumber: 50n,
    });
  });

  test('uses receiver state overrides for later tempo jobs on the same chain', async () => {
    const tempoFirstTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const tempoSecondTarget = getAddress('0x33620f62C5b9B2086dD6b62F4A297A9f30347029');
    const firstCalldata = makeWormholeCalldata(
      [{ target: tempoFirstTarget, data: '0x8da5cb5b' }],
      68,
    );
    const secondCalldata = makeWormholeCalldata(
      [{ target: tempoSecondTarget, data: '0x8da5cb5b' }],
      68,
    );

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-first',
        chainId: tempo.id,
        stateDiff: [
          {
            address: TEMPO_RECEIVER,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x09',
          },
        ],
      }),
    );
    enqueueSimulation(
      makeSimulation({
        id: 'tempo-second',
        chainId: tempo.id,
      }),
    );

    await handleCrossChainSimulations(makeSourceResult([firstCalldata, secondCalldata]));

    expect(mockedReceiverReadContract).toHaveBeenCalledTimes(2);
    expect(mockedSendSimulation).toHaveBeenCalledTimes(2);

    const decodeSequence = (input: unknown) => {
      const decodedTransportInput = decodeFunctionData({
        abi: parseAbi(['function receiveMessage(bytes whMessage)']),
        data: input as `0x${string}`,
      });
      const [whMessage] = decodedTransportInput.args;
      const [, sequence] = decodeAbiParameters(
        [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
        whMessage,
      );
      return sequence;
    };

    expect(decodeSequence(transportCalls[0]?.input)).toBe(7n);
    expect(decodeSequence(transportCalls[1]?.input)).toBe(9n);
  });

  test('carries receiver runtime state across chained tempo simulations', async () => {
    const tempoTarget = getAddress('0x24a3d4757E330890A8b8978028c9e58E04611fd6');
    const firstCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);
    const secondCalldata = makeWormholeCalldata([{ target: tempoTarget, data: '0x8da5cb5b' }], 68);

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-seeded-first-run',
        chainId: tempo.id,
        stateDiff: [
          {
            address: TEMPO_RECEIVER,
            key: '0x0000000000000000000000000000000000000000000000000000000000000000',
            dirty: '0x09',
          },
        ],
      }),
    );

    const firstResult = await handleCrossChainSimulations(makeSourceResult([firstCalldata]));

    expect(firstResult.destinationJobResults[0]?.status).toBe('success');
    expect(
      firstResult.destinationStateByChain[tempo.id]?.[TEMPO_RECEIVER]?.storage?.[
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ],
    ).toBe('0x09');

    enqueueSimulation(
      makeSimulation({
        id: 'tempo-followup-run',
        chainId: tempo.id,
      }),
    );

    const secondResult = await handleCrossChainSimulations(makeSourceResult([secondCalldata]), {
      initialStateByChain: {
        [tempo.id]: firstResult.destinationStateByChain[tempo.id] ?? {},
      },
    });

    const decodedTransportInput = decodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes whMessage)']),
      data: transportCalls[1]?.input as `0x${string}`,
    });
    const [whMessage] = decodedTransportInput.args;
    const [, sequence] = decodeAbiParameters(
      [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bytes' }],
      whMessage,
    );

    expect(secondResult.destinationJobResults[0]?.status).toBe('success');
    expect(sequence).toBe(9n);
  });
});
