import { type PublicClient, getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { CallTrace, ProposalCheck, TenderlySimulation } from '../types';

/**
 * Check all targets with code if they contain selfdestruct.
 */
export const checkTargetsNoSelfdestruct: ProposalCheck = {
  name: 'Check all targets do not contain selfdestruct',
  async checkProposal(proposal, _, deps, l2Simulations) {
    const isL2Chain = deps.chainConfig?.chainId !== 1;
    const hasL2Data = l2Simulations && l2Simulations.length > 0;

    let targets: `0x${string}`[];

    if (isL2Chain && hasL2Data) {
      // For L2 chains, extract targets from cross-chain simulation data
      targets = extractL2Targets(l2Simulations);
      if (targets.length === 0) {
        return {
          info: ['No L2 targets found in cross-chain simulation'],
          warnings: [],
          errors: [],
        };
      }
    } else {
      // For mainnet, use proposal targets
      targets = proposal.targets
        .filter((addr, i, targets) => targets.indexOf(addr) === i)
        .map(getAddress);
    }

    const blockExplorerUrl = deps.chainConfig.blockExplorer.baseUrl;
    const { info, warn, error } = await checkNoSelfdestructs(
      [deps.governor.address, deps.timelock.address],
      targets,
      deps.publicClient,
      blockExplorerUrl,
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
    const blockExplorerUrl = deps.chainConfig.blockExplorer.baseUrl;
    const { info, warn, error } = await checkNoSelfdestructs(
      [deps.governor.address, deps.timelock.address],
      sim.transaction.addresses.map(getAddress),
      deps.publicClient,
      blockExplorerUrl,
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
  blockExplorerUrl: string,
): Promise<{ info: string[]; warn: string[]; error: string[] }> {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  for (const addr of addresses) {
    const status = await checkNoSelfdestruct(trustedAddrs, addr, publicClient);
    const address = toAddressLink(addr, blockExplorerUrl);
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

/**
 * Extract unique target addresses from L2 simulations
 */
function extractL2Targets(
  l2Simulations: Array<{ chainId: number; sim: TenderlySimulation }>,
): `0x${string}`[] {
  const targets = new Set<string>();

  for (const l2Sim of l2Simulations) {
    if (l2Sim.sim?.transaction?.transaction_info?.call_trace?.calls) {
      // Extract target addresses from L2 calls
      extractTargetsFromCalls(l2Sim.sim.transaction.transaction_info.call_trace.calls, targets);
    }

    // Also include the main transaction target if it exists
    if (l2Sim.sim?.transaction?.to) {
      targets.add(l2Sim.sim.transaction.to.toLowerCase());
    }
  }

  return Array.from(targets).map((addr) => getAddress(addr));
}

/**
 * Recursively extract target addresses from call traces
 */
function extractTargetsFromCalls(calls: CallTrace[], targets: Set<string>): void {
  for (const call of calls || []) {
    if (call.to && call.input && call.input !== '0x') {
      targets.add(call.to.toLowerCase());
    }

    // Recursively process subcalls
    if (call.calls) {
      extractTargetsFromCalls(call.calls, targets);
    }
  }
}
