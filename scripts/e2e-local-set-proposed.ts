import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createPublicClient, http, type Address, type Chain } from 'viem';

const CONTEXT_FILE = path.join(process.cwd(), '.context', 'e2e-local.json');

const mockGovernorReadAbi = [
  {
    type: 'function',
    name: 'lastProposalId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

function readContext(): { rpcUrl: string; chainId: number; governorAddress: Address } {
  const raw = fs.readFileSync(CONTEXT_FILE, 'utf8');
  const parsed = JSON.parse(raw) as { rpcUrl: string; chainId: number; governorAddress: Address };
  return parsed;
}

function updateSimulationResults(proposalId: string) {
  const simulationResultsPath = path.join(process.cwd(), 'frontend', 'public', 'simulation-results.json');
  const raw = fs.readFileSync(simulationResultsPath, 'utf8');
  const parsed = JSON.parse(raw) as any[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('simulation-results.json must be a non-empty array');
  }

  const first = parsed[0];
  first.report = first.report ?? {};
  first.report.structuredReport = first.report.structuredReport ?? {};
  first.report.structuredReport.metadata = first.report.structuredReport.metadata ?? {};

  first.report.structuredReport.metadata.simulationType = 'proposed';
  first.report.structuredReport.metadata.proposalId = proposalId;

  fs.writeFileSync(simulationResultsPath, JSON.stringify(parsed, null, 2));
}

async function main() {
  if (!fs.existsSync(CONTEXT_FILE)) {
    throw new Error(`Missing ${CONTEXT_FILE}. Run: bun run e2e:local`);
  }

  const { rpcUrl, chainId, governorAddress } = readContext();
  const chain: Chain = {
    id: chainId,
    name: 'Local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    testnet: true,
  };

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const lastProposalId = (await publicClient.readContract({
    address: governorAddress,
    abi: mockGovernorReadAbi,
    functionName: 'lastProposalId',
  })) as bigint;

  if (lastProposalId === 0n) {
    throw new Error('No proposals found yet (lastProposalId is 0). Click Propose first.');
  }

  updateSimulationResults(lastProposalId.toString());
  console.log(`Updated simulation-results.json -> simulationType=proposed, proposalId=${lastProposalId}`);
}

await main();

