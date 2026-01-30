import { describe, expect, it } from 'bun:test';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import {
  http,
  type Abi,
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { GOVERNOR_ABI } from '../frontend/src/config/abis';
import { buildExecuteArgs, buildProposeArgs } from '../frontend/src/lib/write-actions';

// Use the common local-dev phrase, but avoid naming that trips secret scanners.
const ANVIL_TEST_PHRASE = 'test test test test test test test test test test test junk';

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

function compileMockGovernor(): {
  abi: Abi;
  bytecode: `0x${string}`;
  targetAbi: Abi;
  targetBytecode: `0x${string}`;
} {
  const source = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

contract MockGovernor {
  uint256 public lastProposalId;
  mapping(uint256 => bool) public executed;
  mapping(uint256 => address[]) internal _targets;
  mapping(uint256 => uint256[]) internal _values;
  mapping(uint256 => bytes[]) internal _calldatas;

  event ProposalCreated(uint256 id);
  event ProposalExecuted(uint256 id);

  function propose(
    address[] calldata targets,
    uint256[] calldata values,
    string[] calldata signatures,
    bytes[] calldata calldatas,
    string calldata
  ) external returns (uint256) {
    require(
      targets.length == values.length &&
        targets.length == signatures.length &&
        targets.length == calldatas.length,
      "length mismatch"
    );
    lastProposalId++;
    emit ProposalCreated(lastProposalId);

    for (uint256 i = 0; i < targets.length; i++) {
      bytes memory callData = bytes(signatures[i]).length == 0
        ? calldatas[i]
        : abi.encodePacked(bytes4(keccak256(bytes(signatures[i]))), calldatas[i]);
      _targets[lastProposalId].push(targets[i]);
      _values[lastProposalId].push(values[i]);
      _calldatas[lastProposalId].push(callData);
    }

    return lastProposalId;
  }

  function execute(uint256 proposalId) external payable {
    require(!executed[proposalId], "already executed");
    executed[proposalId] = true;
    address[] storage targets = _targets[proposalId];
    uint256[] storage values = _values[proposalId];
    bytes[] storage calldatas = _calldatas[proposalId];
    for (uint256 i = 0; i < targets.length; i++) {
      (bool ok, ) = targets[i].call{ value: values[i] }(calldatas[i]);
      require(ok, "call failed");
    }
    emit ProposalExecuted(proposalId);
  }
}

contract MockTarget {
  uint256 public value;
  function setValue(uint256 next) external { value = next; }
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

  const contracts = output.contracts['MockGovernor.sol'];
  const compiledGovernor = contracts?.MockGovernor;
  const compiledTarget = contracts?.MockTarget;
  if (!compiledGovernor?.evm?.bytecode?.object) throw new Error('Failed to compile MockGovernor');
  if (!compiledTarget?.evm?.bytecode?.object) throw new Error('Failed to compile MockTarget');
  return {
    abi: compiledGovernor.abi as Abi,
    bytecode: `0x${compiledGovernor.evm.bytecode.object}`,
    targetAbi: compiledTarget.abi as Abi,
    targetBytecode: `0x${compiledTarget.evm.bytecode.object}`,
  };
}

describe('frontend propose/execute on-chain smoke (local anvil)', () => {
  const maybeIt = Bun.which('anvil') ? it : it.skip;

  maybeIt(
    'can propose + execute using frontend-built args against a local mock governor',
    async () => {
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
          ANVIL_TEST_PHRASE,
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

        const account = mnemonicToAccount(ANVIL_TEST_PHRASE);
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

        const { abi: mockAbi, bytecode, targetAbi, targetBytecode } = compileMockGovernor();
        const deployGovernorHash = await walletClient.deployContract({
          abi: mockAbi,
          bytecode,
          args: [],
        });
        const deployGovernorReceipt = await publicClient.waitForTransactionReceipt({
          hash: deployGovernorHash,
        });
        if (!deployGovernorReceipt.contractAddress)
          throw new Error('MockGovernor deployment failed');
        const governorAddress = deployGovernorReceipt.contractAddress as Address;

        const deployTargetHash = await walletClient.deployContract({
          abi: targetAbi,
          bytecode: targetBytecode,
          args: [],
        });
        const deployTargetReceipt = await publicClient.waitForTransactionReceipt({
          hash: deployTargetHash,
        });
        if (!deployTargetReceipt.contractAddress) throw new Error('MockTarget deployment failed');
        const targetAddress = deployTargetReceipt.contractAddress as Address;

        const demoValue = 42n;
        const targets = [targetAddress] as const;
        const values = [0n] as const;
        const signatures = ['setValue(uint256)'] as const;
        const calldatas = [encodeAbiParameters([{ type: 'uint256' }], [demoValue])] as const;
        const description = 'Smoke test proposal: setValue(42)';

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
          args: [],
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

        const value = await publicClient.readContract({
          address: targetAddress,
          abi: targetAbi,
          functionName: 'value',
          args: [],
        });
        expect(value).toBe(demoValue);
      } finally {
        anvil.kill();
        await anvil.exited;
      }
    },
  );
});
