import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress } from 'viem';
import {
  SUPPORTED_WORMHOLE_CHAIN_IDS,
  WORMHOLE_SEND_MESSAGE_ABI,
  type WormholeLaneCapabilities,
  assertValidWormholeLaneCapabilities,
  extractWormholeExecutionJobsFromProposal,
  getWormholeLaneCapabilities,
} from '../utils/bridges/wormhole';
import {
  SUPPORTED_WORMHOLE_LANE_KEYS,
  getWormholeLaneByKey,
} from '../utils/bridges/wormhole-support';

describe('wormhole proposal parser', () => {
  const supportedLanes = SUPPORTED_WORMHOLE_LANE_KEYS.map((laneKey) => {
    const lane = getWormholeLaneByKey(laneKey);
    return {
      chainName: lane.chainName,
      wormholeChainId: lane.wormholeChainId,
      destinationChainId: lane.destinationChainId,
      expectedSender: lane.l2FromAddress,
      target: lane.validationTargets.v3Factory ?? lane.validationTargets.v2Factory,
    };
  });

  test('extracts celo destination calls from wormhole sendMessage calldata', () => {
    const celoLane = getWormholeLaneByKey('celo');
    const celoTargets = [
      getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc'),
      getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f'),
      getAddress('0x288dc841A52FCA2707c6947B3A777c5E56cd87BC'),
    ];

    const celoCalldatas = [
      '0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
      '0xa2e74af6000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
      '0xf2fde38b000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
    ] as const;

    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        celoTargets,
        [0n, 0n, 0n],
        [...celoCalldatas],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.destinationChainId).toBe(celoLane.destinationChainId);
    expect(jobs[0]?.bridgeType).toBe('WormholeL1L2');
    expect(jobs[0]?.wormholeChainId).toBe(14);
    expect(jobs[0]?.l2FromAddress).toBe(getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071'));
    expect(jobs[0]?.sourceOrder).toBe(0);
    expect(jobs[0]?.calls.map((call) => call.l2TargetAddress)).toEqual(celoTargets);
    expect(jobs[0]?.calls.map((call) => call.l2InputData)).toEqual([...celoCalldatas]);
    expect(jobs[0]?.calls.map((call) => call.l2Value)).toEqual(['0', '0', '0']);
  });

  test.each(supportedLanes)(
    'maps $chainName wormhole chain id to the expected destination authority',
    ({ wormholeChainId, destinationChainId, expectedSender, target }) => {
      const calldata = encodeFunctionData({
        abi: WORMHOLE_SEND_MESSAGE_ABI,
        functionName: 'sendMessage',
        args: [
          [target],
          [0n],
          ['0x13af40350000000000000000000000001111111111111111111111111111111111111111'],
          getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
          wormholeChainId,
        ],
      });

      const jobs = extractWormholeExecutionJobsFromProposal(
        [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
        [calldata],
      );

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.destinationChainId).toBe(destinationChainId);
      expect(jobs[0]?.wormholeChainId).toBe(wormholeChainId);
      expect(jobs[0]?.l2FromAddress).toBe(expectedSender);
      expect(jobs[0]?.calls).toHaveLength(1);
    },
  );

  test('does not parse wormhole messages when proposal target is not known wormhole sender', () => {
    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0x1111111111111111111111111111111111111111')],
      [calldata],
    );

    expect(jobs).toHaveLength(0);
  });

  test('surfaces unsupported wormhole chain ids as errors', () => {
    const unsupportedCalldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        999,
      ],
    });
    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc')],
        [0n],
        ['0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7'],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    expect(() =>
      extractWormholeExecutionJobsFromProposal(
        [
          getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a'),
          getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a'),
        ],
        [unsupportedCalldata, calldata],
      ),
    ).toThrow('Unsupported Wormhole chain id 999 in proposal calldata index 0');
  });

  test('does not parse wormhole messages when sendMessage array lengths are inconsistent', () => {
    const targetA = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
    const targetB = getAddress('0x79a530c8e2fA8748B7B40dd3629C0520c2cCf03f');

    const calldata = encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [
        [targetA, targetB],
        [0n],
        [
          '0x13af4035000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
          '0xa2e74af6000000000000000000000000044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
        ],
        getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
        14,
      ],
    });

    const jobs = extractWormholeExecutionJobsFromProposal(
      [getAddress('0xf5F4496219F31CDCBa6130B5402873624585615a')],
      [calldata],
    );

    expect(jobs).toHaveLength(0);
  });

  test('reports the expected wormhole lane capabilities', () => {
    expect([...SUPPORTED_WORMHOLE_CHAIN_IDS]).toEqual([4, 5, 6, 14, 48, 68, 71]);

    expect(getWormholeLaneCapabilities(4)).toEqual({
      kind: 'legacy',
      receiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
      payloadVersion: '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
      nextSequenceStorageSlot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
    expect(getWormholeLaneCapabilities(14)).toEqual({
      kind: 'modern',
      receiverCoreAddress: getAddress('0xa321448d90d4e5b0A732867c18eA198e75CAC48E'),
    });
    expect(getWormholeLaneCapabilities(48)).toEqual({
      kind: 'modern',
      receiverCoreAddress: getAddress('0x194B123c5E96B9B2e49763619985790Dc241CAC0'),
    });
    expect(getWormholeLaneCapabilities(68)).toEqual({
      kind: 'modern',
      receiverCoreAddress: getAddress('0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6'),
    });
    expect(getWormholeLaneCapabilities(5)).toEqual({
      kind: 'direct',
      receiverCoreAddress: null,
    });
    expect(getWormholeLaneCapabilities(6)).toEqual({
      kind: 'direct',
      receiverCoreAddress: null,
    });
    expect(() => getWormholeLaneCapabilities(999)).toThrow('Unsupported Wormhole chain id 999');
    expect(getWormholeLaneCapabilities(undefined)).toEqual({
      kind: 'direct',
      receiverCoreAddress: null,
    });
  });

  test('rejects malformed legacy wormhole lane capabilities before execution', () => {
    // @ts-expect-error Intentional malformed config for runtime validation.
    const malformedDirect: WormholeLaneCapabilities = {
      kind: 'direct',
      receiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
    };
    expect(() => assertValidWormholeLaneCapabilities(5, malformedDirect)).toThrow(
      'inconsistent receiver config',
    );

    const malformedModern: WormholeLaneCapabilities = {
      kind: 'modern',
      // @ts-expect-error Intentional malformed config for runtime validation.
      receiverCoreAddress: '',
    };
    expect(() => assertValidWormholeLaneCapabilities(14, malformedModern)).toThrow(
      'invalid receiverCoreAddress',
    );

    const malformedLegacyReceiver: WormholeLaneCapabilities = {
      kind: 'legacy',
      // @ts-expect-error Intentional malformed config for runtime validation.
      receiverCoreAddress: '',
      payloadVersion: '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
      nextSequenceStorageSlot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    expect(() => assertValidWormholeLaneCapabilities(4, malformedLegacyReceiver)).toThrow(
      'invalid receiverCoreAddress',
    );

    const malformedLegacyMultiple: WormholeLaneCapabilities = {
      kind: 'legacy',
      // @ts-expect-error Intentional malformed config for runtime validation.
      receiverCoreAddress: undefined,
      // @ts-expect-error Intentional malformed config for runtime validation.
      payloadVersion: '0x1234',
      nextSequenceStorageSlot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    expect(() => assertValidWormholeLaneCapabilities(4, malformedLegacyMultiple)).toThrow(
      'invalid receiverCoreAddress',
    );

    const malformedPayloadVersion: WormholeLaneCapabilities = {
      kind: 'legacy',
      receiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
      // @ts-expect-error Intentional malformed config for runtime validation.
      payloadVersion: '0x1234',
      nextSequenceStorageSlot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    expect(() => assertValidWormholeLaneCapabilities(4, malformedPayloadVersion)).toThrow(
      'invalid payloadVersion',
    );

    const malformedSequenceSlot: WormholeLaneCapabilities = {
      kind: 'legacy',
      receiverCoreAddress: getAddress('0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'),
      payloadVersion: '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b',
      // @ts-expect-error Intentional malformed config for runtime validation.
      nextSequenceStorageSlot: '0x1234',
    };
    expect(() => assertValidWormholeLaneCapabilities(4, malformedSequenceSlot)).toThrow(
      'invalid nextSequenceStorageSlot',
    );
  });
});
