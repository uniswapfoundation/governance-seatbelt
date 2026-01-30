import { describe, expect, it } from 'bun:test';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { GOVERNOR_ABI } from '../frontend/src/config/abis';
import { buildExecuteArgs, buildProposeArgs } from '../frontend/src/lib/write-actions';

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a free TCP port')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function compileMockGovernor(): { abi: any; bytecode: `0x${string}` } {
  const source = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

contract MockGovernor {
  uint256 public lastProposalId;
  mapping(uint256 => bool) public executed;

  event ProposalCreated(uint256 id);
  event ProposalExecuted(uint256 id);

  function propose(
    address[] calldata,
    uint256[] calldata,
    string[] calldata,
    bytes[] calldata,
    string calldata
  ) external returns (uint256) {
    lastProposalId++;
    emit ProposalCreated(lastProposalId);
    return lastProposalId;
  }

  function execute(uint256 proposalId) external payable {
    executed[proposalId] = true;
    emit ProposalExecuted(proposalId);
  }
}
`;

  const input = {
    language: 'Solidity',
    sources: { 'MockGovernor.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors: Array<{ severity?: string; formattedMessage?: string }> = output.errors ?? [];
  const fatal = errors.filter((e) => e.severity === 'error');
  if (fatal.length > 0) {
    throw new Error(fatal.map((e) => e.formattedMessage).join('\n'));
  }

  const compiled = output.contracts['MockGovernor.sol']?.MockGovernor;
  if (!compiled?.evm?.bytecode?.object) throw new Error('Failed to compile MockGovernor');
  return { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` };
}

describe('frontend propose/execute on-chain smoke (local anvil)', () => {
  const maybeIt = Bun.which('anvil') ? it : it.skip;

  maybeIt('can propose + execute using frontend-built args against a local mock governor', async () => {
    const port = await getFreePort();
    const rpcUrl = `http://127.0.0.1:${port}`;

    const anvil = Bun.spawn({
      cmd: [
        'anvil',
        '--silent',
        '--port',
        String(port),
        '--chain-id',
        '31337',
        '--mnemonic',
        HARDHAT_MNEMONIC,
      ],
      stdout: 'ignore',
      stderr: 'pipe',
    });

    try {
      const chain: Chain = {
        id: 31337,
        name: 'Anvil',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
      };

      const account = mnemonicToAccount(HARDHAT_MNEMONIC);
      const transport = http(rpcUrl);
      const publicClient = createPublicClient({ chain, transport });
      const walletClient = createWalletClient({ chain, transport, account });

      // Wait for the node to be ready.
      for (let i = 0; i < 50; i++) {
        try {
          await publicClient.getBlockNumber();
          break;
        } catch {
          await delay(50);
        }
      }

      const { abi: mockAbi, bytecode } = compileMockGovernor();
      const deployHash = await walletClient.deployContract({
        abi: mockAbi,
        bytecode,
      });
      const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
      if (!deployReceipt.contractAddress) throw new Error('MockGovernor deployment failed');
      const governorAddress = deployReceipt.contractAddress as Address;

      const targets = ['0x0000000000000000000000000000000000000001'] as const;
      const values = [0n] as const;
      const signatures = [''] as const;
      const calldatas = ['0x'] as const;
      const description = 'Smoke test proposal';

      const proposeArgs = buildProposeArgs({
        targets,
        values,
        signatures,
        calldatas,
        description,
      });

      const proposeHash = await walletClient.writeContract({
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'propose',
        args: proposeArgs,
      });
      await publicClient.waitForTransactionReceipt({ hash: proposeHash });

      const proposalId = await publicClient.readContract({
        address: governorAddress,
        abi: mockAbi,
        functionName: 'lastProposalId',
      });
      expect(proposalId).toBe(1n);

      const executeHash = await walletClient.writeContract({
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'execute',
        args: buildExecuteArgs(proposalId as bigint),
      });
      await publicClient.waitForTransactionReceipt({ hash: executeHash });

      const executed = await publicClient.readContract({
        address: governorAddress,
        abi: mockAbi,
        functionName: 'executed',
        args: [proposalId as bigint],
      });
      expect(executed).toBe(true);
    } finally {
      anvil.kill();
      await anvil.exited;
    }
  });
});

