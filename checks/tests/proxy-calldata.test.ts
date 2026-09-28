import { beforeEach, describe, expect, test } from 'bun:test';
import {
  type Address,
  createPublicClient,
  custom,
  encodeFunctionData,
  padHex,
  parseAbi,
  toHex,
  zeroHash,
} from 'viem';
import type { DecodedCall, ProposalData, ProposalEvent } from '../../types';
import { CacheManager } from '../../utils/clients/block-explorers/cache';
import { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT } from '../../utils/contracts/proxy';
import { checkDecodeCalldata } from '../check-decode-calldata';
import { checkLogs } from '../check-logs';
import { createMockSimulation } from './test-utils';

const TIMELOCK = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
const BEACON = '0x1111111111111111111111111111111111111111';
const BLOCK = 26055251;

// Exact inputs from report 72ec885c-d5ad-4061-aad4-3502a594ad7c; ABI fragments
// checked against Sourcify's verified Ethereum implementations below.
const actions = [
  {
    target: '0x7597C40Fd3df66b750C14ad4D90524e247499011',
    implementation: '0x71feCca3C135302c40869F43CE9BDE9E76950AFD',
    calldata:
      '0x7ab5640300000000000000000000000000000000000000000000000000000000000000470000000000000000000000000b359a34f94c9371d43560448d6765d508771ffc',
    abi: parseAbi(['function setWormholePeer(uint16 peerChainId, bytes32 peerContract) payable']),
    expected:
      'setWormholePeer(71, 0x0000000000000000000000000b359a34f94c9371d43560448d6765d508771ffc)',
  },
  {
    target: '0x6569925Aac77D6B8Bb085F31F9828ff80D5a0c44',
    implementation: '0x3232dc4F7b7bA1a5518A4a44c84FdCDe0e4eD89f',
    calldata:
      '0x7c9186340000000000000000000000000000000000000000000000000000000000000047000000000000000000000000c8271548cc9c2f9be3e926b99a588e211b1a041700000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000',
    abi: parseAbi([
      'function setPeer(uint16 peerChainId, bytes32 peerContract, uint8 decimals, uint256 inboundLimit)',
    ]),
    expected:
      'setPeer(71, 0x000000000000000000000000c8271548cc9c2f9be3e926b99a588e211b1a0417, 18, 0)',
  },
] as const;

function callFor(action: (typeof actions)[number]): DecodedCall {
  return { from: TIMELOCK, to: action.target, input: action.calldata, value: '0' };
}

function proposalFor(calls: DecodedCall[]): ProposalEvent {
  return {
    id: 101n,
    proposalId: 101n,
    proposer: TIMELOCK,
    startBlock: 0n,
    endBlock: 0n,
    description: '',
    targets: calls.map((call) => call.to),
    calldatas: calls.map((call) => call.input),
    signatures: calls.map(() => ''),
    values: calls.map(() => 0n),
  };
}

async function decode(calls: DecodedCall[], deps: ProposalData, includeTrace = true) {
  const sim = createMockSimulation(includeTrace ? calls : []);
  sim.transaction.block_number = BLOCK;
  return checkDecodeCalldata.checkProposal(proposalFor(calls), sim, deps);
}

// Only the external RPC boundary is doubled: historical chain state must be
// deterministic. ABI lookup uses the real cache and explorer decoder.
function buildDeps(mode: 'slot' | 'beacon' | 'none' | 'unavailable', chainId = 1) {
  const requests: string[] = [];
  const publicClient = createPublicClient({
    transport: custom(
      {
        async request({ method, params }) {
          requests.push(method);
          if (mode === 'unavailable') throw new Error('Archive state unavailable');
          if (method === 'eth_getStorageAt') {
            const [address, slot, block] = params as string[];
            expect(block).toBe(toHex(BLOCK));
            if (mode === 'none') return zeroHash;
            if (slot === EIP1967_BEACON_SLOT) {
              return mode === 'beacon' ? padHex(BEACON, { size: 32 }) : zeroHash;
            }
            expect(slot).toBe(EIP1967_IMPLEMENTATION_SLOT);
            const action = actions.find((a) => a.target.toLowerCase() === address.toLowerCase());
            expect(action).toBeDefined();
            return padHex(action!.implementation, { size: 32 });
          }
          expect(method).toBe('eth_call');
          const [call, block] = params as [{ to: Address; data: string }, string];
          expect(mode).toBe('beacon');
          expect(block).toBe(toHex(BLOCK));
          expect(call.to).toBe(BEACON);
          expect(call.data).toBe('0x5c60da1b'); // implementation()
          return padHex(actions[0].implementation, { size: 32 });
        },
      },
      { retryCount: 0 },
    ),
  });
  const deps: ProposalData = {
    governor: null,
    timelock: { address: TIMELOCK },
    publicClient,
    chainConfig: {
      chainId,
      blockExplorer: { baseUrl: 'https://example.invalid' },
      rpcUrl: 'https://example.invalid',
    },
    targets: [],
    touchedContracts: [],
  };
  return { deps, requests };
}

beforeEach(() => {
  CacheManager.clearMemory();
  for (const chainId of [1, 10]) {
    for (const action of actions) {
      CacheManager.setAbiInMemory(chainId, action.target, []);
      CacheManager.setAbiInMemory(chainId, action.implementation, action.abi);
    }
  }
});

describe('proxy calldata', () => {
  test('decodes both report calls at the simulation block without a trace', async () => {
    const { deps } = buildDeps('slot');
    const result = await decode(actions.map(callFor), deps, false);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    for (const action of actions) {
      const line = result.info.find((info) => info.includes(action.expected));
      expect(line).toContain(`on \`${action.target}\``);
      expect(line).toContain(`implementation ABI at \`${action.implementation}\``);
    }
  });

  test.each([1, 10])('decodes beacon proxy calls on chain %i', async (chainId) => {
    const { deps, requests } = buildDeps('beacon', chainId);
    const result = await decode([callFor(actions[0])], deps);
    expect(result.warnings).toEqual([]);
    expect(result.info.join('\n')).toContain(actions[0].expected);
    expect(result.info.join('\n')).toContain(`on \`${actions[0].target}\``);
    expect(requests).toContain('eth_call');
  });

  test('uses each actual delegatecall after an upgrade, without reusing a prior decode', async () => {
    const { deps, requests } = buildDeps('unavailable');
    const calls = actions.map((action) => ({
      ...callFor(actions[0]), // identical calldata and proxy, different implementations
      calls: [
        {
          from: actions[0].target,
          to: BEACON,
          input: '0x5c60da1b',
          value: '0',
          type: 'STATICCALL',
        },
        { ...callFor(actions[0]), to: action.implementation, call_type: 'DELEGATECALL' },
      ],
    }));
    const result = await decode(calls, deps);
    expect(result.info[0]).toContain(actions[0].expected);
    // The new implementation has no matching function. Do not reuse the first decode
    // or the pre-upgrade implementation in storage.
    expect(result.info[1]).toContain('(not decoded)');
    expect(result.warnings).toHaveLength(1);
    expect(requests).toEqual([]);
  });

  test('does not treat an ordinary child call as a proxy implementation', async () => {
    const { deps } = buildDeps('none');
    const call = callFor(actions[0]);
    call.calls = [{ ...call, from: call.to, to: actions[0].implementation, type: 'CALL' }];
    const result = await decode([call], deps);
    expect(result.info.join('\n')).toContain('(not decoded)');
    expect(result.warnings).toHaveLength(1);
  });

  test('preserves target ABI decoding and signature fallbacks when RPC is unavailable', async () => {
    const { deps, requests } = buildDeps('unavailable');
    CacheManager.setAbiInMemory(1, actions[0].target, actions[0].abi);
    const direct = await decode([callFor(actions[0])], deps);
    expect(direct.warnings).toEqual([]);
    expect(direct.info[0]).toContain('(decoded from ABI)');
    expect(requests).toEqual([]);

    const fallback = await decode(
      [
        {
          ...callFor(actions[1]),
          input: encodeFunctionData({
            abi: parseAbi(['function setOwner(address owner)']),
            functionName: 'setOwner',
            args: [BEACON],
          }),
        },
      ],
      deps,
    );
    expect(fallback.warnings).toEqual([]);
    expect(fallback.info[0]).toContain(`setOwner(${BEACON})`);
  });
});

// Exact raw event from Arc proposal 102; exercises the real event check and ABI decoder.
describe('proxy event decoding', () => {
  test.each(['slot', 'beacon', 'unavailable'] as const)(
    'handles the Arc event with %s state',
    async (mode) => {
      const { deps } = buildDeps(mode);
      deps.governor = { address: BEACON };
      CacheManager.setContractNameInMemory(1, actions[0].target, 'ERC1967Proxy');
      CacheManager.setAbiInMemory(
        1,
        actions[0].implementation,
        parseAbi(['event SetWormholePeer(uint16 chainId, bytes32 peerContract)']),
      );
      const sim = createMockSimulation([]);
      sim.transaction.block_number = BLOCK;
      sim.transaction.transaction_info.logs = [
        {
          name: '',
          anonymous: false,
          inputs: [],
          raw: {
            address: actions[0].target,
            topics: ['0xa559263ee060c7a2560843b3a064ff0376c9753ae3e2449b595a3b615d326466'],
            data: '0x00000000000000000000000000000000000000000000000000000000000000470000000000000000000000000b359a34f94c9371d43560448d6765d508771ffc',
          },
        },
      ];
      const result = await checkLogs.checkProposal(proposalFor([]), sim, deps);
      expect(result.errors).toEqual([]);
      expect(result.info[0]).toContain(actions[0].target);
      if (mode === 'unavailable') {
        expect(result.info[1]).toContain('RawLog(topic0: 0xa559263');
      } else {
        expect(result.info[1]).toContain(
          'SetWormholePeer(chainId: 71, peerContract: 0x0000000000000000000000000b359a34f94c9371d43560448d6765d508771ffc)',
        );
      }
    },
  );
});
