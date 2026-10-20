import { formatUnits } from 'viem';
import type { ProposalCheck } from '../types';

export const checkAssetBalances: ProposalCheck = {
  name: 'Asset balance changes',
  async checkProposal(_, sim, deps) {
    const warnings = [...(sim.assetWarnings ?? [])];
    const transfers = sim.transaction.transaction_info.asset_changes ?? [];
    if (!sim.assetBalances && !transfers.length)
      return {
        info: [],
        warnings,
        errors: [],
        skipped: { reason: 'Balance snapshots unavailable' },
      };
    const snapshots = [...(sim.assetBalances ?? [])];
    const key = (address: string, token: string | null) =>
      `${address.toLowerCase()}:${token?.toLowerCase() ?? 'native'}`;
    const moved = new Set<string>();
    // Keep observed transfers visible even when balance reads are unavailable or net to zero.
    for (const transfer of transfers) {
      const token = transfer.token_info;
      const tokenAddress = token.contract_address ?? null;
      if (!tokenAddress && token.standard !== 'NativeCurrency') continue;
      for (const address of [transfer.from, transfer.to]) {
        if (/^0x0{40}$/i.test(address)) continue;
        const id = key(address, tokenAddress);
        moved.add(id);
        if (!snapshots.some((row) => key(row.address, row.tokenAddress) === id))
          snapshots.push({
            address,
            tokenAddress,
            symbol: token.symbol,
            decimals: token.decimals,
            before: null,
            after: null,
          });
      }
    }
    const shown = snapshots.filter(
      (row) =>
        row.before !== row.after ||
        row.before === null ||
        moved.has(key(row.address, row.tokenAddress)),
    );
    const rows = shown.map((row) => {
      const delta =
        row.before === null || row.after === null ? null : BigInt(row.after) - BigInt(row.before);
      return {
        address: row.address,
        tokenAddress: row.tokenAddress,
        symbol: /^0x/i.test(row.symbol)
          ? null
          : row.symbol.replace(/[|\n\r\[\]]/g, ' ').slice(0, 96),
        before: row.before === null ? null : formatUnits(BigInt(row.before), row.decimals),
        after: row.after === null ? null : formatUnits(BigInt(row.after), row.decimals),
        change:
          delta === null ? null : `${delta > 0n ? '+' : ''}${formatUnits(delta, row.decimals)}`,
      };
    });
    const notes = [
      'Read before and after simulation, including supplied state overrides.',
      'Partial coverage: only observed accounts and detected tokens. Unavailable means a balance could not be read.',
      'USD pricing is unavailable; dollar thresholds were not evaluated.',
      sim.gasSponsored
        ? 'Simulation gas funding is excluded; unsupported fee accounting is unavailable.'
        : 'Native balance changes include execution fees.',
    ];
    const info = rows.length
      ? [
          '| Asset | Account | Before | After | Change |',
          '| --- | --- | ---: | ---: | ---: |',
          ...rows.map(
            (row) =>
              `| ${row.symbol ?? 'Token'}${row.tokenAddress ? ` (${row.tokenAddress})` : ''} | ${row.address} | ${row.before ?? 'Unavailable'} | ${row.after ?? 'Unavailable'} | ${row.change ?? 'Unavailable'} |`,
          ),
        ]
      : ['No balance changes or transfers detected in checked accounts.'];
    info.push('', ...notes);
    return {
      info,
      warnings,
      errors: [],
      data: {
        type: 'assetBalances/v1',
        blockExplorerBaseUrl: deps.chainConfig.blockExplorer.baseUrl,
        rows,
        notes,
      },
    };
  },
};
