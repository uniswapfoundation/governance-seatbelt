import { describe, expect, test } from 'bun:test';
import {
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
} from 'viem';
import { config as migrationDraftConfig } from '../sims/layerzero-wormhole-migration-test.sim';
import {
  LAYER_ZERO_EXECUTE_ABI,
  LAYER_ZERO_LANE_SUPPORT_MATRIX,
  LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
  UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
  extractLayerZeroL1L2JobsFromProposal,
} from '../utils/bridges/layerzero';
import { MEGAETH_CHAIN_ID } from '../utils/chains/megaeth';

const SET_WORMHOLE_SENDER_ABI = parseAbi(['function setWormholeSender(address sender)']);

function buildLayerZeroExecuteCalldata(remoteChainId: number, payload: Hex): Hex {
  return encodeFunctionData({
    abi: LAYER_ZERO_EXECUTE_ABI,
    functionName: 'execute',
    args: [remoteChainId, payload, '0x'],
  });
}

function buildLayerZeroTrustedRemoteCalldata(remoteChainId: number, remoteAddress: Hex): Hex {
  return encodeFunctionData({
    abi: LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
    functionName: 'setTrustedRemoteAddress',
    args: [remoteChainId, remoteAddress],
  });
}

function buildExecutorPayload(
  calls: Array<{ target: `0x${string}`; value?: bigint; calldata: Hex }>,
): Hex {
  return encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }],
    [
      calls.map((call) => call.target),
      calls.map((call) => call.value ?? 0n),
      calls.map((call) => call.calldata),
    ],
  );
}

describe('LayerZero proposal parser', () => {
  test('extracts Avalanche destination calls from OmnichainProposalSender execute calldata', () => {
    const target = getAddress('0x00000000000000000000000000000000000000a1');
    const calldata = encodeFunctionData({
      abi: SET_WORMHOLE_SENDER_ABI,
      functionName: 'setWormholeSender',
      args: [getAddress('0x00000000000000000000000000000000000000b1')],
    });
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.layerZeroRemoteChainId,
      buildExecutorPayload([{ target, calldata }]),
    );

    const jobs = extractLayerZeroL1L2JobsFromProposal(
      [UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
      [executeCalldata],
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.bridgeType).toBe('LayerZeroL1L2');
    expect(jobs[0]?.destinationChainId).toBe(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.destinationChainId,
    );
    expect(jobs[0]?.l2FromAddress).toBe(UNISWAP_OMNICHAIN_GOVERNANCE_EXECUTOR);
    expect(jobs[0]?.sourceOrder).toBe(0);
    expect(jobs[0]?.calls).toEqual([
      {
        l2TargetAddress: target,
        l2InputData: calldata,
        l2Value: '0',
      },
    ]);
  });

  test('extracts MegaETH destination calls after trusted remote setup', () => {
    const firstTarget = getAddress('0x00000000000000000000000000000000000000c1');
    const secondTarget = getAddress('0x00000000000000000000000000000000000000c2');
    const firstCalldata = encodeFunctionData({
      abi: SET_WORMHOLE_SENDER_ABI,
      functionName: 'setWormholeSender',
      args: [getAddress('0x00000000000000000000000000000000000000d1')],
    });
    const secondCalldata = encodeFunctionData({
      abi: SET_WORMHOLE_SENDER_ABI,
      functionName: 'setWormholeSender',
      args: [getAddress('0x00000000000000000000000000000000000000d2')],
    });
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.layerZeroRemoteChainId,
      buildExecutorPayload([
        { target: firstTarget, calldata: firstCalldata },
        { target: secondTarget, calldata: secondCalldata },
      ]),
    );
    const setupCalldata = buildLayerZeroTrustedRemoteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.layerZeroRemoteChainId,
      UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
    );

    const jobs = extractLayerZeroL1L2JobsFromProposal(
      [UNISWAP_OMNICHAIN_PROPOSAL_SENDER, UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
      [setupCalldata, executeCalldata],
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.destinationChainId).toBe(MEGAETH_CHAIN_ID);
    expect(jobs[0]?.l2FromAddress).toBe(UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR);
    expect(jobs[0]?.sourceOrder).toBe(1);
    expect(jobs[0]?.calls).toEqual([
      {
        l2TargetAddress: firstTarget,
        l2InputData: firstCalldata,
        l2Value: '0',
      },
      {
        l2TargetAddress: secondTarget,
        l2InputData: secondCalldata,
        l2Value: '0',
      },
    ]);
  });

  test('extracts the supplied Uniswap migration draft calldata shape', () => {
    const jobs = extractLayerZeroL1L2JobsFromProposal(
      migrationDraftConfig.targets,
      migrationDraftConfig.calldatas,
    );

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.destinationChainId)).toEqual([
      LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.destinationChainId,
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.destinationChainId,
    ]);
    expect(jobs.map((job) => job.sourceOrder)).toEqual([1, 2]);
    expect(jobs.map((job) => job.calls.map((call) => call.l2InputData.slice(0, 10)))).toEqual([
      ['0xa2e74af6', '0x13af4035', '0xf2fde38b'],
      ['0xa2e74af6', '0x13af4035', '0xf2fde38b'],
    ]);
  });

  test('requires MegaETH trusted remote setup before execute', () => {
    const payload = buildExecutorPayload([
      {
        target: getAddress('0x00000000000000000000000000000000000000c1'),
        calldata: '0x12345678',
      },
    ]);
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth.layerZeroRemoteChainId,
      payload,
    );

    expect(() =>
      extractLayerZeroL1L2JobsFromProposal([UNISWAP_OMNICHAIN_PROPOSAL_SENDER], [executeCalldata]),
    ).toThrow('requires setTrustedRemoteAddress before execute');
  });

  test('supports GovernorBravo-style payloads with signatures plus argument bytes', () => {
    const target = getAddress('0x00000000000000000000000000000000000000e1');
    const owner = getAddress('0x00000000000000000000000000000000000000f1');
    const argumentBytes = encodeAbiParameters([{ type: 'address' }], [owner]);
    const payload = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'string[]' }, { type: 'bytes[]' }],
      [[target], [12n], ['setOwner(address)'], [argumentBytes]],
    );
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.layerZeroRemoteChainId,
      payload,
    );

    const jobs = extractLayerZeroL1L2JobsFromProposal(
      [UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
      [executeCalldata],
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.calls[0]?.l2TargetAddress).toBe(target);
    expect(jobs[0]?.calls[0]?.l2Value).toBe('12');
    expect(jobs[0]?.calls[0]?.l2InputData).toBe(
      `${toFunctionSelector('function setOwner(address)')}${argumentBytes.slice(2)}`,
    );
  });

  test('ignores execute calldata sent to unknown proposal targets', () => {
    const payload = buildExecutorPayload([
      {
        target: getAddress('0x00000000000000000000000000000000000000a1'),
        calldata: '0x12345678',
      },
    ]);
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.layerZeroRemoteChainId,
      payload,
    );

    const jobs = extractLayerZeroL1L2JobsFromProposal(
      [getAddress('0x0000000000000000000000000000000000000001')],
      [executeCalldata],
    );

    expect(jobs).toHaveLength(0);
  });

  test('surfaces unsupported remote chain ids as errors', () => {
    const payload = buildExecutorPayload([
      {
        target: getAddress('0x00000000000000000000000000000000000000a1'),
        calldata: '0x12345678',
      },
    ]);
    const executeCalldata = buildLayerZeroExecuteCalldata(999, payload);

    expect(() =>
      extractLayerZeroL1L2JobsFromProposal([UNISWAP_OMNICHAIN_PROPOSAL_SENDER], [executeCalldata]),
    ).toThrow('Unsupported LayerZero remote chain id 999');
  });

  test('surfaces malformed executor payloads as errors', () => {
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.layerZeroRemoteChainId,
      '0x1234',
    );

    expect(() =>
      extractLayerZeroL1L2JobsFromProposal([UNISWAP_OMNICHAIN_PROPOSAL_SENDER], [executeCalldata]),
    ).toThrow('Could not decode LayerZero executor payload');
  });

  test('surfaces empty executor payloads as errors', () => {
    const executeCalldata = buildLayerZeroExecuteCalldata(
      LAYER_ZERO_LANE_SUPPORT_MATRIX.avalanche.layerZeroRemoteChainId,
      buildExecutorPayload([]),
    );

    expect(() =>
      extractLayerZeroL1L2JobsFromProposal([UNISWAP_OMNICHAIN_PROPOSAL_SENDER], [executeCalldata]),
    ).toThrow('has no destination calls');
  });
});
