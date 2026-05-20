import { describe, expect, test } from 'bun:test';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress } from 'viem';
import {
  POLYGON_FX_CHILD,
  POLYGON_FX_PROCESS_MESSAGE_ABI,
  POLYGON_FX_ROOT,
  POLYGON_FX_SEND_MESSAGE_ABI,
  extractPolygonFxL1L2JobsFromProposal,
} from '../utils/bridges/polygon-fx';

describe('polygon fx proposal parser', () => {
  const timelock = getAddress('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
  const ethereumProxy = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');
  const v3Factory = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');

  test('wraps FxRoot sendMessageToChild calldata as a Polygon processMessageFromRoot call', () => {
    const childMessage = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'bytes[]' }, { type: 'uint256[]' }],
      [
        [v3Factory],
        ['0x13af40350000000000000000000000001111111111111111111111111111111111111111'],
        [0n],
      ],
    );
    const calldata = encodeFunctionData({
      abi: POLYGON_FX_SEND_MESSAGE_ABI,
      functionName: 'sendMessageToChild',
      args: [ethereumProxy, childMessage],
    });

    const jobs = extractPolygonFxL1L2JobsFromProposal([POLYGON_FX_ROOT], [calldata], timelock);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.bridgeType).toBe('PolygonFxL1L2');
    expect(jobs[0]?.destinationChainId).toBe(137);
    expect(jobs[0]?.l2FromAddress).toBe(POLYGON_FX_CHILD);
    expect(jobs[0]?.sourceOrder).toBe(0);

    const [call] = jobs[0]?.calls ?? [];
    expect(call?.l2TargetAddress).toBe(ethereumProxy);
    expect(call?.l2Value).toBe('0');

    const decoded = decodeFunctionData({
      abi: POLYGON_FX_PROCESS_MESSAGE_ABI,
      data: call?.l2InputData ?? '0x',
    });
    expect(decoded.functionName).toBe('processMessageFromRoot');
    expect(decoded.args).toEqual([1n, timelock, childMessage]);
  });

  test('ignores non-FxRoot proposal targets', () => {
    const calldata = encodeFunctionData({
      abi: POLYGON_FX_SEND_MESSAGE_ABI,
      functionName: 'sendMessageToChild',
      args: [ethereumProxy, '0x1234'],
    });

    const jobs = extractPolygonFxL1L2JobsFromProposal([v3Factory], [calldata], timelock);

    expect(jobs).toHaveLength(0);
  });
});
