import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import solc from 'solc';
import { getAddress, keccak256, zeroAddress, zeroHash } from 'viem';
import { checkStateChanges } from '../checks/check-state-changes';
import { createMockSimulation } from '../checks/tests/test-utils';
import { generateAndSaveReports } from '../presentation/report';
import type { ProposalData, ProposalEvent } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { CHAIN_CONFIGS } from '../utils/clients/client';
import { setMockFetch, toFetchUrl } from './helpers/verification-test-helpers';

// Double only external explorer HTTP responses so CI can exercise the real compiler,
// state-change check, cache and report writer without depending on provider uptime.
test('verified layouts label packed fields; mismatches, unknown bits, missing source and hashed writes stay raw', async () => {
  const input = {
    language: 'Solidity',
    sources: {
      'Config.sol': {
        content:
          'pragma solidity ^0.8.30; contract Config { address public recipient; uint64 public limit; bool public enabled; mapping(address => uint256) public balances; uint256 public immutable seed; constructor(uint256 value) { seed = value; } }',
      },
    },
    settings: {
      outputSelection: {
        '*': { '*': ['evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] },
      },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input))).contracts['Config.sol'].Config;
  // Runtime constants normally come from constructor arguments. Change only compiler-declared ranges.
  const bytes = Buffer.from(compiled.evm.deployedBytecode.object, 'hex');
  for (const range of Object.values(compiled.evm.deployedBytecode.immutableReferences).flat() as {
    start: number;
    length: number;
  }[]) {
    bytes.fill(0, range.start, range.start + range.length);
    bytes[range.start + range.length - 1] = 42;
  }
  const runtime = `0x${bytes.toString('hex')}`;
  const mismatchedBytes = Buffer.from(bytes);
  mismatchedBytes[0] ^= 1;
  const version = solc.version().split('.Emscripten')[0];
  const config = CHAIN_CONFIGS[5042];
  const previous = { verification: config.verification, blockscoutApiUrl: config.blockscoutApiUrl };
  config.verification = { ...config.verification!, apiKey: 'test-key' };
  config.blockscoutApiUrl = 'https://explorer.arc.io/api/v2';
  const requests: string[] = [];
  let etherscanAvailable = false;
  let blockscoutAvailable = true;
  const restore = setMockFetch(async (request) => {
    const url = toFetchUrl(request);
    requests.push(url.hostname);
    if (url.hostname === 'api.etherscan.io')
      return Response.json({
        status: '1',
        result: [
          {
            SourceCode: etherscanAvailable ? `{${JSON.stringify(input)}}` : '',
            CompilerVersion: version,
            ContractName: 'Config',
            ContractFileName: 'Config.sol',
          },
        ],
      });
    if (url.hostname === 'explorer.arc.io')
      return blockscoutAvailable
        ? Response.json({
            is_fully_verified: false,
            is_partially_verified: true,
            language: 'solidity',
            source_code: input.sources['Config.sol'].content,
            file_path: 'Config.sol',
            name: 'Config',
            compiler_version: version,
            compiler_settings: input.settings,
            additional_sources: [],
          })
        : new Response(null, { status: 404 });
    throw new Error('Unexpected external request');
  });
  const cacheFiles: string[] = [];
  const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-storage-integration-'));
  try {
    for (const [index, code] of [
      runtime,
      runtime,
      `0x${mismatchedBytes.toString('hex')}`,
      runtime,
      runtime,
    ].entries()) {
      etherscanAvailable = index === 0;
      blockscoutAvailable = index !== 4;
      const address = `0x${(8800 + index).toString(16).padStart(40, '0')}`;
      const cachePath = join(
        process.cwd(),
        'cache/storage-layouts',
        `5042-${getAddress(address)}-${keccak256(code as `0x${string}`)}.json`,
      );
      cacheFiles.push(cachePath);
      rmSync(cachePath, { force: true });
      const sim = createMockSimulation([]);
      sim.contracts = [
        {
          address,
          contract_name: 'Config',
          deployed_bytecode: code,
        } as (typeof sim.contracts)[number],
      ];
      sim.transaction.transaction_info.state_diff = [
        {
          soltype: null,
          original: zeroHash,
          dirty: zeroHash,
          raw: [
            {
              address,
              key: zeroHash,
              original: zeroHash,
              dirty: `0x${(BigInt(`0x${'1'.repeat(40)}`) + (index === 1 ? (7n << 160n) + (1n << 224n) : index === 3 ? 1n << 248n : 0n)).toString(16).padStart(64, '0')}`,
            },
            {
              address,
              key: `0x${'a'.repeat(64)}`,
              original: zeroHash,
              dirty: `0x${'0'.repeat(63)}1`,
            },
          ],
        },
      ];
      const result = await checkStateChanges.checkProposal({} as ProposalEvent, sim, {
        chainConfig: config,
        governor: { address: zeroAddress },
        timelock: { address: zeroAddress },
      } as ProposalData);
      if (index < 2) {
        expect(result.storageChanges).toHaveLength(index === 0 ? 1 : 3);
        expect(result.storageChanges![0]).toMatchObject({
          label: 'recipient',
          oldValue: zeroAddress,
          newValue: `0x${'1'.repeat(40)}`,
        });
        if (index === 1) {
          expect(result.storageChanges![1]).toMatchObject({
            label: 'limit',
            oldValue: '0',
            newValue: '7',
          });
          expect(result.storageChanges![2]).toMatchObject({
            label: 'enabled',
            oldValue: 'false',
            newValue: 'true',
          });
        }
      } else expect(result.storageChanges).toBeUndefined();
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
          description: '# Storage integration',
          targets: [address],
          values: [0n],
          signatures: [''],
          calldatas: ['0x'],
        } as ProposalEvent,
        checks: { checkStateChanges: { name: checkStateChanges.name, result } },
        governorAddress: zeroAddress,
        chainId: 5042,
        outputDir,
      });
      const report = JSON.parse(readFileSync(join(outputDir, `${index + 1}.json`), 'utf8'));
      expect(report.stateChanges).toHaveLength(index === 1 ? 4 : 2);
      expect(report.chainReports[0].stateChanges).toEqual(report.stateChanges);
      if (index < 2)
        expect(report.stateChanges[0].storageDetails.source).toBe(
          index === 0 ? 'Etherscan' : 'Blockscout',
        );
      else
        expect(
          report.stateChanges.every((c: { storageDetails?: unknown }) => !c.storageDetails),
        ).toBe(true);
    }
    expect(requests).toEqual([
      'api.etherscan.io',
      'api.etherscan.io',
      'explorer.arc.io',
      'api.etherscan.io',
      'explorer.arc.io',
      'api.etherscan.io',
      'explorer.arc.io',
      'api.etherscan.io',
      'explorer.arc.io',
    ]);
  } finally {
    for (const path of cacheFiles) rmSync(path, { force: true });
    restore();
    Object.assign(config, previous);
    BlockExplorerFactory.clear();
    rmSync(outputDir, { recursive: true, force: true });
  }
}, 60000);
