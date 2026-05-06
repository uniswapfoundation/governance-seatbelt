import { encodeFunctionData } from 'viem';
/**
 * @notice Simulation configuration file for proposal 96.
 *
 * Recalls all UNI delegated through the FranchiserFactory back to
 * the Governance Timelock. Targets the eight delegations established
 * in proposals 24 (Uniswap Foundation) and 51 (seven active delegates).
 */
import type { SimulationConfigNew } from '../types';
import FranchiserFactoryAbi from '../utils/abis/FranchiserFactoryAbi.json' assert { type: 'json' };

// Target contracts
const franchiserFactoryAddress = '0xf754A7E347F81cFdc70AF9FbCCe9Df3D826360FA' as const;
const timelockAddress = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' as const;

// Delegatee from proposal 24
const uniswapFoundationAddress = '0xA37131410A76791f4A0210e91EDD554d85aFb4d4' as const;

// Delegatees from proposal 51 (names per the 2026-05-06 forum post; addresses
// match the variable names in sims/franchiser-fundmany.sim.ts).
const anodeAddress = '0xECC2a9240268BC7a26386ecB49E1Befca2706AC9' as const; // formerly StableNode
const axiaNetworkAddress = '0xE93D59CC0bcECFD4ac204827eF67c5266079E2b5' as const; // formerly 404 DAO
const pGovAddress = '0x3fb19771947072629c8eee7995a2ef23b72d4c8a' as const;
const wintermuteAddress = '0xB933AEe47C438f22DE0747D57fc239FE37878Dd1' as const;
const keyrockAddress = '0x1855f41B8A86e701E33199DE7C25d3e3830698ba' as const; // gitleaks:allow
const kpkAddress = '0x8787FC2De4De95c53e5E3a4e5459247D9773ea52' as const; // formerly Karpatkey
const atiselstsAddress = '0xAac35d953Ef23aE2E61a866ab93deA6eC0050bcD' as const; // formerly Atis

const delegatees = [
  uniswapFoundationAddress,
  anodeAddress,
  axiaNetworkAddress,
  pGovAddress,
  wintermuteAddress,
  keyrockAddress,
  kpkAddress,
  atiselstsAddress,
];

const tos = delegatees.map(() => timelockAddress);

const call1 = {
  target: franchiserFactoryAddress,
  calldata: encodeFunctionData({
    abi: FranchiserFactoryAbi,
    functionName: 'recallMany',
    args: [delegatees, tos],
  }),
  value: 0n,
  signature: '',
};

const calls = [call1];

const description = `# Return 12.5M Delegated Tokens to the Governance Timelock

## Background & Motivation

These UNI were delegated from the treasury in 2022 and 2023 – "2.5M to the Uniswap Foundation and 10M to a group of active delegates" during periods of low governance participation. The delegations aimed to establish an active delegate base when quorum faced risks.

The governance landscape has transformed significantly. Token holders actively delegate voting power, and since DUNI's establishment, "passed proposals have averaged roughly 75 million votes in turnout, exceeding quorum by approximately 88%." Over 50 delegates now hold more than 1M UNI in voting power.

Undelegating these tokens addresses potential misalignment created by the Franchiser mechanism itself. While selected delegates participated actively in governance, the Franchiser didn't ensure structural alignment between voting power and economic exposure. This misalignment should not persist when the original implementation rationale no longer applies.

## Specification

This proposal invokes \`recallMany\` on the FranchiserFactory contract (0xf754A7E347F81cFdc70AF9FbCCe9Df3D826360FA) to retrieve all UNI currently delegated through the Franchiser system, returning the recalled tokens to the Governance Timelock (0x1a9C8182C09F50C8318d769245beA52c32BE35BC).

Eight Franchiser delegations are targeted for undelegation, totaling ~12.5M UNI across recipients: the Uniswap Foundation (2,500,001.19), Anode (2,499,858), Axia Network (2.25M), PGov (2.25M), Wintermute (1.9M), Keyrock (494K), KPK (453K), and Atiselsts.eth (154K).

The UF Franchiser has accumulated ~1.19 UNI of unrelated inbound transfers from third parties since it was funded. \`recall\` always sweeps the full balance (the Franchiser contract has no partial-recall option), so those stray amounts will return to the Treasury along with the original 2.5M.

The Timelock is not self-delegated, so this proposal results in a net decrease in active voting power across the ecosystem.`;

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorType: 'bravo',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  targets: calls.map((call) => call.target),
  values: calls.map((call) => call.value),
  signatures: calls.map((call) => call.signature as `0x${string}`),
  calldatas: calls.map((call) => call.calldata),
  description,
};
