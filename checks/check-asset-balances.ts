import { formatUnits } from 'viem';
import type { ProposalCheck, ProposalData, TenderlySimulation } from '../types';
import { getSimulationPrices } from '../utils/clients/asset-prices';
import { getTreasuryMovementConfig } from '../utils/treasury-movement';

export const checkAssetBalances: ProposalCheck = {
  name: 'Asset balance changes',
  async checkProposal(_, sim, deps) {
    if (sim.provider !== 'rpc' && !sim.assetBalances)
      return {
        info: [],
        warnings: [],
        errors: [],
        skipped: { reason: 'Balance snapshots unavailable' },
      };
    return getAssetBalanceReport(sim, deps);
  },
};

export async function getAssetBalanceReport(sim: TenderlySimulation, deps: ProposalData) {
  const warnings = [...(sim.assetWarnings ?? [])];
  const transfers = sim.transaction.transaction_info.asset_changes ?? [];
  const prices = await getSimulationPrices(sim);
  const { treasuryAddresses } = getTreasuryMovementConfig({
    governorAddress: deps.governor.address,
    timelockAddress: deps.timelock?.address,
    chainId: Number(sim.transaction.network_id),
  });
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
  const allRows = snapshots.map((row) => {
    const delta =
      row.before === null || row.after === null ? null : BigInt(row.after) - BigInt(row.before);
    const eventNet = transfers
      .filter(
        (transfer) =>
          (transfer.token_info.contract_address?.toLowerCase() ?? 'native') ===
          (row.tokenAddress?.toLowerCase() ?? 'native'),
      )
      .reduce(
        (net, transfer) =>
          net +
          (transfer.to.toLowerCase() === row.address.toLowerCase()
            ? BigInt(transfer.raw_amount)
            : 0n) -
          (transfer.from.toLowerCase() === row.address.toLowerCase()
            ? BigInt(transfer.raw_amount)
            : 0n),
        0n,
      );
    const price = prices.quotes[row.tokenAddress?.toLowerCase() ?? 'native'];
    const usd =
      delta === 0n
        ? 0
        : delta === null || !price
          ? null
          : Number(formatUnits(delta, row.decimals)) * price.usd;
    return {
      usdChange: usd !== null && Number.isFinite(usd) ? usd : null,
      priceTimestamp: price?.timestamp ?? null,
      priceUnavailable:
        prices.unavailable[row.tokenAddress?.toLowerCase() ?? 'native'] ??
        (price ? null : 'Price unavailable.'),
      eventNet:
        row.tokenAddress && delta !== null && eventNet !== delta
          ? formatUnits(eventNet, row.decimals)
          : null,
      difference:
        row.tokenAddress && delta !== null && eventNet !== delta
          ? formatUnits(delta - eventNet, row.decimals)
          : null,
      moved: moved.has(key(row.address, row.tokenAddress)),
      address: row.address,
      tokenAddress: row.tokenAddress,
      symbol: /^0x/i.test(row.symbol) ? null : row.symbol.replace(/[|\n\r\[\]]/g, ' ').slice(0, 96),
      before: row.before === null ? null : formatUnits(BigInt(row.before), row.decimals),
      after: row.after === null ? null : formatUnits(BigInt(row.after), row.decimals),
      change: delta === null ? null : `${delta > 0n ? '+' : ''}${formatUnits(delta, row.decimals)}`,
    };
  });
  const rows = allRows.filter((row) => row.change !== '0' || row.moved);
  const notes = [
    'Read before and after simulation, including supplied state overrides.',
    'Accounts and tokens outside the execution trace and detected transfers were not checked. Rebases may affect other holders.',
    'USD estimates use DefiLlama quotes within one hour of simulation time (report time for future simulations), with at least 90% source confidence. Estimates are not execution prices.',
    sim.gasSponsored
      ? 'Simulation gas funding is excluded; unsupported fee accounting is unavailable.'
      : 'Native balance changes include execution fees.',
  ];
  const info = rows.length
    ? [
        '| Asset | Account | Before | After | Change | USD estimate |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        ...rows.map(
          (row) =>
            `| ${row.symbol ?? 'Token'}${row.tokenAddress ? ` (${row.tokenAddress})` : ''} | ${row.address} | ${row.before ?? 'Unavailable'} | ${row.after ?? 'Unavailable'} | ${row.change ?? 'Unavailable'} | ${row.usdChange === null ? 'Unavailable' : row.usdChange.toFixed(2)} |`,
        ),
      ]
    : ['No balance changes or transfers detected in checked accounts.'];
  info.push(
    '',
    ...rows
      .filter((row) => row.eventNet !== null)
      .map(
        (row) =>
          `${row.address} / ${row.symbol ?? row.tokenAddress}: transfer-event net ${row.eventNet}; measured change ${row.change}; difference ${row.difference}.`,
      ),
    ...notes,
  );
  info.push(
    `Read before and after: ${allRows.filter((row) => row.before !== null && row.after !== null).length} account/asset pairs.`,
  );
  for (const token of sim.assetBalanceUnavailableTokens ?? [])
    info.push(`Unavailable: ${token.tokenAddress}: ${token.reason}.`);
  if (!allRows.length) warnings.push('No balances could be checked.');
  for (const address of treasuryAddresses)
    if (!allRows.some((row) => row.address.toLowerCase() === address.toLowerCase()))
      warnings.push(`No balance reads for treasury ${address}.`);
  if (rows.some((row) => row.eventNet !== null))
    warnings.push('Transfer events differ from measured balance changes.');
  if (rows.some((row) => row.usdChange === null))
    warnings.push('Some balance changes could not be valued in USD.');
  return {
    info,
    warnings,
    errors: [],
    data: {
      type: 'assetBalances/v3',
      treasuryAddresses,
      gasSponsored: sim.gasSponsored ?? false,
      blockExplorerBaseUrl: deps.chainConfig.blockExplorer.baseUrl,
      rows,
      checked: allRows.filter((row) => row.before !== null && row.after !== null),
      unavailableTokens: sim.assetBalanceUnavailableTokens ?? [],
      historicalReplay: sim.assetBalanceHistoricalReplay ?? false,
      notes,
    },
  };
}
