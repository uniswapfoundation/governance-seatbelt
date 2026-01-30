import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { http, type Address, type Chain, createPublicClient } from 'viem';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOrCreateRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isRecord(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function readContext(): { rpcUrl: string; chainId: number; governorAddress: Address } {
  const raw = fs.readFileSync(CONTEXT_FILE, 'utf8');
  const parsed = JSON.parse(raw) as { rpcUrl: string; chainId: number; governorAddress: Address };
  return parsed;
}

function updateSimulationResults(proposalId: string) {
  const simulationResultsPath = path.join(
    process.cwd(),
    'frontend',
    'public',
    'simulation-results.json',
  );
  const raw = fs.readFileSync(simulationResultsPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('simulation-results.json must be a non-empty array');
  }

  const first = parsed[0];
  if (!isRecord(first)) {
    throw new Error('simulation-results.json first entry must be an object');
  }

  const report = getOrCreateRecord(first, 'report');
  const structuredReport = getOrCreateRecord(report, 'structuredReport');
  const metadata = getOrCreateRecord(structuredReport, 'metadata');

  metadata.simulationType = 'proposed';
  metadata.proposalId = proposalId;

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
  console.log(
    `Updated simulation-results.json -> simulationType=proposed, proposalId=${lastProposalId}`,
  );
}

await main();
