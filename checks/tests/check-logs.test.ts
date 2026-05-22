import { describe, expect, test } from 'bun:test';
import { encodeEventTopics, getAddress, parseAbi } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { CacheManager } from '../../utils/clients/block-explorers/cache';
import { checkLogs } from '../check-logs';
import { createMockSimulation } from './test-utils';

type SimulationLog = NonNullable<
  TenderlySimulation['transaction']['transaction_info']['logs']
>[number];

const OWNER_CHANGED_ABI = parseAbi([
  'event OwnerChanged(address indexed oldOwner, address indexed newOwner)',
]);
const MYSTERY_EVENT_ABI = parseAbi(['event MysteryEvent(address indexed account)']);

function topicStrings(topics: ReturnType<typeof encodeEventTopics>): string[] {
  const strings: string[] = [];
  for (const topic of topics) {
    if (typeof topic !== 'string') throw new Error('Expected a concrete event topic');
    strings.push(topic);
  }
  return strings;
}

function createProposalEvent(): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: '0x0000000000000000000000000000000000000001',
    startBlock: 1n,
    endBlock: 2n,
    description: 'test proposal',
    targets: [],
    values: [],
    signatures: [],
    calldatas: [],
  };
}

function createDeps(chainId: number): ProposalData {
  return {
    governor: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    timelock: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    publicClient: null,
    chainConfig: {
      chainId,
      blockExplorer: { baseUrl: 'https://example.invalid' },
      rpcUrl: 'https://example.invalid',
    },
    targets: [],
    touchedContracts: [],
  };
}

function createSimulationLog({
  address,
  topics,
  data = '0x',
  name = '',
}: {
  address: string;
  topics: string[];
  data?: string;
  name?: string | null;
}): SimulationLog {
  return {
    name,
    anonymous: false,
    inputs: [],
    raw: { address, topics, data },
  };
}

describe('checkLogs', () => {
  test('decodes raw event logs when an ABI is available', async () => {
    const v3Factory = getAddress('0xAfE208a311B21f13EF87E33A90049fC17A7acDEc');
    const oldOwner = getAddress('0x0Eb863541278308c3A64F8E908BC646e27BFD071');
    const newOwner = getAddress('0xB9952C01830306ea2fAAe1505f6539BD260Bfc48');

    CacheManager.clearMemory();
    CacheManager.setAbiInMemory(1, v3Factory, OWNER_CHANGED_ABI);
    CacheManager.setContractNameInMemory(1, v3Factory, 'UniswapV3Factory');

    const sim = createMockSimulation([]);
    sim.transaction.transaction_info.logs = [
      createSimulationLog({
        address: v3Factory,
        topics: topicStrings(
          encodeEventTopics({
            abi: OWNER_CHANGED_ABI,
            eventName: 'OwnerChanged',
            args: { oldOwner, newOwner },
          }),
        ),
      }),
    ];

    const result = await checkLogs.checkProposal(createProposalEvent(), sim, createDeps(1));
    const info = result.info.join('\n');

    expect(result.errors).toHaveLength(0);
    expect(info).toContain('UniswapV3Factory at `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc`');
    expect(info).toContain(
      '`OwnerChanged(oldOwner: 0x0Eb863541278308c3A64F8E908BC646e27BFD071, newOwner: 0xB9952C01830306ea2fAAe1505f6539BD260Bfc48)`',
    );
    expect(info).not.toContain('RawLog');
  });

  test('keeps unknown raw logs visible as event rows', async () => {
    const emitter = getAddress('0x1111111111111111111111111111111111111111');
    const indexedValue = getAddress('0x2222222222222222222222222222222222222222');

    const sim = createMockSimulation([]);
    sim.transaction.transaction_info.logs = [
      createSimulationLog({
        address: emitter,
        topics: topicStrings(
          encodeEventTopics({
            abi: MYSTERY_EVENT_ABI,
            eventName: 'MysteryEvent',
            args: { account: indexedValue },
          }),
        ),
        data: '0x1234',
      }),
    ];

    const result = await checkLogs.checkProposal(createProposalEvent(), sim, createDeps(0));
    const info = result.info.join('\n');

    expect(result.errors).toHaveLength(0);
    expect(info).toContain('Unknown Contract at `0x1111111111111111111111111111111111111111`');
    expect(info).toContain('`RawLog(topic0:');
    expect(info).toContain(
      'topic1: 0x0000000000000000000000002222222222222222222222222222222222222222',
    );
    expect(info).toContain('data: 0x1234)`');
    expect(info).not.toContain('Undecoded log');
  });
});
