import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';
import type { SimulationBlock, SimulationData } from '../../types';
import type { CachedBlock, NeedsSimulationParams, ProposalCacheEntry } from './types';

// Cache directory path
const CACHE_DIR = join(process.cwd(), 'cache');

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

// Custom replacer function to handle BigInt values
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function bigIntReplacer(_key: string, value: any) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

function isValidCachedProposal(data: unknown): data is ProposalCacheEntry {
  if (!data || typeof data !== 'object') return false;
  const entry = data as ProposalCacheEntry;

  if (!entry.timestamp || typeof entry.timestamp !== 'number') return false;
  if (entry.proposalState !== null && typeof entry.proposalState !== 'string') return false;
  if (!entry.simulationData || typeof entry.simulationData !== 'object') return false;

  const simData = entry.simulationData;
  if (!simData.proposal || typeof simData.proposal !== 'object') return false;

  const proposal = simData.proposal;
  // Required fields
  if (!proposal.proposalId || typeof proposal.proposalId !== 'string') return false;
  if (!proposal.id || typeof proposal.id !== 'string') return false;

  // Optional fields should be of correct type if present
  if (proposal.startBlock && typeof proposal.startBlock !== 'string') return false;
  if (proposal.endBlock && typeof proposal.endBlock !== 'string') return false;
  if (proposal.values && !Array.isArray(proposal.values)) return false;
  if (proposal.targets && !Array.isArray(proposal.targets)) return false;
  if (proposal.proposer && typeof proposal.proposer !== 'string') return false;
  if (proposal.description && typeof proposal.description !== 'string') return false;
  if (proposal.signatures && !Array.isArray(proposal.signatures)) return false;
  if (proposal.calldatas && !Array.isArray(proposal.calldatas)) return false;

  return true;
}

/**
 * Gets cached simulation data for a proposal
 */
export function getCachedProposal(
  daoName: string,
  governorAddress: string,
  proposalId: string,
): SimulationData | null {
  if (proposalId === 'undefined') {
    throw new Error('Proposal ID is required');
  }

  try {
    const cacheDir = join(CACHE_DIR, daoName, governorAddress);
    const cacheFile = join(cacheDir, `${proposalId}.json`);

    if (!existsSync(cacheFile)) {
      return null;
    }

    const fileContent = readFileSync(cacheFile, 'utf-8');
    const parsedData = JSON.parse(fileContent);

    if (!isValidCachedProposal(parsedData)) {
      console.warn(`[Cache] Invalid cache format for proposal ${proposalId}`);
      return null;
    }

    const cachedData = parsedData.simulationData;
    const proposal = cachedData.proposal;

    // Convert string values back to bigint
    const startBlock = BigInt(proposal.startBlock);
    const endBlock = BigInt(proposal.endBlock);
    const id = BigInt(proposal.id);
    const proposalIdBigInt = BigInt(proposal.proposalId);
    const targets = proposal.targets.map((t) => getAddress(t));
    const values = proposal.values.map((v) => BigInt(v));
    const latestBlock: SimulationBlock = {
      number: BigInt(cachedData.latestBlock.number),
      timestamp: BigInt(cachedData.latestBlock.timestamp),
    };

    return {
      ...cachedData,
      proposal: {
        ...proposal,
        startBlock,
        endBlock,
        id,
        proposalId: proposalIdBigInt,
        values,
        targets,
        proposer: proposal.proposer,
        description: proposal.description,
        signatures: proposal.signatures,
        calldatas: proposal.calldatas,
      },
      latestBlock,
    };
  } catch (error) {
    console.error(`[Cache] Error reading cache for proposal ${proposalId}:`, error);
    return null;
  }
}

/**
 * Caches simulation data for a proposal
 */
export async function cacheProposal(
  daoName: string,
  governorAddress: string,
  proposalId: string,
  proposalState: string | null,
  simulationData: SimulationData,
): Promise<void> {
  try {
    const cacheDir = join(CACHE_DIR, daoName, governorAddress);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Convert BigInt values to strings before caching
    const proposal = simulationData.proposal;
    const cachedProposal = {
      ...proposal,
      startBlock: proposal.startBlock.toString(),
      endBlock: proposal.endBlock.toString(),
      id: proposal.id.toString(),
      proposalId,
      values: proposal.values ? proposal.values.map((v) => v.toString()) : [],
      targets: proposal.targets.map((t) => getAddress(t)),
      proposer: proposal.proposer,
      description: proposal.description,
      signatures: proposal.signatures,
      calldatas: proposal.calldatas,
    };
    const cachedLatestBlock: CachedBlock = {
      number: simulationData.latestBlock.number?.toString() ?? '0',
      timestamp: simulationData.latestBlock.timestamp.toString(),
    };

    const cachedData = {
      timestamp: Date.now(),
      proposalState,
      simulationData: {
        sim: simulationData.sim,
        proposal: cachedProposal,
        config: simulationData.config,
        latestBlock: cachedLatestBlock,
      },
    };

    const cacheFile = join(cacheDir, `${proposalId}.json`);
    writeFileSync(cacheFile, JSON.stringify(cachedData, bigIntReplacer, 2));
  } catch (error) {
    console.error(`Error caching proposal ${proposalId}:`, error);
  }
}

/**
 * Checks if a proposal needs to be simulated based on its cache status
 */
export function needsSimulation({
  daoName,
  governorAddress,
  proposalId,
  currentState,
}: NeedsSimulationParams): boolean {
  try {
    const cacheDir = join(CACHE_DIR, daoName, governorAddress);
    const cacheFile = join(cacheDir, `${proposalId}.json`);

    if (!existsSync(cacheFile)) {
      return true;
    }

    const fileContent = readFileSync(cacheFile, 'utf-8');
    const parsedData = JSON.parse(fileContent);

    if (!isValidCachedProposal(parsedData)) {
      return true;
    }

    // Check if the proposal is in a terminal state
    const terminalStates = ['Executed', 'Cancelled', 'Expired'];
    if (terminalStates.includes(parsedData.proposalState || '')) {
      return false;
    }

    // Check if the current state matches the cached state
    if (parsedData.proposalState !== currentState) {
      return true;
    }

    // Check cache age (4 hours to allow for workflow schedule + buffer)
    const cacheAge = Date.now() - parsedData.timestamp;
    return cacheAge > 4 * 60 * 60 * 1000;
  } catch (error) {
    console.error(`[Cache] Error checking cache for proposal ${proposalId}:`, error);
    return true;
  }
}
