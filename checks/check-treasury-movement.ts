import { getAddress } from 'viem';
import type { ProposalCheck, TenderlySimulation } from '../types';
import {
  getOutgoingTreasuryAssetChanges,
  getTreasuryMovementConfig,
} from '../utils/treasury-movement';

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
  totalOutgoingUsd: number;
  transferCount: number;
  topRecipients: Array<{
    recipient: string;
    totalUsd: number;
    tokens: Array<{
      standard: string;
      symbol: string;
      decimals: number;
      amount: number;
      usd: number;
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
  name: 'Treasury movement check',
  async checkProposal(_, sim, deps) {
    const info: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    const { treasuryAddresses, thresholds } = getTreasuryMovementConfig({
      governorAddress: deps.governor.address,
      timelockAddress: deps.timelock?.address,
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
      return {
        info: [],
        warnings,
        errors,
        skipped: { reason: 'No outgoing treasury transfers detected' },
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

    if (unpricedTransferCount > 0) {
      warnings.push(
        `Some outgoing transfers were missing USD pricing; totals may be under-reported (${unpricedTransferCount} transfer${
          unpricedTransferCount === 1 ? '' : 's'
        })`,
      );
    }

    info.push('Treasury addresses considered:');
    for (const addr of treasuryAddresses) info.push(`• \`${getAddress(addr)}\``);

    info.push('');
    info.push(
      `Outgoing transfers (excluding treasury-to-treasury): ${formatUsd(totalUsd)} across ${
        outgoing.length
      } transfers`,
    );
    info.push(
      `Warning thresholds: ${formatUsd(thresholds.totalUsdWarning)} total, ${formatUsd(
        thresholds.recipientUsdWarning,
      )} per recipient`,
    );

    if (totalUsd >= thresholds.totalUsdWarning) {
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

    const recipients = [...byRecipient.values()].sort((a, b) => b.totalUsd - a.totalUsd);

    for (const entry of recipients) {
      if (entry.totalUsd >= thresholds.recipientUsdWarning) {
        warnings.push(
          `Recipient \`${entry.recipient}\` received ${formatUsd(entry.totalUsd)} from treasury (>${formatUsd(
            thresholds.recipientUsdWarning,
          )})`,
        );
      }
    }

    info.push('');
    info.push(`Top recipients by USD (top ${thresholds.topRecipients}):`);
    for (const entry of recipients.slice(0, thresholds.topRecipients)) {
      const tokenParts = [...entry.byToken.values()]
        .sort((a, b) => b.usd - a.usd)
        .map(
          (t) =>
            `${t.label}: ${new Intl.NumberFormat('en-US', {
              maximumFractionDigits: t.decimals <= 6 ? t.decimals : 4,
            }).format(t.amount)} (${formatUsd(t.usd)})`,
        )
        .join(', ');

      info.push(`• \`${entry.recipient}\`: ${formatUsd(entry.totalUsd)} (${tokenParts})`);
    }

    const data: TreasuryMovementCheckDataV1 = {
      type: 'treasuryMovement/v1',
      blockExplorerBaseUrl: deps.chainConfig.blockExplorer.baseUrl,
      treasuryAddresses: treasuryAddresses.map((a) => getAddress(a)),
      thresholds,
      totalOutgoingUsd: totalUsd,
      transferCount: outgoing.length,
      topRecipients: recipients.slice(0, thresholds.topRecipients).map((entry) => ({
        recipient: entry.recipient,
        totalUsd: entry.totalUsd,
        tokens: [...entry.byToken.values()]
          .sort((a, b) => b.usd - a.usd)
          .map((t) => ({
            standard: t.standard,
            symbol: t.label,
            decimals: t.decimals,
            amount: t.amount,
            usd: t.usd,
            usdPriced: t.usdPriced,
          })),
      })),
      unpricedTransferCount,
    };

    return { info, warnings, errors, data };
  },
};
