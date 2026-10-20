import { z } from 'zod';
import type { TenderlySimulation } from '../../types';

// Explicit chain identities: never price an asset by symbol alone.
const chains: Record<number, [string, string]> = {
  1: ['ethereum', 'ethereum'],
  5042: ['arc', 'usd-coin'],
  10: ['optimism', 'ethereum'],
  42161: ['arbitrum', 'ethereum'],
  8453: ['base', 'ethereum'],
  130: ['unichain', 'ethereum'],
  480: ['worldchain', 'ethereum'],
  1868: ['soneium', 'ethereum'],
  4663: ['robinhood', 'ethereum'],
  4326: ['megaeth', 'ethereum'],
  57073: ['ink', 'ethereum'],
  60808: ['bob', 'ethereum'],
  196: ['xlayer', 'okb'],
  143: ['monad', 'monad'],
  7777777: ['zora', 'ethereum'],
  56: ['bsc', 'binancecoin'],
  137: ['polygon', 'polygon-ecosystem-token'],
  43114: ['avax', 'avalanche-2'],
  42220: ['celo', 'celo'],
};
const quoteSchema = z.object({
  price: z.number().finite().positive(),
  timestamp: z.number().int().positive(),
  confidence: z.number().min(0.9).max(1),
  decimals: z.number().int().min(0).max(255).optional(),
});
export type AssetPrice = { usd: number; timestamp: number };
export type AssetPrices = {
  quotes: Record<string, AssetPrice>;
  unavailable: Record<string, string>;
};
const requests = new WeakMap<TenderlySimulation, Promise<AssetPrices>>();

/** Both checks use the same quotes. Missing, stale or ambiguous prices never become zero. */
export function getSimulationPrices(sim: TenderlySimulation): Promise<AssetPrices> {
  let result = requests.get(sim);
  if (!result) {
    result = fetchPrices(sim);
    requests.set(sim, result);
  }
  return result;
}

async function fetchPrices(sim: TenderlySimulation): Promise<AssetPrices> {
  const result: AssetPrices = { quotes: {}, unavailable: {} };
  const tokens = new Map<string, number>();
  for (const row of sim.assetBalances ?? [])
    tokens.set(row.tokenAddress?.toLowerCase() ?? 'native', row.decimals);
  const chain = chains[Number(sim.transaction.network_id)];
  const timestamp = Math.min(
    Math.floor(new Date(sim.transaction.timestamp!).getTime() / 1000),
    Math.floor(Date.now() / 1000),
  );
  if (!chain || !Number.isFinite(timestamp) || timestamp <= 0) {
    for (const token of tokens.keys())
      result.unavailable[token] = !chain
        ? 'Price source does not support this chain.'
        : 'Simulation time unavailable.';
    return result;
  }
  const entries = [...tokens.entries()];
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    const coinId = (token: string) =>
      token === 'native' ? `coingecko:${chain[1]}` : `${chain[0]}:${token}`;
    try {
      const response = await fetch(
        `https://coins.llama.fi/prices/historical/${timestamp}/${batch.map(([token]) => coinId(token)).join(',')}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error('Price service unavailable');
      const body = z
        .object({ coins: z.record(z.string(), z.unknown()) })
        .parse(await response.json());
      for (const [token, decimals] of batch) {
        const quote = quoteSchema.safeParse(body.coins[coinId(token)]);
        if (!quote.success) result.unavailable[token] = 'No reliable price returned.';
        else if (Math.abs(quote.data.timestamp - timestamp) > 3600)
          result.unavailable[token] = 'Price is more than one hour from the simulation time.';
        else if (token !== 'native' && quote.data.decimals !== decimals)
          result.unavailable[token] = 'Price metadata does not match token decimals.';
        else result.quotes[token] = { usd: quote.data.price, timestamp: quote.data.timestamp };
      }
    } catch {
      for (const [token] of batch) result.unavailable[token] = 'Price service unavailable.';
    }
  }
  return result;
}
