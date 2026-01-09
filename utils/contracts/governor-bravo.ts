import { type Address, getContract, pad } from 'viem';
import { GOVERNOR_ABI } from '../abis/GovernorBravo';
import { publicClient } from '../clients/client';
import { getSolidityStorageSlotUint, to32ByteHexString } from '../utils';

export function governorBravo(address: Address) {
  return getContract({ address, abi: GOVERNOR_ABI, client: publicClient });
}

// All possible states a proposal might be in.
// These are defined by the `ProposalState` enum so when we fetch the state of a proposal ID
// we receive an integer response, and use this to map that integer to the state
export const PROPOSAL_STATES = {
  '0': 'Pending',
  '1': 'Active',
  '2': 'Canceled',
  '3': 'Defeated',
  '4': 'Succeeded',
  '5': 'Queued',
  '6': 'Expired',
  '7': 'Executed',
} as const;

/**
 * @notice Returns an object containing various GovernorBravo slots
 * @param id Proposal ID
 */
export function getBravoSlots(proposalId: bigint) {
  // Proposal struct slot offsets, based on the governor's proposal struct
  //     struct Proposal {
  //       uint id;
  //       address proposer;
  //       uint eta;
  //       address[] targets;
  //       uint[] values;
  //       string[] signatures;
  //       bytes[] calldatas;
  //       uint startBlock;
  //       uint endBlock;
  //       uint forVotes;
  //       uint againstVotes;
  //       uint abstainVotes;
  //       bool canceled;
  //       bool executed;
  //       mapping (address => Receipt) receipts;
  //     }
  const etaOffset = 2n;
  const targetsOffset = 3n;
  const valuesOffset = 4n;
  const signaturesOffset = 5n;
  const calldatasOffset = 6n;
  const forVotesOffset = 9n;
  const againstVotesOffset = 10n;
  const abstainVotesOffset = 11n;
  const canceledSlotOffset = 12n; // this is packed with `executed`

  // Compute and return slot numbers
  const proposalsMapSlot = '0xa'; // proposals ID to proposal struct mapping
  const proposalSlot = getSolidityStorageSlotUint(proposalsMapSlot, proposalId);
  return {
    proposalCount: to32ByteHexString('0x7'), // slot of the proposalCount storage variable
    votingToken: '0x9' as `0x${string}`, // slot of voting token, e.g. UNI, COMP  (getter is named after token, so can't generalize it that way),
    proposalsMap: proposalsMapSlot,
    proposal: proposalSlot,
    canceled: pad(`0x${(BigInt(proposalSlot) + canceledSlotOffset).toString(16)}`),
    eta: pad(`0x${(BigInt(proposalSlot) + etaOffset).toString(16)}`),
    forVotes: pad(`0x${(BigInt(proposalSlot) + forVotesOffset).toString(16)}`),
    againstVotes: pad(`0x${(BigInt(proposalSlot) + againstVotesOffset).toString(16)}`),
    abstainVotes: pad(`0x${(BigInt(proposalSlot) + abstainVotesOffset).toString(16)}`),
    targets: pad(`0x${(BigInt(proposalSlot) + targetsOffset).toString(16)}`),
    values: pad(`0x${(BigInt(proposalSlot) + valuesOffset).toString(16)}`),
    signatures: pad(`0x${(BigInt(proposalSlot) + signaturesOffset).toString(16)}`),
    calldatas: pad(`0x${(BigInt(proposalSlot) + calldatasOffset).toString(16)}`),
  };
}
