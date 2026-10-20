import { getAddress } from 'viem';
import type { ProposalCheck, TenderlySimulation } from '../types';
import {
  getOutgoingTreasuryAssetChanges,
  getTreasuryMovementConfig,
} from '../utils/treasury-movement';
import { getAssetBalanceReport } from './check-asset-balances';

type TenderlyAssetChange = NonNullable<
  NonNullable<TenderlySimulation['transaction']['transaction_info']['asset_changes']>[number]
>;

type TreasuryMovementCheckDataV1 = {
  type: 'treasuryMovement/v1';
  blockExplorerBaseUrl: string;
  treasuryAddresses: string[];
  thresholds: {
    totalUsdWarning: number;
    recipientUsdWarning: number;
    topRecipients: number;
  };
  totalOutgoingUsd: number | null;
  transferCount: number;
  topRecipients: Array<{
    recipient: string;
    totalUsd: number | null;
    tokens: Array<{
      standard: string;
      symbol: string;
      decimals: number;
      amount: number;
      usd: number | null;
      usdPriced: boolean;
    }>;
  }>;
  unpricedTransferCount: number;
};

function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function safeParseFloat(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenKey(change: TenderlyAssetChange) {
  const standard =
    change.token_info.standard === 'NativeCurrency' ? 'ETH' : change.token_info.symbol;
  return `${change.token_info.standard}:${standard}:${change.token_info.decimals}`;
}

export const checkTreasuryMovement: ProposalCheck = {
  name: 'Treasury movement',
  async checkProposal(_proposal, sim, deps) {
    if (sim.provider === 'rpc') {
      const { treasuryAddresses, thresholds } = getTreasuryMovementConfig({
        governorAddress: deps.governor.address,
        timelockAddress: deps.timelock?.address,
        chainId: Number(sim.transaction.network_id),
      });
      if (!treasuryAddresses.length)
        return {
          info: [],
          warnings: [],
          errors: [],
          skipped: {
            reason: `No treasury addresses configured for chain ${sim.transaction.network_id}`,
          },
        };
      const balances = await getAssetBalanceReport(sim, deps);
      const isTreasury = (address: string) =>
        treasuryAddresses.some((treasury) => treasury.toLowerCase() === address.toLowerCase());
      const rows = balances.data.rows.filter(
        (row) => isTreasury(row.address) && row.change !== '0',
      );
      const changes = rows.filter((row) => row.change !== null && row.change !== '0');
      const missingTreasuries = treasuryAddresses.filter(
        (address) =>
          !sim.assetBalances?.some((row) => row.address.toLowerCase() === address.toLowerCase()),
      );
      const incomplete =
        balances.data.unavailableTokens.length > 0 ||
        missingTreasuries.length > 0 ||
        rows.some((row) => row.change === null || (row.change !== '0' && row.usdChange === null));
      const decreases = changes.reduce((sum, row) => sum + Math.max(0, -(row.usdChange ?? 0)), 0);
      const warnings = changes.map(
        (row) => `Treasury ${row.address}: ${row.change} ${row.symbol ?? 'Token'}.`,
      );
      const usdWarnings: string[] = [];
      if (incomplete)
        usdWarnings.push(
          'Treasury valuation is incomplete. Full USD thresholds were not evaluated.',
        );
      if (decreases >= thresholds.totalUsdWarning)
        usdWarnings.push(
          `Measured treasury decreases exceed the ${formatUsd(thresholds.totalUsdWarning)} warning threshold${incomplete ? ' even with incomplete pricing' : ''}.`,
        );
      // Positive balances are account increases, not proof of a transfer from the treasury.
      const recipients = new Map<string, number>();
      for (const row of balances.data.rows) {
        if (!isTreasury(row.address) && row.usdChange !== null && row.usdChange > 0)
          recipients.set(row.address, (recipients.get(row.address) ?? 0) + row.usdChange);
      }
      for (const [address, usd] of recipients) {
        if (usd >= thresholds.recipientUsdWarning)
          usdWarnings.push(
            `Account ${address} gains approximately ${formatUsd(usd)}, above the ${formatUsd(thresholds.recipientUsdWarning)} account warning threshold; treasury attribution is not established.`,
          );
      }
      if (missingTreasuries.length)
        warnings.push(`No balance reads for treasury accounts: ${missingTreasuries.join(', ')}.`);
      return {
        info: [
          ...changes.map(
            (row) =>
              `${row.symbol ?? 'Token'} at ${row.address}: ${row.before} → ${row.after} (${row.change}); USD estimate: ${row.usdChange === null ? 'Unavailable' : formatUsd(row.usdChange)}.`,
          ),
          'Measured decreases include internal treasury movements and execution fees; they are not a total of external transfers.',
          ...balances.data.notes,
        ],
        warnings: [...warnings, ...usdWarnings],
        errors: [],
        data: {
          ...balances.data,
          type: 'treasuryBalances/v2',
          usdWarnings,
          rows,
          checked: balances.data.checked.filter((row) => isTreasury(row.address)),
          missingTreasuries,
          measuredDecreaseUsd: incomplete ? null : decreases,
          thresholds,
        },
      };
    }
    if (sim.transaction.transaction_info.asset_changes == null) {
      return {
        info: [],
        warnings: ['Asset transfer enrichment is unavailable from the simulation provider.'],
        errors: [],
        skipped: { reason: 'Provider did not return asset changes' },
      };
    }
    const info: string[] = [];
    const warnings: string[] = [...(sim.assetWarnings ?? [])];
    const errors: string[] = [];

    const { treasuryAddresses, thresholds } = getTreasuryMovementConfig({
      governorAddress: deps.governor.address,
      timelockAddress: deps.timelock?.address,
      chainId: Number(sim.transaction.network_id),
    });

    if (treasuryAddresses.length === 0) {
      return {
        info: [],
        warnings,
        errors,
        skipped: { reason: 'No treasury addresses configured' },
      };
    }

    const outgoing = getOutgoingTreasuryAssetChanges({ sim, treasuryAddresses });
    if (outgoing.length === 0) {
      const data: TreasuryMovementCheckDataV1 = {
        type: 'treasuryMovement/v1',
        blockExplorerBaseUrl: deps.chainConfig.blockExplorer.baseUrl,
        treasuryAddresses: treasuryAddresses.map((a) => getAddress(a)),
        thresholds,
        totalOutgoingUsd: 0,
        transferCount: 0,
        topRecipients: [],
        unpricedTransferCount: 0,
      };

      return {
        info: [
          'Treasury addresses considered:',
          ...treasuryAddresses.map((addr) => `• \`${getAddress(addr)}\``),
          '',
          'No outgoing treasury transfers detected',
        ],
        warnings,
        errors,
        data,
      };
    }

    let unpricedTransferCount = 0;
    const totalUsd = outgoing.reduce((sum, c) => {
      const usd = safeParseFloat((c as { dollar_value?: unknown }).dollar_value);
      if (usd == null) {
        unpricedTransferCount += 1;
        return sum;
      }
      return sum + usd;
    }, 0);

    const usdUnavailable = unpricedTransferCount > 0;
    if (usdUnavailable) {
      warnings.push(
        'USD valuation is unavailable or incomplete. Dollar totals and USD risk thresholds were not evaluated.',
      );
    }

    info.push('Treasury addresses considered:');
    for (const addr of treasuryAddresses) info.push(`• \`${getAddress(addr)}\``);

    info.push('');
    info.push(
      `Outgoing transfers (excluding treasury-to-treasury): ${usdUnavailable ? 'USD unavailable' : formatUsd(totalUsd)} across ${
        outgoing.length
      } transfers`,
    );
    info.push(
      `Warning thresholds: ${formatUsd(thresholds.totalUsdWarning)} total, ${formatUsd(
        thresholds.recipientUsdWarning,
      )} per recipient`,
    );

    if (!usdUnavailable && totalUsd >= thresholds.totalUsdWarning) {
      warnings.push(
        `Total outgoing treasury transfers exceeded threshold (${formatUsd(totalUsd)} > ${formatUsd(
          thresholds.totalUsdWarning,
        )})`,
      );
    }

    // Aggregate by recipient (and keep a token breakdown)
    type TokenSummary = {
      label: string;
      decimals: number;
      amount: number;
      usd: number;
      standard: string;
      usdPriced: boolean;
    };

    type RecipientSummary = {
      recipient: string;
      changes: TenderlyAssetChange[];
      totalUsd: number;
      byToken: Map<string, TokenSummary>;
    };

    const byRecipient = new Map<string, RecipientSummary>();

    for (const change of outgoing) {
      const recipient = getAddress(change.to);
      let entry = byRecipient.get(recipient);
      if (!entry) {
        entry = {
          recipient,
          changes: [],
          totalUsd: 0,
          byToken: new Map<string, TokenSummary>(),
        };
        byRecipient.set(recipient, entry);
      }

      entry.changes.push(change);
      const usd = safeParseFloat((change as { dollar_value?: unknown }).dollar_value);
      if (usd != null) entry.totalUsd += usd;

      const key = tokenKey(change);
      const label =
        change.token_info.standard === 'NativeCurrency' ? 'ETH' : change.token_info.symbol;
      const tokenEntry: TokenSummary = entry.byToken.get(key) ?? {
        label,
        decimals: change.token_info.decimals,
        amount: 0,
        usd: 0,
        standard: change.token_info.standard,
        usdPriced: true,
      };

      const amount = safeParseFloat((change as { amount?: unknown }).amount);
      if (amount != null) tokenEntry.amount += amount;

      if (usd == null) {
        tokenEntry.usdPriced = false;
      } else {
        tokenEntry.usd += usd;
      }
      entry.byToken.set(key, tokenEntry);
    }

    const recipients = [...byRecipient.values()].sort((a, b) =>
      usdUnavailable ? a.recipient.localeCompare(b.recipient) : b.totalUsd - a.totalUsd,
    );

    for (const entry of recipients) {
      if (!usdUnavailable && entry.totalUsd >= thresholds.recipientUsdWarning) {
        warnings.push(
          `Recipient \`${entry.recipient}\` received ${formatUsd(entry.totalUsd)} from treasury (>${formatUsd(
            thresholds.recipientUsdWarning,
          )})`,
        );
      }
    }

    info.push('');
    info.push(
      usdUnavailable
        ? `Recipients (first ${thresholds.topRecipients}; USD ranking unavailable):`
        : `Top recipients by USD (top ${thresholds.topRecipients}):`,
    );
    for (const entry of recipients.slice(0, thresholds.topRecipients)) {
      const tokenParts = [...entry.byToken.values()]
        .sort((a, b) => b.usd - a.usd)
        .map(
          (t) =>
            `${t.label}: ${new Intl.NumberFormat('en-US', {
              maximumFractionDigits: t.decimals <= 6 ? t.decimals : 4,
            }).format(t.amount)} (${t.usdPriced ? formatUsd(t.usd) : 'USD unavailable'})`,
        )
        .join(', ');

      info.push(
        `• \`${entry.recipient}\`: ${usdUnavailable ? 'USD unavailable' : formatUsd(entry.totalUsd)} (${tokenParts})`,
      );
    }

    const data: TreasuryMovementCheckDataV1 = {
      type: 'treasuryMovement/v1',
      blockExplorerBaseUrl: deps.chainConfig.blockExplorer.baseUrl,
      treasuryAddresses: treasuryAddresses.map((a) => getAddress(a)),
      thresholds,
      totalOutgoingUsd: usdUnavailable ? null : totalUsd,
      transferCount: outgoing.length,
      topRecipients: recipients.slice(0, thresholds.topRecipients).map((entry) => ({
        recipient: entry.recipient,
        totalUsd: usdUnavailable ? null : entry.totalUsd,
        tokens: [...entry.byToken.values()]
          .sort((a, b) => b.usd - a.usd)
          .map((t) => ({
            standard: t.standard,
            symbol: t.label,
            decimals: t.decimals,
            amount: t.amount,
            usd: t.usdPriced ? t.usd : null,
            usdPriced: t.usdPriced,
          })),
      })),
      unpricedTransferCount,
    };

    return { info, warnings, errors, data };
  },
};
