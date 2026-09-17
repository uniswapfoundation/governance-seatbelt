import { expect, test } from 'bun:test';
import { decodeFunctionData, getAddress } from 'viem';
import { config } from '../sims/arc-bridge-test.sim';
import {
  WORMHOLE_SEND_MESSAGE_ABI,
  extractWormholeExecutionJobsFromProposal,
} from '../utils/bridges/wormhole';

test('Arc spike addresses the receiver and executes all three supplied governance targets', () => {
  const receiver = getAddress('0xbCA30b5429935205037069cF5b8A165F55d05a75');
  const decoded = decodeFunctionData({ abi: WORMHOLE_SEND_MESSAGE_ABI, data: config.calldatas[0] });
  expect(decoded.args[3]).toBe(receiver);
  expect(decoded.args[4]).toBe(71);
  const [job] = extractWormholeExecutionJobsFromProposal(config.targets, config.calldatas);
  expect(job.destinationChainId).toBe(5042);
  expect(job.l2FromAddress).toBe(receiver);
  expect(job.calls.map((call) => call.l2TargetAddress)).toEqual([
    getAddress('0x89e5DB8B5aA49aA85AC63f691524311AEB649eba'),
    getAddress('0xf0db7b58379503491d857dB50AC9ece64c653918'),
    getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'),
  ]);
});
