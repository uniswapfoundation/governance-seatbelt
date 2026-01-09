import {
  type Address,
  encodeAbiParameters,
  getAddress,
  getContract,
  keccak256,
  toBytes,
  zeroAddress,
} from 'viem';
import type { GovernorType, ProposalEvent, ProposalStruct } from '../../types';
import { GOVERNOR_ABI } from '../abis/GovernorBravo';
import { GOVERNOR_OZ_ABI } from '../abis/GovernorOZ';
import { timelockAbi } from '../abis/Timelock';
import { publicClient } from '../clients/client';
import { erc20 as getErc20Token } from './erc20';
import { getBravoSlots, governorBravo } from './governor-bravo';
import { getOzSlots, governorOz } from './governor-oz';

// --- Exported methods ---
export async function inferGovernorType(address: Address): Promise<GovernorType> {
  try {
    // If the `initialProposalId` function exists, and the initial proposal was a "small" value,
    // it's overwhelmingly likely this is GovernorBravo. OZ style governors use a hash as the
    // proposal IDs so IDs will be very large numbers.
    const id = await publicClient.readContract({
      address,
      abi: GOVERNOR_ABI,
      functionName: 'initialProposalId',
    });
    if (typeof id === 'bigint' && id <= 100_000n) return 'bravo';
  } catch (err) {
    console.error(err);
  }

  return 'oz';
}

export function getGovernor(governorType: GovernorType, address: Address) {
  return governorType === 'bravo' ? governorBravo(address) : governorOz(address);
}

export async function getProposal(
  governorType: GovernorType,
  address: Address,
  proposalId: bigint,
): Promise<ProposalStruct> {
  if (governorType === 'bravo') {
    const proposal = await publicClient.readContract({
      address,
      abi: GOVERNOR_ABI,
      functionName: 'proposals',
      args: [proposalId],
    });

    return {
      id: proposalId,
      eta: proposal[2],
      startBlock: proposal[3],
      endBlock: proposal[4],
      forVotes: proposal[5],
      againstVotes: proposal[6],
      abstainVotes: proposal[7],
      canceled: proposal[8],
      executed: proposal[9],
    };
  }

  // Piece together the struct for OZ Governors.
  const ozContract = {
    address,
    abi: GOVERNOR_OZ_ABI,
  } as const;

  const [votes, state] = await publicClient.multicall({
    contracts: [
      { ...ozContract, functionName: 'proposalVotes', args: [proposalId] },
      { ...ozContract, functionName: 'state', args: [proposalId] },
    ],
  });

  if (votes.error) throw new Error('Proposal votes not found');
  if (state.error) throw new Error('Proposal state not found');

  const [againstVotes, forVotes, abstainVotes] = votes.result;

  return {
    id: proposalId,
    eta: 0n, // OZ governors don't use eta
    startTime: 0n, // These are handled differently in OZ
    endTime: 0n,
    forVotes,
    againstVotes,
    abstainVotes,
    canceled: state.result === 2,
    executed: state.result === 7,
  };
}

export async function getTimelock(governorType: GovernorType, address: Address) {
  const governor = getGovernor(governorType, address);
  if (!governor) throw new Error('Governor not found');
  const timelockAddress = await governor.read.timelock();

  return getContract({
    address: timelockAddress,
    abi: timelockAbi,
    client: publicClient,
  });
}

export async function getVotingToken(
  governorType: GovernorType,
  address: Address,
  proposalId: bigint,
): Promise<ReturnType<typeof getErc20Token>> {
  const governor = getGovernor(governorType, address);
  if (!governor) throw new Error('Governor not found');

  if (governorType === 'bravo') {
    const govSlots = getBravoSlots(proposalId);
    const rawVotingToken = await publicClient.getStorageAt({ address, slot: govSlots.votingToken });
    if (!rawVotingToken) throw new Error('Voting token not found');
    const votingToken = getAddress(`0x${rawVotingToken.slice(26)}`);
    return getErc20Token(votingToken);
  }

  const tokenAddress = await governorOz(address).read.token();
  return getErc20Token(tokenAddress);
}

export function getGovSlots(governorType: GovernorType, proposalId: bigint) {
  if (governorType === 'bravo') return getBravoSlots(proposalId);
  return getOzSlots(proposalId);
}

export async function getProposalIds(
  governorType: GovernorType,
  address: Address,
  latestBlockNum: bigint,
): Promise<bigint[]> {
  if (governorType === 'bravo') {
    // Fetch all proposal IDs
    const governor = governorBravo(address);
    const proposalCreatedEvents = await publicClient.getContractEvents({
      address: governor.address,
      abi: GOVERNOR_ABI,
      eventName: 'ProposalCreated',
      fromBlock: 0n,
      toBlock: latestBlockNum,
    });

    // Get all proposal IDs from events
    const allProposalIds = proposalCreatedEvents
      .map((event) => event.args.id)
      .filter((id): id is bigint => id !== undefined);

    // Remove proposals from GovernorAlpha based on the initial GovernorBravo proposal ID
    const initialProposalId = await governor.read.initialProposalId();

    // Filter out those that are less than or equal to initialProposalId
    return allProposalIds.filter((id) => id > initialProposalId);
  }

  // Fetch all proposal IDs for OZ governor
  const proposalCreatedEvents = await publicClient.getContractEvents({
    address,
    abi: GOVERNOR_OZ_ABI,
    eventName: 'ProposalCreated',
    fromBlock: 0n,
    toBlock: latestBlockNum,
  });

  // Filter out undefined values with a type guard
  const allProposalIds = proposalCreatedEvents
    .map((event) => event.args.proposalId)
    .filter((id): id is bigint => id !== undefined);
  return allProposalIds;
}

export function getProposalId(proposal: ProposalEvent): bigint {
  return proposal.id ?? proposal.proposalId;
}

// Generate proposal ID, used when simulating new proposals.
export async function generateProposalId(
  governorType: GovernorType,
  address: Address,
  // Below arg is only required for OZ governors.
  {
    targets,
    values,
    calldatas,
    description,
  }: { targets: Address[]; values: bigint[]; calldatas: `0x${string}`[]; description: string } = {
    targets: [],
    values: [],
    calldatas: [],
    description: '',
  },
): Promise<bigint> {
  // Fetch proposal count from the contract and increment it by 1.
  if (governorType === 'bravo') {
    const count = await governorBravo(address).read.proposalCount();
    const newProposalId = count + 1n;
    return newProposalId;
  }

  return await publicClient.readContract({
    address,
    abi: GOVERNOR_OZ_ABI,
    functionName: 'hashProposal',
    args: [targets, values, calldatas, keccak256(toBytes(description))],
  });
}

// Returns the identifier of an operation containing a single transaction.
// For OZ governors, predecessor is often zero and salt is often description hash.
// This is only intended to be used with OZ governors.
export function hashOperationOz(
  target: Address,
  value: bigint,
  calldata: `0x${string}`,
  predecessor: `0x${string}`,
  salt: `0x${string}`,
): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes' },
          { type: 'bytes32' },
          { type: 'bytes32' },
        ],
        [target, value, calldata, predecessor, salt],
      ),
    ),
  );
}

// Returns the identifier of an operation containing a batch of transactions.
// For OZ governors, predecessor is often zero and salt is often description hash.
// This is only intended to be used with OZ governors.
export function hashOperationBatchOz(
  targets: Address[],
  values: bigint[],
  calldatas: `0x${string}`[],
  predecessor: `0x${string}`,
  salt: `0x${string}`,
): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'address[]' },
          { type: 'uint256[]' },
          { type: 'bytes[]' },
          { type: 'bytes32' },
          { type: 'bytes32' },
        ],
        [targets, values, calldatas, predecessor, salt],
      ),
    ),
  );
}

export async function getImplementation(
  address: Address,
  blockTag: bigint,
): Promise<Address | null> {
  // First try calling an `implementation` method.
  const abi = ['function implementation() external view returns (address)'];
  try {
    const implementation = (await publicClient.readContract({
      address,
      abi,
      functionName: 'implementation',
      blockNumber: blockTag,
    })) as Address;
    return implementation;
  } catch {}

  // Next we try reading the EIP-1967 storage slot directly.
  try {
    const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
    const rawImplementation = await publicClient.getStorageAt({
      address,
      slot,
      blockNumber: blockTag,
    });
    if (!rawImplementation) return null;
    const implementation = getAddress(`0x${rawImplementation.slice(26)}`);
    if (implementation === zeroAddress) return null;
    return implementation;
  } catch {}

  return null;
}

export function formatProposalId(governorType: GovernorType, id: string | bigint) {
  const bigIntId = typeof id === 'string' ? BigInt(id) : id;
  if (governorType === 'oz') return `0x${bigIntId.toString(16)}`;
  return bigIntId.toString();
}
