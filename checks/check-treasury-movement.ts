import { getAddress } from 'viem';
import type { ProposalCheck, TenderlySimulation } from '../types';
import {
  getOutgoingTreasuryAssetChanges,
  getTreasuryMovementConfig,
} from '../utils/treasury-movement';

type TenderlyAssetChange = NonNullable<
  NonNullable<TenderlySimulation['transaction']['transaction_info']['asset_changes']>[number]
>;

function formatUsd(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function sumUsd(changes: TenderlyAssetChange[]) {
  return changes.reduce((sum, c) => sum + (Number.parseFloat(c.dollar_value) || 0), 0);
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

    const totalUsd = sumUsd(outgoing);

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
      entry.totalUsd += Number.parseFloat(change.dollar_value) || 0;

      const key = tokenKey(change);
      const label =
        change.token_info.standard === 'NativeCurrency' ? 'ETH' : change.token_info.symbol;
      const tokenEntry: TokenSummary = entry.byToken.get(key) ?? {
        label,
        decimals: change.token_info.decimals,
        amount: 0,
        usd: 0,
        standard: change.token_info.standard,
      };

      tokenEntry.amount += Number.parseFloat(change.amount) || 0;
      tokenEntry.usd += Number.parseFloat(change.dollar_value) || 0;
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

    return { info, warnings, errors };
  },
};
