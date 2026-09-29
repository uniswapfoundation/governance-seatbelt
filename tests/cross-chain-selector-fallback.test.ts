import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  zeroAddress,
  zeroHash,
} from 'viem';
import { createMockSimulation } from '../checks/tests/test-utils';
import type { AllCheckResults, ProposalEvent, SimulationBlock, SimulationResult } from '../types';
import { clearFunctionSignatureRegistryCache } from '../utils/clients/function-signature-registry';

describe('cross-chain selector fallback decode', () => {
  function makeTenderlyContract(
    address: string,
    contractName: string,
  ): ReturnType<typeof createMockSimulation>['contracts'][number] {
    return {
      id: `${address}-id`,
      contract_id: `${address}-contract-id`,
      balance: '0',
      network_id: '1',
      public: true,
      verified_by: 'test',
      verification_date: null,
      address,
      contract_name: contractName,
      ens_domain: null,
      type: 'contract',
      evm_version: 'paris',
      compiler_version: '0.8.24',
      optimizations_used: false,
      optimization_runs: 0,
      libraries: null,
      data: {
        main_contract: 0,
        contract_info: [],
        abi: [],
        raw_abi: null,
      },
      creation_block: 0,
      creation_tx: zeroHash,
      creator_address: zeroAddress,
      created_at: new Date('2023-01-01T00:00:00Z'),
      number_of_watches: null,
      language: 'solidity',
      in_project: false,
      number_of_files: 1,
    };
  }

  function buildFixture(targetAddress: Address = '0x00000000000000000000000000000000000000ab') {
    const proposal: ProposalEvent = {
      id: 181n,
      proposalId: 181n,
      proposer: '0x1234567890abcdef1234567890abcdef12345678',
      startBlock: 19000000n,
      endBlock: 19100000n,
      description: '# Selector Fallback Regression Test',
      targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
      values: [0n],
      signatures: [''],
      calldatas: ['0x'],
    };

    const blocks = {
      current: { number: 19200000n, timestamp: 1700000000n } as SimulationBlock,
      start: { number: 19000000n, timestamp: 1699000000n } as SimulationBlock,
      end: { number: 19100000n, timestamp: 1699500000n } as SimulationBlock,
    };

    const checks: AllCheckResults = {
      'test-check': {
        name: 'Test Check',
        result: {
          errors: [],
          warnings: [],
          info: ['ok'],
        },
      },
    };

    const l2TargetAddress: Address = targetAddress;
    const l2FromAddress: Address = '0x0000000000000000000000000000000000000001';
    const l2InputData: Hex =
      '0x13af40350000000000000000000000001111111111111111111111111111111111111111';
    const stepSim = createMockSimulation([]);
    stepSim.contracts = [makeTenderlyContract(l2TargetAddress, 'MockTarget')];
    stepSim.transaction.transaction_info.logs = [];

    const accumulatedSim = createMockSimulation([]);
    accumulatedSim.contracts = [makeTenderlyContract(l2TargetAddress, 'MockTarget')];
    accumulatedSim.transaction.transaction_info.logs = [];

    const destinationSimulation: NonNullable<SimulationResult['destinationJobResults']>[number] = {
      chainId: 196,
      bridgeType: 'OptimismL1L2',
      status: 'success',
      job: {
        bridgeType: 'OptimismL1L2' as const,
        l2FromAddress,
        destinationChainId: 196,
        sourceOrder: 0,
        calls: [
          {
            l2TargetAddress,
            l2InputData,
            l2Value: '0',
          },
        ],
      },
      stepResults: [
        {
          stepIndex: 0,
          call: {
            l2TargetAddress,
            l2InputData,
            l2Value: '0',
          },
          status: 'success' as const,
          sim: stepSim,
        },
      ],
      accumulatedSim,
    };

    return { proposal, blocks, checks, destinationSimulation };
  }

  it('uses 4byte fallback when explorer ABI lookup fails', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-cross-chain-selector-'));
    const originalFetch = globalThis.fetch;
    const originalFetchContractAbi = BlockExplorerFactory.fetchContractAbi;

    clearFunctionSignatureRegistryCache();

    BlockExplorerFactory.fetchContractAbi = async () => null;

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (!urlString.includes('4byte.directory')) {
        throw new Error(`Unexpected fetch URL in test: ${urlString}`);
      }

      return new Response(
        JSON.stringify({
          count: 1,
          results: [
            {
              text_signature: 'setOwner(address)',
              hex_signature: '0x13af4035',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const { proposal, blocks, checks, destinationSimulation } = buildFixture();

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{ steps?: Array<{ call?: { signature?: string; source?: string } }> }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      const signature = structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.signature;
      expect(signature).toBe('setOwner(address)');
      expect(structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.source).toBe(
        'Function signature via 4byte.directory',
      );
      expect(markdown).toContain('Call: `setOwner(address)`');
      expect(markdown).not.toContain('Call: `0x13af4035`');
    } finally {
      globalThis.fetch = originalFetch;
      BlockExplorerFactory.fetchContractAbi = originalFetchContractAbi;
      clearFunctionSignatureRegistryCache();
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('prefers ABI decode over 4byte fallback when both are available', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { CacheManager } = await import('../utils/clients/block-explorers/cache');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-cross-chain-abi-priority-'));
    const originalFetch = globalThis.fetch;
    const { proposal, blocks, checks, destinationSimulation } = buildFixture(
      '0x00000000000000000000000000000000000000ac',
    );
    let fourByteFetchCalls = 0;

    clearFunctionSignatureRegistryCache();

    const abi = parseAbi(['function setOwner(address _owner)']);
    CacheManager.setAbiInMemory(
      196,
      destinationSimulation.job.calls[0].l2TargetAddress,
      abi,
      'Blockscout',
    );

    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const urlString =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlString.includes('4byte.directory')) fourByteFetchCalls += 1;
      throw new Error(`Unexpected fetch URL in test: ${urlString}`);
    }) as typeof fetch;

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const markdownPath = join(outputDir, '181.md');

      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{ steps?: Array<{ call?: { signature?: string; source?: string } }> }>;
        };
      };
      const markdown = readFileSync(markdownPath, 'utf8');

      expect(structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.signature).toBe(
        'setOwner(address)',
      );
      expect(structuredReport.crossChain?.jobs?.[0]?.steps?.[0]?.call?.source).toBe(
        'ABI via Blockscout',
      );
      expect(markdown).toContain('Call: `setOwner(address)`');
      expect(fourByteFetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      CacheManager.clearMemory();
      clearFunctionSignatureRegistryCache();
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('expands Polygon Fx batch previews into inner destination calls', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-polygon-fx-preview-'));
    const originalFetchContractAbi = BlockExplorerFactory.fetchContractAbi;

    const receiver = getAddress('0x8a1B966aC46F42275860f905dbC75EfBfDC12374');
    const v2Factory = getAddress('0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C');
    const v3Factory = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984');
    const feeTo = getAddress('0xc6ae6373cecc9e595a6c8b9fe581925a8c84f70a');
    const owner = getAddress('0x3f07f08b45912dcd6691c5b9412975d5113b2910');

    const processMessageAbi = parseAbi([
      'function processMessageFromRoot(uint256 stateId, address rootMessageSender, bytes data)',
    ]);
    const v2Abi = parseAbi(['function setFeeTo(address)']);
    const v3Abi = parseAbi(['function setOwner(address)']);
    const batchData = encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'bytes[]' }],
      [
        [v2Factory, v3Factory],
        [
          encodeFunctionData({ abi: v2Abi, functionName: 'setFeeTo', args: [feeTo] }),
          encodeFunctionData({ abi: v3Abi, functionName: 'setOwner', args: [owner] }),
        ],
      ],
    );
    const l2InputData = encodeFunctionData({
      abi: processMessageAbi,
      functionName: 'processMessageFromRoot',
      args: [1n, '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', batchData],
    });

    const { proposal, blocks, checks } = buildFixture(receiver);
    const stepSim = createMockSimulation([]);
    stepSim.contracts = [
      makeTenderlyContract(receiver, 'EthereumProxy'),
      makeTenderlyContract(v2Factory, 'UniswapV2Factory'),
      makeTenderlyContract(v3Factory, 'UniswapV3Factory'),
    ];
    stepSim.transaction.transaction_info.logs = [];

    const destinationSimulation: NonNullable<SimulationResult['destinationJobResults']>[number] = {
      chainId: 137,
      bridgeType: 'PolygonFxL1L2',
      status: 'success' as const,
      job: {
        bridgeType: 'PolygonFxL1L2',
        l2FromAddress: '0x8397259c983751DAf40400790063935a11afa28a',
        destinationChainId: 137,
        sourceOrder: 0,
        calls: [
          {
            l2TargetAddress: receiver,
            l2InputData,
            l2Value: '0',
          },
        ],
      },
      stepResults: [
        {
          stepIndex: 0,
          call: {
            l2TargetAddress: receiver,
            l2InputData,
            l2Value: '0',
          },
          status: 'success',
          sim: stepSim,
        },
      ],
      accumulatedSim: stepSim,
    };

    BlockExplorerFactory.fetchContractAbi = async (target) => {
      const address = getAddress(target);
      if (address === receiver) return processMessageAbi;
      if (address === v2Factory) return v2Abi;
      if (address === v3Factory) return v3Abi;
      return null;
    };

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{
            steps?: Array<{
              forwardedTargetAddress?: string;
              forwardedTargetLabel?: string;
              forwardedCall?: { signature?: string };
              call?: { signature?: string };
            }>;
          }>;
        };
      };

      const steps = structuredReport.crossChain?.jobs?.[0]?.steps ?? [];
      expect(steps).toHaveLength(2);
      expect(steps[0]?.call?.signature).toBe('processMessageFromRoot(uint256,address,bytes)');
      expect(steps[0]?.forwardedTargetAddress).toBe(v2Factory);
      expect(steps[0]?.forwardedTargetLabel).toBe('UniswapV2Factory');
      expect(steps[0]?.forwardedCall?.signature).toBe('setFeeTo(address)');
      expect(steps[1]?.forwardedTargetAddress).toBe(v3Factory);
      expect(steps[1]?.forwardedTargetLabel).toBe('UniswapV3Factory');
      expect(steps[1]?.forwardedCall?.signature).toBe('setOwner(address)');
    } finally {
      BlockExplorerFactory.fetchContractAbi = originalFetchContractAbi;
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('does not mark conceptual forwarded calls as failed when receiver-mode job succeeded', async () => {
    process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
    process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
    process.env.ETHERSCAN_API_KEY ??= 'test';
    process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
    process.env.TENDERLY_USER ??= 'test';
    process.env.TENDERLY_PROJECT_SLUG ??= 'test';

    const { generateAndSaveReports } = await import('../presentation/report');
    const { BlockExplorerFactory } = await import('../utils/clients/block-explorers/factory');
    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-cross-chain-forwarded-status-'));
    const originalFetchContractAbi = BlockExplorerFactory.fetchContractAbi;
    const { proposal, blocks, checks } = buildFixture();
    const forwardAbi = parseAbi(['function forward(address target, bytes data)']);
    const ownerAbi = parseAbi(['function setOwner(address _owner)']);
    const feeAbi = parseAbi(['function setFeeTo(address)']);

    const receiverAddress = '0x0000000000000000000000000000000000000001' as Address;
    const firstTarget = '0x00000000000000000000000000000000000000b2' as Address;
    const secondTarget = '0x00000000000000000000000000000000000000b3' as Address;
    const receiverSim = createMockSimulation([]);

    const destinationSimulation: NonNullable<SimulationResult['destinationJobResults']>[number] = {
      chainId: 143,
      bridgeType: 'WormholeL1L2',
      status: 'success',
      job: {
        bridgeType: 'WormholeL1L2',
        l2FromAddress: receiverAddress,
        destinationChainId: 143,
        sourceOrder: 0,
        wormholeChainId: 30,
        calls: [
          {
            l2TargetAddress: receiverAddress,
            l2InputData: encodeFunctionData({
              abi: forwardAbi,
              functionName: 'forward',
              args: [
                firstTarget,
                encodeFunctionData({
                  abi: ownerAbi,
                  functionName: 'setOwner',
                  args: ['0x1111111111111111111111111111111111111111'],
                }),
              ],
            }),
            l2Value: '0',
          },
          {
            l2TargetAddress: receiverAddress,
            l2InputData: encodeFunctionData({
              abi: forwardAbi,
              functionName: 'forward',
              args: [
                secondTarget,
                encodeFunctionData({
                  abi: feeAbi,
                  functionName: 'setFeeTo',
                  args: ['0x2222222222222222222222222222222222222222'],
                }),
              ],
            }),
            l2Value: '0',
          },
        ],
      },
      stepResults: [
        {
          stepIndex: 0,
          call: {
            l2TargetAddress: receiverAddress,
            l2InputData: '0x12345678',
            l2Value: '0',
          },
          status: 'success',
          sim: receiverSim,
        },
      ],
      accumulatedSim: receiverSim,
    };

    BlockExplorerFactory.fetchContractAbi = async (target) => {
      const address = getAddress(target);
      if (address === receiverAddress) return forwardAbi;
      if (address === firstTarget) return ownerAbi;
      if (address === secondTarget) return feeAbi;
      return null;
    };

    try {
      await generateAndSaveReports({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        outputDir,
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        destinationJobResults: [destinationSimulation],
      });

      const structuredReportPath = join(outputDir, '181.json');
      const structuredReport = JSON.parse(readFileSync(structuredReportPath, 'utf8')) as {
        crossChain?: {
          jobs?: Array<{
            steps?: Array<{ status?: string; forwardedCall?: { signature?: string } }>;
          }>;
        };
      };

      const steps = structuredReport.crossChain?.jobs?.[0]?.steps ?? [];
      expect(steps).toHaveLength(2);
      expect(steps[0]?.status).toBe('success');
      expect(steps[1]?.status).toBe('success');
      expect(steps[1]?.forwardedCall?.signature).toBe('setFeeTo(address)');
    } finally {
      BlockExplorerFactory.fetchContractAbi = originalFetchContractAbi;
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);
});
