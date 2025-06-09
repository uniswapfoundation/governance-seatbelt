import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { ProposalCheck } from '../types';

/**
 * Check all targets with code if they contain selfdestruct.
 */
export const checkTargetsNoSelfdestruct: ProposalCheck = {
  name: 'Check all targets do not contain selfdestruct',
  async checkProposal(proposal, _, deps) {
    const uniqueTargets = proposal.targets.filter(
      (addr, i, targets) => targets.indexOf(addr) === i,
    );
    const { info, warn, error } = await checkNoSelfdestructs(
      [deps.governor.address, deps.timelock.address],
      uniqueTargets.map(getAddress),
      deps.publicClient,
    );
    return { info, warnings: warn, errors: error };
  },
};

/**
 * Check all touched contracts with code if they contain selfdestruct.
 */
export const checkTouchedContractsNoSelfdestruct: ProposalCheck = {
  name: 'Check all touched contracts do not contain selfdestruct',
  async checkProposal(_, sim, deps) {
    const { info, warn, error } = await checkNoSelfdestructs(
      [deps.governor.address, deps.timelock.address],
      sim.transaction.addresses.map(getAddress),
      deps.publicClient,
    );
    return { info, warnings: warn, errors: error };
  },
};

/**
 * For a given simulation response, check if a set of addresses contain selfdestruct.
 */
async function checkNoSelfdestructs(
  trustedAddrs: `0x${string}`[],
  addresses: `0x${string}`[],
  publicClient: PublicClient,
): Promise<{ info: string[]; warn: string[]; error: string[] }> {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  for (const addr of addresses) {
    const status = await checkNoSelfdestruct(trustedAddrs, addr, publicClient);
    const address = toAddressLink(addr, false);
    if (status === 'eoa') info.push(`${address}: EOA`);
    else if (status === 'empty') warn.push(`${address}: EOA (may have code later)`);
    else if (status === 'safe') info.push(`${address}: Contract (looks safe)`);
    else if (status === 'delegatecall') warn.push(`${address}: Contract (with DELEGATECALL)`);
    else if (status === 'trusted') info.push(`${address}: Trusted contract (not checked)`);
    else error.push(`${address}: Contract (with SELFDESTRUCT)`);
  }
  return { info, warn, error };
}

const STOP = 0x00;
const JUMPDEST = 0x5b;
const PUSH1 = 0x60;
const PUSH32 = 0x7f;
const RETURN = 0xf3;
const REVERT = 0xfd;
const INVALID = 0xfe;
const SELFDESTRUCT = 0xff;
const DELEGATECALL = 0xf4;

const isHalting = (opcode: number): boolean =>
  [STOP, RETURN, REVERT, INVALID, SELFDESTRUCT].includes(opcode);
const isPUSH = (opcode: number): boolean => opcode >= PUSH1 && opcode <= PUSH32;

/**
 * For a given address, check if it's an EOA, a safe contract, or a contract contain selfdestruct.
 */
async function checkNoSelfdestruct(
  trustedAddrs: `0x${string}`[],
  addr: `0x${string}`,
  publicClient: PublicClient,
): Promise<'safe' | 'eoa' | 'empty' | 'selfdestruct' | 'delegatecall' | 'trusted'> {
  if (trustedAddrs.map((addr) => addr.toLowerCase()).includes(addr.toLowerCase())) return 'trusted';

  const [code, nonce] = await Promise.all([
    publicClient.getCode({ address: addr }),
    publicClient.getTransactionCount({ address: addr }),
  ]);

  if (!code) return 'empty';

  // If there is no code and nonce is > 0 then it's an EOA.
  // If nonce is 0 it is an empty account that might have code later.
  // A contract might have nonce > 0, but then it will have code.
  // If it had code, but was selfdestructed, the nonce should be reset to 0.
  if (code === '0x') return nonce > 0 ? 'eoa' : 'empty';

  // Detection logic from https://github.com/MrLuit/selfdestruct-detect
  const bytecode = Buffer.from(code.substring(2), 'hex');
  let halted = false;
  let delegatecall = false;
  for (let index = 0; index < bytecode.length; index++) {
    const opcode = bytecode[index];
    if (opcode === SELFDESTRUCT && !halted) {
      return 'selfdestruct';
    }
    if (opcode === DELEGATECALL && !halted) {
      delegatecall = true;
    }
    if (opcode === JUMPDEST) {
      halted = false;
    }
    if (isHalting(opcode)) {
      halted = true;
    }
    if (isPUSH(opcode)) {
      index += opcode - PUSH1 + 0x01;
    }
  }

  return delegatecall ? 'delegatecall' : 'safe';
}
