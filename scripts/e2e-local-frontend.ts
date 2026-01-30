import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
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

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const CHAIN_ID = 31337;
const CONTEXT_DIR = path.join(process.cwd(), '.context');
const CONTEXT_FILE = path.join(CONTEXT_DIR, 'e2e-local.json');

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

function writeSimulationResults({
  governorAddress,
  proposer,
  rpcUrl,
  blockNumber,
  timestamp,
  simulationType,
  proposalId,
}: {
  governorAddress: Address;
  proposer: Address;
  rpcUrl: string;
  blockNumber: string;
  timestamp: string;
  simulationType: 'new' | 'proposed' | 'executed';
  proposalId: string;
}) {
  const simulationResultsPath = path.join(process.cwd(), 'frontend', 'public', 'simulation-results.json');

  const description = 'Local e2e smoke: click Propose, then flip to proposed to test Execute.';
  const result = [
    {
      proposalData: {
        id: 'local-e2e',
        targets: ['0x0000000000000000000000000000000000000001'],
        values: ['0'],
        signatures: [''],
        calldatas: ['0x'],
        description,
      },
      report: {
        status: 'success',
        summary: 'Local e2e smoke',
        markdownReport: '',
        structuredReport: {
          title: 'Local E2E Smoke',
          proposalText: description,
          status: 'success',
          summary: 'Local E2E smoke report (mock governor).',
          checks: [],
          stateChanges: [],
          events: [],
          metadata: {
            proposalId,
            proposer,
            governorAddress,
            chainId: CHAIN_ID,
            chainName: 'Anvil',
            blockExplorerBaseUrl: rpcUrl,
            simulationBlockNumber: blockNumber,
            simulationTimestamp: timestamp,
            simulationType,
          },
        },
      },
    },
  ];

  fs.mkdirSync(path.dirname(simulationResultsPath), { recursive: true });
  fs.writeFileSync(simulationResultsPath, JSON.stringify(result, null, 2));
}

async function main() {
  const port = await getFreePort();
  const rpcUrl = `http://127.0.0.1:${port}`;

  const anvil = Bun.spawn({
    cmd: ['anvil', '--silent', '--port', String(port), '--chain-id', String(CHAIN_ID), '--mnemonic', HARDHAT_MNEMONIC],
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const chain: Chain = {
    id: CHAIN_ID,
    name: 'Anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    testnet: true,
  };

  const account = mnemonicToAccount(HARDHAT_MNEMONIC);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  try {
    for (let i = 0; i < 80; i++) {
      try {
        await publicClient.getBlockNumber();
        break;
      } catch {
        await delay(50);
      }
    }

    const { abi: mockAbi, bytecode } = compileMockGovernor();
    const deployHash = await walletClient.deployContract({ abi: mockAbi, bytecode });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    if (!deployReceipt.contractAddress) throw new Error('MockGovernor deployment failed');
    const governorAddress = deployReceipt.contractAddress as Address;

    const blockNumber = (await publicClient.getBlockNumber()).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));

    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.writeFileSync(
      CONTEXT_FILE,
      JSON.stringify(
        {
          rpcUrl,
          chainId: CHAIN_ID,
          governorAddress,
          proposerAddress: account.address,
        },
        null,
        2,
      ),
    );

    writeSimulationResults({
      governorAddress,
      proposer: account.address,
      rpcUrl,
      blockNumber,
      timestamp,
      simulationType: 'new',
      proposalId: '0',
    });

    console.log('');
    console.log('Local e2e environment is ready:');
    console.log(`- RPC: ${rpcUrl}`);
    console.log(`- Chain ID: ${CHAIN_ID}`);
    console.log(`- MockGovernor: ${governorAddress}`);
    console.log('');
    console.log('Next steps:');
    console.log('1) Open http://localhost:3000/action');
    console.log('2) In MetaMask: add Localhost 31337 (RPC above), then connect wallet');
    console.log('3) Click "Propose" and confirm the tx');
    console.log('4) Run: bun run e2e:local:set-proposed   (in another terminal)');
    console.log('5) Reload /action, then click "Execute"');
    console.log('');

    const frontend = Bun.spawn({
      cmd: ['bun', 'dev'],
      cwd: path.join(process.cwd(), 'frontend'),
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID),
        NEXT_PUBLIC_RPC_URL: rpcUrl,
        NEXT_PUBLIC_GOVERNOR_ADDRESS: governorAddress,
        NEXT_PUBLIC_PROJECT_ID: 'demo',
      },
    });

    const shutdown = async () => {
      frontend.kill();
      anvil.kill();
      await Promise.allSettled([frontend.exited, anvil.exited]);
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await Promise.race([frontend.exited, anvil.exited]);
    await shutdown();
  } catch (err) {
    anvil.kill();
    await anvil.exited;
    throw err;
  }
}

await main();

