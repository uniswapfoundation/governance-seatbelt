import { getAddress } from 'viem';
import type { Address } from 'viem';
import type { TenderlySimulation } from '../types';

export type TreasuryMovementThresholds = {
  totalUsdWarning?: number;
  recipientUsdWarning?: number;
  topRecipients?: number;
};

export type DaoTreasuryMovementConfig = {
  includeTimelockAsTreasury?: boolean;
  treasuryAddresses?: Address[];
  thresholds?: TreasuryMovementThresholds;
};

const DEFAULT_THRESHOLDS: Required<TreasuryMovementThresholds> = {
  totalUsdWarning: 1_000_000,
  recipientUsdWarning: 250_000,
  topRecipients: 5,
};

/**
 * Configure per-governor settings here (keyed by governor address).
 * Defaults are intentionally conservative and can be overridden per DAO.
 */
const CONFIG_BY_GOVERNOR: Record<string, DaoTreasuryMovementConfig> = {
  // Uniswap Governor
  [getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3')]: {
    includeTimelockAsTreasury: true,
    thresholds: DEFAULT_THRESHOLDS,
  },
};

export function getTreasuryMovementConfig({
  governorAddress,
  timelockAddress,
}: {
  governorAddress: Address;
  timelockAddress?: Address;
}) {
  const configured = CONFIG_BY_GOVERNOR[getAddress(governorAddress)] ?? {};
  const includeTimelock = configured.includeTimelockAsTreasury ?? true;

  const treasuryAddresses = new Set<Address>();
  if (includeTimelock && timelockAddress) treasuryAddresses.add(getAddress(timelockAddress));
  for (const addr of configured.treasuryAddresses ?? []) treasuryAddresses.add(getAddress(addr));

  const thresholds: Required<TreasuryMovementThresholds> = {
    totalUsdWarning: configured.thresholds?.totalUsdWarning ?? DEFAULT_THRESHOLDS.totalUsdWarning,
    recipientUsdWarning:
      configured.thresholds?.recipientUsdWarning ?? DEFAULT_THRESHOLDS.recipientUsdWarning,
    topRecipients: configured.thresholds?.topRecipients ?? DEFAULT_THRESHOLDS.topRecipients,
  };

  return {
    treasuryAddresses: [...treasuryAddresses],
    thresholds,
  };
}

type TenderlyAssetChange = NonNullable<
  NonNullable<TenderlySimulation['transaction']['transaction_info']['asset_changes']>[number]
>;

function safeGetAddress(value: unknown): Address | null {
  if (typeof value !== 'string') return null;
  try {
    return getAddress(value) as Address;
  } catch {
    return null;
  }
}

export function getOutgoingTreasuryAssetChanges({
  sim,
  treasuryAddresses,
}: {
  sim: TenderlySimulation;
  treasuryAddresses: Address[];
}) {
  const assetChanges = sim.transaction.transaction_info.asset_changes;
  if (!assetChanges || assetChanges.length === 0) return [];

  const treasury = new Set(treasuryAddresses.map((a) => getAddress(a)));

  return assetChanges.filter((change): change is TenderlyAssetChange => {
    const from = safeGetAddress((change as { from?: unknown }).from);
    const to = safeGetAddress((change as { to?: unknown }).to);
    if (!from || !to) return false;

    const isFromTreasury = treasury.has(from);
    const isToTreasury = treasury.has(to);

    if (!isFromTreasury) return false;
    if (isToTreasury) return false;

    // Include all outgoing asset changes; some standards may not have pricing, which is
    // handled by the check layer (so we can warn about under-reporting).
    return true;
  });
}
