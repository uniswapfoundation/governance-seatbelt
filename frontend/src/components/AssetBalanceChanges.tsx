import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z
  .string()
  .regex(/^[+-]?\d+(\.\d+)?$/)
  .nullable();
const balanceData = z.object({
  type: z.literal('assetBalances/v1'),
  blockExplorerBaseUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//),
  rows: z.array(
    z.object({
      address,
      tokenAddress: address.nullable(),
      symbol: z.string().nullable(),
      before: amount,
      after: amount,
      change: amount,
    }),
  ),
  notes: z.array(z.string()),
});

function formatAmount(value: string | null) {
  if (value === null) return 'Unavailable';
  const [whole, fraction] = value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function AssetBalanceChanges({ data, warnings }: { data: unknown; warnings: string[] }) {
  const parsed = balanceData.safeParse(data);
  if (!parsed.success)
    return (
      <p className="text-sm text-muted-foreground">
        Balance details unavailable. Run the simulation again.
      </p>
    );
  const { rows, notes, blockExplorerBaseUrl } = parsed.data;
  const unavailable = rows.filter((row) => row.change === null).length;
  const mismatch = warnings.some((warning) => warning.includes('differs from Transfer events'));
  const linkClass =
    'text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground';
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Partial coverage</span>
        <span aria-hidden="true">·</span>
        <span>USD unavailable</span>
        {unavailable > 0 && (
          <span>
            · {unavailable} unreadable {unavailable === 1 ? 'balance' : 'balances'}
          </span>
        )}
      </div>
      {mismatch && (
        <p className="font-medium">Transfer events differ from the balance changes below.</p>
      )}
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Asset balances before and after simulated execution
            </caption>
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {['Asset', 'Account', 'Before', 'After', 'Change'].map((label, i) => (
                  <th
                    key={label}
                    scope="col"
                    className={`px-4 py-3 font-medium ${i < 2 ? 'text-left' : 'text-right'}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={`${row.tokenAddress ?? 'native'}:${row.address}`}
                  className="hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <div className="max-w-48 break-words font-semibold">
                      {row.symbol || 'Token'}
                    </div>
                    {row.tokenAddress ? (
                      <a
                        className={`${linkClass} whitespace-nowrap text-xs`}
                        href={`${blockExplorerBaseUrl}/address/${row.tokenAddress}`}
                        title={row.tokenAddress}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(row.tokenAddress)}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Native asset</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      className={`${linkClass} whitespace-nowrap font-mono text-xs`}
                      href={`${blockExplorerBaseUrl}/address/${row.address}`}
                      title={row.address}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(row.address)}
                    </a>
                  </td>
                  {[row.before, row.after, row.change].map((value, i) => (
                    <td
                      key={i}
                      className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${i === 2 ? 'font-semibold' : ''} ${value === null ? 'text-muted-foreground' : ''}`}
                    >
                      {formatAmount(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No balance changes or transfers detected in checked accounts.</p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer w-fit underline underline-offset-4">
          Coverage and calculation details
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-4">
          {[...new Set([...notes, ...warnings])].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
