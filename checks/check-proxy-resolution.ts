import type { PublicClient } from 'viem';
import { getAddress } from 'viem';
import { toAddressLink } from '../presentation/report';
import type { CallTrace, ProposalCheck, TenderlySimulation } from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { getSourcifyVerification } from '../utils/clients/sourcify';
import { detectProxy } from '../utils/contracts/proxy';

type VerificationSource = 'sourcify' | 'blockExplorer' | 'unverified';

async function getVerificationSource(
  address: string,
  chainId: number,
): Promise<{ source: VerificationSource; detail?: string }> {
  try {
    const sourcify = await getSourcifyVerification(address, chainId);
    if (sourcify.status === 'verified') return { source: 'sourcify', detail: sourcify.match };
  } catch {
    // ignore and fall back
  }

  const explorerVerified = await BlockExplorerFactory.isContractVerified(address, chainId);
  if (explorerVerified) return { source: 'blockExplorer' };

  return { source: 'unverified' };
}

/**
 * Detect and resolve proxy implementations for proposal targets.
 *
 * - Detects EIP-1967 proxies via the implementation slot
 * - Detects Beacon proxies via the beacon slot + beacon.implementation()
 * - Prefers Sourcify-verified implementations and warns on unverified implementations
 */
export const checkProxyResolution: ProposalCheck = {
  name: 'Resolves proxy implementations (EIP-1967 + Beacon)',
  async checkProposal(proposal, sim, deps, l2Simulations) {
    const info: string[] = [];
    const warnings: string[] = [];

    const chainId = deps.chainConfig.chainId;
    const baseUrl = deps.chainConfig.blockExplorer.baseUrl;
    const publicClient = deps.publicClient as PublicClient;
    const blockNumber = BigInt(sim.transaction.block_number);

    const isL2Chain = chainId !== 1;
    const hasL2Data = l2Simulations && l2Simulations.length > 0;

    const targets = isL2Chain && hasL2Data ? extractL2Targets(l2Simulations) : proposal.targets;
    const uniqueTargets = Array.from(new Set(targets.map((t) => getAddress(t))));

    for (const target of uniqueTargets) {
      const code = await publicClient.getCode({ address: target, blockNumber });
      if (!code || code === '0x') continue;

      const detection = await detectProxy(target, publicClient, blockNumber);
      if (detection.kind === 'none') continue;

      const proxyLink = toAddressLink(detection.proxy, baseUrl);

      if (detection.kind === 'eip1967') {
        const impl = detection.implementation;
        if (!impl) {
          warnings.push(
            `EIP-1967 proxy detected at ${proxyLink} but implementation slot is empty.`,
          );
          continue;
        }

        const implLink = toAddressLink(impl, baseUrl);
        const verification = await getVerificationSource(impl, chainId);
        info.push(
          `EIP-1967 proxy ${proxyLink} → implementation ${implLink} (${formatVerification(verification)})`,
        );

        if (verification.source === 'unverified') {
          warnings.push(
            `Unverified implementation for EIP-1967 proxy ${proxyLink}: ${implLink} is not verified on Sourcify or the configured block explorer.`,
          );
        }
        continue;
      }

      const beaconLink = toAddressLink(detection.beacon, baseUrl);
      const impl = detection.implementation;
      if (!impl) {
        warnings.push(
          `Beacon proxy detected at ${proxyLink} with beacon ${beaconLink} but failed to resolve beacon implementation().`,
        );
        continue;
      }

      const implLink = toAddressLink(impl, baseUrl);
      const verification = await getVerificationSource(impl, chainId);
      info.push(
        `Beacon proxy ${proxyLink} → beacon ${beaconLink} → implementation ${implLink} (${formatVerification(
          verification,
        )})`,
      );

      if (verification.source === 'unverified') {
        warnings.push(
          `Unverified implementation for Beacon proxy ${proxyLink}: ${implLink} is not verified on Sourcify or the configured block explorer.`,
        );
      }
    }

    if (info.length === 0 && warnings.length === 0) {
      return {
        info: [],
        warnings: [],
        errors: [],
        skipped: { reason: 'No proxies detected among proposal targets' },
      };
    }

    return { info, warnings, errors: [] };
  },
};

function formatVerification(v: { source: VerificationSource; detail?: string }) {
  if (v.source === 'sourcify') return `verified via Sourcify${v.detail ? ` (${v.detail})` : ''}`;
  if (v.source === 'blockExplorer') return 'verified via block explorer';
  return 'unverified';
}

function extractTargetsFromCalls(calls: CallTrace[], targets: Set<string>): void {
  for (const call of calls || []) {
    if (call.to && call.input && call.input !== '0x') {
      targets.add(call.to.toLowerCase());
    }

    if (call.calls) {
      extractTargetsFromCalls(call.calls, targets);
    }
  }
}

function extractL2Targets(
  l2Simulations: Array<{ chainId: number; sim: TenderlySimulation }>,
): `0x${string}`[] {
  const targets = new Set<string>();

  for (const l2Sim of l2Simulations) {
    if (l2Sim.sim?.transaction?.transaction_info?.call_trace?.calls) {
      extractTargetsFromCalls(l2Sim.sim.transaction.transaction_info.call_trace.calls, targets);
    }

    if (l2Sim.sim?.transaction?.to) {
      targets.add(l2Sim.sim.transaction.to.toLowerCase());
    }
  }

  return Array.from(targets).map((addr) => getAddress(addr));
}
