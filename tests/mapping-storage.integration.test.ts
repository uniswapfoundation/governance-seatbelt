import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import solc from 'solc';
import {
  http,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  keccak256,
  padHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { foundry } from 'viem/chains';
import { checkStateChanges } from '../checks/check-state-changes';
import { createMockSimulation } from '../checks/tests/test-utils';
import { generateAndSaveReports } from '../presentation/report';
import type { CallTrace, GenerateReportsParams, ProposalData, ProposalEvent } from '../types';
import { mergeAllCheckResults } from '../utils/check-results';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { CHAIN_CONFIGS } from '../utils/clients/client';
import { setMockFetch, toFetchUrl } from './helpers/verification-test-helpers';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// Execute the contracts locally to obtain code, nested calls and writes. Only explorer HTTP is
// doubled: local deployments cannot be verified on an external explorer. Negative cases mutate
// that captured input deliberately; they are not evidence of corresponding on-chain execution.
// The internal-frame case wraps executed calls in the JUMPDEST format captured from Tenderly;
// it adds no contract calls or writes.
test.each(['postlinked', 'prelinked'])(
  'executed %s proxy and library calls reach reports; inconsistent input stays raw',
  async (linking) => {
    const anvil = Bun.which('anvil');
    if (!anvil) throw new Error('Anvil is required for mapping integration verification');
    const port = await freePort();
    const node = Bun.spawn([anvil, '--silent', '--port', String(port), '--chain-id', '5042'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-mapping-integration-'));
    const cacheFiles = new Set<string>();
    const config = CHAIN_CONFIGS[5042];
    const previous = config.verification;
    let restore = () => {};
    try {
      const transport = http(`http://${'127.0.0.1'}:${port}`);
      const chain = { ...foundry, id: 5042 };
      const client = createPublicClient({ chain, transport });
      const wallet = createWalletClient({ chain, transport });
      for (let i = 0; i < 50; i++) {
        try {
          await client.getBlockNumber();
          break;
        } catch {
          await Bun.sleep(50);
        }
      }
      const [account] = await wallet.getAddresses();
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
        sources: {
          'Peers.sol': { content },
          'Proxy.sol': {
            content: `pragma solidity ^0.8.30;
        contract PeerProxy {
          address immutable implementation;
          constructor(address target) { implementation = target; }
          fallback() external {
            address target = implementation;
            assembly {
              calldatacopy(0, 0, calldatasize())
              let success := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
              returndatacopy(0, 0, returndatasize())
              if iszero(success) { revert(0, returndatasize()) }
              return(0, returndatasize())
            }
          }
        }`,
          },
        },
        settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
      };
      const contracts = JSON.parse(solc.compile(JSON.stringify(input))).contracts;
      const marker = contracts['Peers.sol'].Marker;
      const compiled = contracts['Peers.sol'].Peers;
      const proxyContract = contracts['Proxy.sol'].PeerProxy;
      const libraryReceipt = await client.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          account,
          abi: marker.abi,
          bytecode: `0x${marker.evm.bytecode.object}`,
        }),
      });
      const library = libraryReceipt.contractAddress!;
      const librarySettings = {
        'Peers.sol': {
          Marker: library,
          ...(linking === 'prelinked' ? { Unused: zeroAddress } : {}),
        },
      };
      const deploymentContract =
        linking === 'prelinked'
          ? JSON.parse(
              solc.compile(
                JSON.stringify({
                  ...input,
                  settings: { ...input.settings, libraries: librarySettings },
                }),
              ),
            ).contracts['Peers.sol'].Peers
          : compiled;
      let bytecode = deploymentContract.evm.bytecode.object;
      for (const { start, length } of deploymentContract.evm.bytecode.linkReferences['Peers.sol']
        ?.Marker ?? []) {
        bytecode =
          bytecode.slice(0, start * 2) + library.slice(2) + bytecode.slice((start + length) * 2);
      }
      const implementationReceipt = await client.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          account,
          abi: compiled.abi,
          bytecode: `0x${bytecode}`,
          args: [42n],
        }),
      });
      const implementation = implementationReceipt.contractAddress!;
      const proxyReceipt = await client.waitForTransactionReceipt({
        hash: await wallet.deployContract({
          account,
          abi: proxyContract.abi,
          bytecode: `0x${proxyContract.evm.bytecode.object}`,
          args: [implementation],
        }),
      });
      const proxy = proxyReceipt.contractAddress!;
      const peer = `0x${'4'.repeat(64)}` as Hex;
      const data = encodeFunctionData({
        abi: compiled.abi,
        functionName: 'setPeer',
        args: [71, peer, 18, 7n],
      });
      const hash = await wallet.sendTransaction({ account, to: proxy, data });
      const receipt = await client.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe('success');
      const trace = (await client.transport.request({
        method: 'debug_traceTransaction',
        params: [hash, { tracer: 'callTracer' }],
      })) as CallTrace;
      expect(trace.calls![0].type).toBe('DELEGATECALL');
      expect(trace.calls![0].calls![0]).toMatchObject({
        type: 'DELEGATECALL',
        to: library.toLowerCase(),
      });
      const diff = (await client.transport.request({
        method: 'debug_traceTransaction',
        params: [hash, { tracer: 'prestateTracer', tracerConfig: { diffMode: true } }],
      })) as {
        pre: Record<string, { storage?: Record<Hex, Hex> }>;
        post: Record<string, { storage?: Record<Hex, Hex> }>;
      };
      const raw = Object.entries(diff.post[proxy.toLowerCase()].storage!)
        .map(([key, dirty]) => ({
          address: proxy,
          key,
          original: padHex(diff.pre[proxy.toLowerCase()]?.storage?.[key as Hex] ?? zeroHash, {
            size: 32,
          }),
          dirty: padHex(dirty, { size: 32 }),
        }))
        .sort((a, b) => (BigInt(a.key) < BigInt(b.key) ? -1 : 1));
      expect(raw).toHaveLength(2);
      const runtime = await client.getCode({
        address: implementation,
        blockNumber: receipt.blockNumber,
      });
      const simulation = createMockSimulation([]);
      simulation.transaction.block_number = Number(receipt.blockNumber);
      simulation.transaction.transaction_info.call_trace = trace;
      simulation.contracts = [
        { address: proxy, contract_name: 'PeerProxy' },
        { address: implementation, contract_name: 'Peers', deployed_bytecode: runtime },
      ] as typeof simulation.contracts;
      simulation.transaction.transaction_info.state_diff = [
        { soltype: null, original: zeroHash, dirty: zeroHash, raw },
      ];
      config.verification = { ...previous!, apiKey: 'test-key' };
      let badSource = false;
      restore = setMockFetch(async (request) => {
        if (toFetchUrl(request).hostname !== 'api.etherscan.io')
          return new Response(null, { status: 404 });
        const explorerInput = {
          ...input,
          sources: {
            ...input.sources,
            'Peers.sol': { content: content + (badSource ? '\n// metadata mismatch' : '') },
          },
          settings: { ...input.settings, libraries: librarySettings },
        };
        return Response.json({
          status: '1',
          result: [
            {
              SourceCode: `{${JSON.stringify(explorerInput)}}`,
              CompilerVersion: solc.version().split('.Emscripten')[0],
              ContractName: 'Peers',
              ContractFileName: 'Peers.sol',
            },
          ],
        });
      });
      const allLabels = ['peers[71].peerAddress', 'peers[71].tokenDecimals', 'peers[71].limit'];
      const cases = [
        { name: 'executed calls', labels: allLabels },
        { name: 'internal function frames', labels: allLabels },
        { name: 'bad source', labels: [] },
        { name: 'wrong key', labels: [] },
        { name: 'wrong value', labels: allLabels.slice(1) },
        { name: 'failed call', labels: [] },
        { name: 'foreign storage', labels: [] },
        { name: 'ambiguous implementation', labels: [] },
        { name: 'unknown bits', labels: allLabels.slice(0, 1) },
        { name: 'missing code', labels: [] },
      ];
      // The prelinked case adds an unused configured library. It must not authorize an
      // additional implementation; the remaining rejection cases are covered once, postlinked.
      const scenarios =
        linking === 'prelinked'
          ? cases.filter((scenario) =>
              ['executed calls', 'ambiguous implementation'].includes(scenario.name),
            )
          : cases;
      for (const [index, scenario] of scenarios.entries()) {
        const sim = structuredClone(simulation);
        const setter = sim.transaction.transaction_info.call_trace.calls![0];
        const writes = sim.transaction.transaction_info.state_diff![0].raw;
        badSource = scenario.name === 'bad source';
        switch (scenario.name) {
          case 'internal function frames':
            sim.transaction.transaction_info.call_trace.calls = [
              {
                call_type: 'JUMPDEST',
                from: sim.transaction.transaction_info.call_trace.from,
                to: proxy,
                input: '0x',
                calls: [
                  {
                    call_type: 'JUMPDEST',
                    from: sim.transaction.transaction_info.call_trace.from,
                    to: proxy,
                    input: '0x',
                    calls: [setter],
                  },
                ],
              },
            ];
            setter.calls = [
              {
                call_type: 'JUMPDEST',
                from: setter.from,
                to: implementation,
                input: '0x',
                calls: setter.calls,
              },
            ];
            break;
          case 'bad source':
            setter.to = getAddress(toHex(9901n, { size: 20 }));
            sim.contracts[1].address = setter.to;
            break;
          case 'wrong key':
            setter.input = encodeFunctionData({
              abi: compiled.abi,
              functionName: 'setPeer',
              args: [72, peer, 18, 7n],
            });
            sim.transaction.transaction_info.call_trace.input = setter.input;
            break;
          case 'wrong value':
            writes[0].dirty = toHex(1n, { size: 32 });
            break;
          case 'failed call':
            setter.error_reason = 'reverted';
            break;
          case 'foreign storage':
            setter.type = 'CALL';
            break;
          case 'ambiguous implementation':
            sim.transaction.transaction_info.call_trace.calls!.push({
              ...setter,
              to: zeroAddress,
              calls: [],
            });
            break;
          case 'unknown bits':
            writes[1].dirty = toHex(BigInt(writes[1].dirty) | (1n << 248n), { size: 32 });
            break;
          case 'missing code':
            sim.contracts[1].deployed_bytecode = undefined;
            break;
        }
        const cache = join(
          process.cwd(),
          'cache/storage-layouts',
          `5042-${getAddress(sim.contracts[1].address)}-${keccak256(runtime!)}.json`,
        );
        if (!cacheFiles.has(cache)) rmSync(cache, { force: true });
        cacheFiles.add(cache);
        const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, {
          chainConfig: config,
          governor: { address: zeroAddress },
          timelock: { address: zeroAddress },
        } as ProposalData);
        expect(result.storageChanges?.map((change) => change.label) ?? []).toEqual(scenario.labels);
        const reportParams = {
          governorType: 'bravo',
          blocks: {
            current: { number: receipt.blockNumber, timestamp: 1000n },
            start: { number: receipt.blockNumber, timestamp: 1000n },
            end: null,
          },
          proposal: {
            id: BigInt(index + 1),
            proposer: account,
            startBlock: 1n,
            endBlock: receipt.blockNumber,
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
        } satisfies GenerateReportsParams;
        await generateAndSaveReports(reportParams);
        if (scenario.name === 'internal function frames') {
          const destinationChecks = mergeAllCheckResults(reportParams.checks, reportParams.checks);
          const destinationDir = join(outputDir, 'destination');
          await generateAndSaveReports({
            ...reportParams,
            chainId: 1,
            checks: {},
            destinationChecks: { 5042: destinationChecks },
            outputDir: destinationDir,
          });
          const destinationReport = JSON.parse(
            readFileSync(join(destinationDir, `${index + 1}.json`), 'utf8'),
          );
          expect(
            destinationReport.chainReports
              .find((chain: { chainId: number }) => chain.chainId === 5042)
              .stateChanges.map((change: { label: string }) => change.label),
          ).toEqual(allLabels);
        }
        const report = JSON.parse(readFileSync(join(outputDir, `${index + 1}.json`), 'utf8'));
        expect(report.chainReports[0].stateChanges).toEqual(report.stateChanges);
        expect(
          report.stateChanges
            .filter((change: { label?: string }) => change.label)
            .map((change: { label: string }) => change.label),
        ).toEqual(scenario.labels);
        const labelledKeys = new Set(result.storageChanges?.map((change) => change.key));
        const rawWrites = writes.filter((write) => !labelledKeys.has(write.key));
        const rawChanges = report.stateChanges.filter(
          (change: { label?: string }) => !change.label,
        );
        expect(rawChanges).toHaveLength(rawWrites.length);
        for (const write of rawWrites) {
          expect(
            rawChanges.find((change: { key: string }) => change.key === write.key),
          ).toMatchObject({
            key: write.key,
            oldValue: write.original,
            newValue: write.dirty,
          });
        }
        if (scenario.name === 'executed calls')
          expect(
            report.stateChanges.find(
              (change: { label: string }) => change.label === 'peers[71].tokenDecimals',
            ),
          ).toMatchObject({
            oldValue: '0',
            newValue: '18',
            storageDetails: { oldValue: zeroHash, source: 'Etherscan' },
          });
      }
    } finally {
      restore();
      config.verification = previous;
      BlockExplorerFactory.clear();
      for (const path of cacheFiles) rmSync(path, { force: true });
      rmSync(outputDir, { recursive: true, force: true });
      node.kill();
      await node.exited;
    }
  },
  120000,
);
