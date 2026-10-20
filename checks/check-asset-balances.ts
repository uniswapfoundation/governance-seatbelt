import { formatUnits } from 'viem';
import type { ProposalCheck } from '../types';

export const checkAssetBalances: ProposalCheck = {
  name: 'Verified asset balance changes',
  async checkProposal(_, sim, deps) {
    const warnings = [...(sim.assetWarnings ?? [])];
    if (!sim.assetBalances)
      return {
        info: [],
        warnings,
        errors: [],
        skipped: { reason: 'Balance snapshots unavailable' },
      };
    const verified = sim.assetBalances.filter((row) => row.before !== null && row.after !== null);
    const changed = sim.assetBalances.filter(
      (row) => row.before !== row.after || row.before === null,
    );
    const info = [
      `Verified ${verified.length} account/asset balances in the simulated state. Coverage is limited to observed accounts and detected tokens.`,
      'Balances use the simulation baseline, including supplied state overrides, rather than necessarily live balances.',
      sim.gasSponsored
        ? 'Execution gas is sponsored. Verified caller balances exclude simulation gas funding; unsupported normalization is shown as unavailable.'
        : 'Native caller balance changes include execution fees; transfer totals do not.',
      '',
    ];
    if (!changed.length)
      info.push(
        'No balance changes among the verified account/asset pairs. Other balances were not checked.',
      );
    else {
      info.push('| Account | Asset | Before | After | Change |', '| --- | --- | --- | --- | --- |');
      for (const row of changed) {
        const before =
          row.before === null ? 'Unavailable' : formatUnits(BigInt(row.before), row.decimals);
        const after =
          row.after === null ? 'Unavailable' : formatUnits(BigInt(row.after), row.decimals);
        const delta =
          row.before === null || row.after === null ? null : BigInt(row.after) - BigInt(row.before);
        const change =
          delta === null
            ? 'Unavailable'
            : `${delta > 0n ? '+' : ''}${formatUnits(delta, row.decimals)}`;
        const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
        const label =
          row.symbol === row.tokenAddress
            ? short(row.symbol)
            : row.symbol.replace(/[|\n\r\[\]]/g, ' ');
        const asset = row.tokenAddress
          ? `[${label}](${deps.chainConfig.blockExplorer.baseUrl}/address/${row.tokenAddress})`
          : row.symbol;
        info.push(`| \`${row.address}\` | ${asset} | ${before} | ${after} | ${change} |`);
      }
    }
    return { info, warnings, errors: [] };
  },
};
