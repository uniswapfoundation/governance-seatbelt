import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import solc from 'solc';
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { checkStateChanges } from '../checks/check-state-changes';
import { createMockSimulation } from '../checks/tests/test-utils';
import { generateAndSaveReports } from '../presentation/report';
import type { CallTrace, ProposalData, ProposalEvent } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { CHAIN_CONFIGS } from '../utils/clients/client';
import { setMockFetch, toFetchUrl } from './helpers/verification-test-helpers';

// Explorer HTTP and the Tenderly response are deterministic external fixtures.
// The compiler, trace binding, decoder, cache and report writer are real production entry points.
test('proxy mapping labels reach reports only for matching code, storage context, key and value', async () => {
  const content = `pragma solidity ^0.8.30;
    library Marker { function check(uint16 id) external pure returns (bool) { return id > 0; } }
    contract Peers {
      struct Peer { bytes32 peerAddress; uint8 tokenDecimals; uint64 limit; }
      bytes32 constant SLOT = bytes32(uint256(keccak256("seatbelt.peers")) - 1);
      uint256 public immutable seed;
      constructor(uint256 value) { seed = value; }
      function peersStorage() internal pure returns (mapping(uint16 => Peer) storage peers) {
        uint256 slot = uint256(SLOT);
        assembly { peers.slot := slot }
      }
      function setPeer(uint16 id, bytes32 peer, uint8 decimals, uint64 limit) external {
        require(Marker.check(id));
        peersStorage()[id].peerAddress = peer;
        peersStorage()[id].tokenDecimals = decimals;
        peersStorage()[id].limit = limit;
      }
    }`;
  const input = {
    language: 'Solidity',
    sources: { 'Peers.sol': { content } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode'] } },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input))).contracts['Peers.sol'].Peers;
  const library = `0x${'3'.repeat(40)}`;
  let object = compiled.evm.deployedBytecode.object;
  for (const { start, length } of compiled.evm.deployedBytecode.linkReferences['Peers.sol']
    .Marker) {
    object = object.slice(0, start * 2) + library.slice(2) + object.slice((start + length) * 2);
  }
  const bytes = Buffer.from(object, 'hex');
  for (const { start, length } of Object.values(
    compiled.evm.deployedBytecode.immutableReferences,
  ).flat() as { start: number; length: number }[]) {
    bytes.fill(0, start, start + length);
    bytes[start + length - 1] = 42;
  }
  const runtime = toHex(bytes);
  const slot = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'uint16' }, { type: 'uint256' }],
        [71, BigInt(keccak256(toHex('seatbelt.peers'))) - 1n],
      ),
    ),
  );
  const peer = `0x${'4'.repeat(64)}` as const;
  const data = encodeFunctionData({
    abi: compiled.abi,
    functionName: 'setPeer',
    args: [71, peer, 18, 7n],
  });
  const config = CHAIN_CONFIGS[5042];
  const previous = config.verification;
  config.verification = { ...previous!, apiKey: 'test-key' };
  let badSource = false;
  const restore = setMockFetch(async (request) => {
    const url = toFetchUrl(request);
    if (url.hostname !== 'api.etherscan.io') return new Response(null, { status: 404 });
    return Response.json({
      status: '1',
      result: [
        {
          SourceCode: `{${JSON.stringify({ ...input, sources: { 'Peers.sol': { content: content + (badSource ? '\n// metadata mismatch' : '') } }, settings: { ...input.settings, libraries: { 'Peers.sol': { Marker: library } } } })}}`,
          CompilerVersion: solc.version().split('.Emscripten')[0],
          ContractName: 'Peers',
          ContractFileName: 'Peers.sol',
        },
      ],
    });
  });
  const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-mapping-integration-'));
  const cacheFiles: string[] = [];
  try {
    for (const [index, scenario] of [
      'valid',
      'bad source',
      'wrong key',
      'wrong value',
      'failed call',
      'foreign storage',
      'ambiguous implementation',
      'unknown bits',
      'missing code',
      'nested delegate',
    ].entries()) {
      badSource = scenario === 'bad source';
      const proxy = getAddress(toHex(BigInt(9800 + index), { size: 20 }));
      const implementation = getAddress(
        toHex(BigInt(scenario === 'bad source' ? 9901 : 9900), { size: 20 }),
      );
      const delegate: CallTrace = {
        from: proxy,
        to: implementation,
        input: data,
        call_type: 'DELEGATECALL',
      };
      if (scenario === 'wrong key')
        delegate.input = encodeFunctionData({
          abi: compiled.abi,
          functionName: 'setPeer',
          args: [72, peer, 18, 7n],
        });
      if (scenario === 'failed call') delegate.error_reason = 'reverted';
      if (scenario === 'foreign storage') delegate.call_type = 'CALL';
      const calls = [delegate];
      if (scenario === 'ambiguous implementation') calls.push({ ...delegate, to: library });
      if (scenario === 'nested delegate')
        calls[0] = { ...delegate, to: library, calls: [delegate] };
      const sim = createMockSimulation([{ from: zeroAddress, to: proxy, input: data, calls }]);
      sim.contracts = [
        {
          address: implementation,
          contract_name: 'Peers',
          ...(scenario === 'missing code' ? {} : { deployed_bytecode: runtime }),
        } as (typeof sim.contracts)[number],
      ];
      sim.transaction.transaction_info.state_diff = [
        {
          soltype: null,
          original: zeroHash,
          dirty: zeroHash,
          raw: [
            {
              address: proxy,
              key: toHex(slot, { size: 32 }),
              original: zeroHash,
              dirty: scenario === 'wrong value' ? toHex(1n, { size: 32 }) : peer,
            },
            {
              address: proxy,
              key: toHex(slot + 1n, { size: 32 }),
              original: zeroHash,
              dirty: toHex(18n + (7n << 8n) + (scenario === 'unknown bits' ? 1n << 248n : 0n), {
                size: 32,
              }),
            },
          ],
        },
      ];
      const cache = join(
        process.cwd(),
        'cache/storage-layouts',
        `5042-${implementation}-${keccak256(runtime)}.json`,
      );
      cacheFiles.push(cache);
      if (index < 2) rmSync(cache, { force: true });
      const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, {
        chainConfig: config,
        governor: { address: zeroAddress },
        timelock: { address: zeroAddress },
      } as ProposalData);
      const labels = result.storageChanges?.map((change) => change.label) ?? [];
      expect(labels).toEqual(
        scenario === 'valid' || scenario === 'nested delegate'
          ? ['peers[71].peerAddress', 'peers[71].tokenDecimals', 'peers[71].limit']
          : scenario === 'wrong value'
            ? ['peers[71].tokenDecimals', 'peers[71].limit']
            : scenario === 'unknown bits'
              ? ['peers[71].peerAddress']
              : [],
      );
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks: {
          current: { number: 100n, timestamp: 1000n },
          start: { number: 100n, timestamp: 1000n },
          end: null,
        },
        proposal: {
          id: BigInt(index + 1),
          proposer: zeroAddress,
          startBlock: 100n,
          endBlock: 200n,
          description: '# Mapping integration',
          targets: [proxy],
          values: [0n],
          signatures: [''],
          calldatas: [data],
        } as ProposalEvent,
        checks: { checkStateChanges: { name: checkStateChanges.name, result } },
        governorAddress: zeroAddress,
        chainId: 5042,
        outputDir,
      });
      const report = JSON.parse(readFileSync(join(outputDir, `${index + 1}.json`), 'utf8'));
      expect(report.chainReports[0].stateChanges).toEqual(report.stateChanges);
      expect(
        report.stateChanges
          .filter((change: { label?: string }) => change.label)
          .map((change: { label: string }) => change.label),
      ).toEqual(labels);
      if (scenario === 'valid') {
        expect(report.stateChanges[1]).toMatchObject({
          oldValue: '0',
          newValue: '18',
          storageDetails: { oldValue: zeroHash, source: 'Etherscan' },
        });
      }
    }
  } finally {
    for (const path of cacheFiles) rmSync(path, { force: true });
    restore();
    config.verification = previous;
    BlockExplorerFactory.clear();
    rmSync(outputDir, { recursive: true, force: true });
  }
}, 120000);
