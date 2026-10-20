import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const amount = z
  .string()
  .regex(/^[+-]?\d+(\.\d+)?$/)
  .nullable();
const rowSchema = z.object({
  address,
  tokenAddress: address.nullable(),
  symbol: z.string().nullable(),
  before: amount,
  after: amount,
  change: amount,
  eventNet: amount,
  difference: amount,
});
const balanceData = z.object({
  type: z.literal('treasuryBalances/v1'),
  gasSponsored: z.boolean(),
  blockExplorerBaseUrl: z
    .string()
    .url()
    .regex(/^https?:\/\//),
  treasuryAddresses: z.array(address),
  rows: z.array(rowSchema),
  checked: z.array(rowSchema),
  unavailableTokens: z.array(z.object({ tokenAddress: address, reason: z.string() })),
  historicalReplay: z.boolean(),
  notes: z.array(z.string()),
  transfers: z.array(
    z.object({
      from: address,
      to: address,
      tokenAddress: address.nullable(),
      symbol: z.string(),
      amount: z.string(),
    }),
  ),
});
type BalanceRow = z.infer<typeof rowSchema>;

function formatAmount(value: string | null) {
  if (value === null) return 'Unavailable';
  const [whole, fraction] = value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function AssetBalanceChanges({ data }: { data: unknown }) {
  const parsed = balanceData.safeParse(data);
  if (!parsed.success)
    return (
      <p className="text-sm text-muted-foreground">
        Balance details unavailable. Run the simulation again.
      </p>
    );
  const {
    rows,
    gasSponsored,
    checked,
    notes,
    blockExplorerBaseUrl,
    treasuryAddresses,
    transfers,
    unavailableTokens,
    historicalReplay,
  } = parsed.data;
  const isTreasury = (value: string) =>
    treasuryAddresses.some((address) => address.toLowerCase() === value.toLowerCase());
  const treasury = rows.filter((row) => isTreasury(row.address));
  const others = rows.filter((row) => !isTreasury(row.address));
  const unreadable = rows.filter((row) => row.before === null || row.after === null);
  const unobservedTreasuries = treasuryAddresses.filter(
    (address) =>
      ![...rows, ...checked].some((row) => row.address.toLowerCase() === address.toLowerCase()),
  );
  const mismatches = rows.filter((row) => row.eventNet !== null);
  function account(value: string) {
    return (
      <a
        className="text-muted-foreground hover:text-foreground hover:underline underline-offset-4 whitespace-nowrap font-mono text-xs"
        href={`${blockExplorerBaseUrl}/address/${value}`}
        title={value}
        target="_blank"
        rel="noreferrer"
      >
        {shortAddress(value)}
      </a>
    );
  }
  function asset(row: { symbol: string | null; tokenAddress: string | null }) {
    return (
      <div className="space-y-1.5">
        <div className="max-w-40 break-words font-semibold text-foreground">
          {row.symbol && !row.symbol.startsWith('0x')
            ? row.symbol
            : row.symbol?.includes('(raw units)')
              ? 'Token (raw units)'
              : 'Token'}
        </div>
        {row.tokenAddress ? (
          account(row.tokenAddress)
        ) : (
          <span className="text-xs text-muted-foreground">Native asset</span>
        )}
      </div>
    );
  }
  function balances(items: BalanceRow[], caption: string) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table className="[&_th]:px-4 [&_th]:h-11 [&_th]:text-xs [&_th]:font-medium [&_td]:px-4 [&_td]:py-4">
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="bg-muted/40">
            <TableRow>
              {['Asset', 'Account', 'Before', 'After', 'Net change'].map((label, i) => (
                <TableHead key={label} className={i > 1 ? 'text-right' : ''}>
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={`${row.tokenAddress}:${row.address}`}>
                <TableCell>{asset(row)}</TableCell>
                <TableCell>{account(row.address)}</TableCell>
                {[row.before, row.after, row.change].map((value, i) => (
                  <TableCell
                    key={i}
                    className={`text-right tabular-nums ${i === 2 ? 'font-semibold text-base' : 'text-muted-foreground'} ${value === null ? 'text-muted-foreground' : ''}`}
                  >
                    {formatAmount(value)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  return (
    <div className="space-y-8 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{checked.length} balances checked</span>
          {' · '}
          {new Set(checked.map((row) => row.address.toLowerCase())).size} accounts
          {' · '}
          {new Set(checked.map((row) => row.tokenAddress?.toLowerCase() ?? 'native')).size} assets
        </p>
        <Badge variant="outline" className="font-normal text-muted-foreground">
          USD unavailable
        </Badge>
      </div>
      <section className="space-y-3">
        <h4 className="text-base font-semibold tracking-tight">Treasury balances</h4>
        {treasury.length ? (
          balances(treasury, 'Treasury balances before and after simulation')
        ) : (
          <p className="text-muted-foreground">
            {treasuryAddresses.length
              ? 'No treasury balance changes detected in the available reads.'
              : 'No treasury accounts configured.'}
          </p>
        )}
      </section>
      {rows.some((row) => row.tokenAddress === null) && (
        <p className="text-xs text-muted-foreground">
          {gasSponsored
            ? 'Native balances exclude simulation gas funding.'
            : 'Native balance changes include execution fees.'}
        </p>
      )}
      {others.length > 0 && (
        <section className="space-y-3">
          <h4 className="font-semibold">Other affected accounts</h4>
          {balances(others, 'Other affected account balances')}
        </section>
      )}
      {mismatches.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-4">
          <h4 className="font-semibold">Balance / transfer mismatch</h4>
          {mismatches.map((row) => (
            <div key={`${row.tokenAddress}:${row.address}`} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.symbol || 'Token'}</span>
                {row.tokenAddress && account(row.tokenAddress)}
                <span className="text-muted-foreground">at</span> {account(row.address)}
              </div>
              <dl className="grid grid-cols-3 gap-3 rounded-lg bg-background/70 p-3">
                {[
                  ['Transfer net', row.eventNet],
                  ['Actual change', row.change],
                  ['Difference', row.difference],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 space-y-1">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-semibold tabular-nums break-all">{formatAmount(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Cause unknown. Fees, burns, mints, or other balance changes may explain the difference.
          </p>
        </section>
      )}
      <section className="rounded-xl border bg-muted/20 p-4 sm:p-5 space-y-3">
        <h4 className="font-semibold">What we couldn’t check</h4>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
          {unreadable.map((row) => (
            <li key={`${row.tokenAddress}:${row.address}`}>
              {row.symbol || 'Token'} {row.tokenAddress && account(row.tokenAddress)} at{' '}
              {account(row.address)}:{' '}
              {row.before === null && row.after === null
                ? 'before and after balances unavailable'
                : row.before === null
                  ? 'before balance unavailable'
                  : 'after balance unavailable'}
              .
            </li>
          ))}
          {unavailableTokens.map((token) => (
            <li key={token.tokenAddress}>
              {account(token.tokenAddress)}: {token.reason}.
            </li>
          ))}
          {unobservedTreasuries.map((address) => (
            <li key={address}>Treasury {account(address)}: no balance reads available.</li>
          ))}
          {historicalReplay && <li>Token balances at the exact historical transaction state.</li>}
          <li>Undetected accounts and tokens, including other holders affected by a rebase.</li>
          <li>USD values and risk thresholds: pricing unavailable.</li>
        </ul>
        {checked.length > 0 && !unreadable.length && !unavailableTokens.length && (
          <p className="text-xs text-muted-foreground">
            No failed balance reads among the detected account/asset pairs.
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h4 className="font-semibold">
          Observed transfers <span className="text-muted-foreground">({transfers.length})</span>
        </h4>
        <p className="text-xs text-muted-foreground">
          From events and native call traces. May differ from actual balance changes.
        </p>
        {transfers.length ? (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <Table className="[&_th]:px-4 [&_th]:h-11 [&_th]:text-xs [&_th]:font-medium [&_td]:px-4 [&_td]:py-4">
              <TableCaption className="sr-only">Observed transfers</TableCaption>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer, i) => (
                  <TableRow key={i}>
                    <TableCell>{asset(transfer)}</TableCell>
                    <TableCell>{account(transfer.from)}</TableCell>
                    <TableCell>{account(transfer.to)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(transfer.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground">
            No transfer events or native transfers detected. Balance changes may still appear above.
          </p>
        )}
      </section>
      <Accordion type="multiple" className="rounded-xl border px-4 [&>div:last-child]:border-b-0">
        <AccordionItem value="checked">
          <AccordionTrigger>All checked balances ({checked.length})</AccordionTrigger>
          <AccordionContent>
            {checked.length ? (
              balances(checked, 'Every successfully checked balance, including unchanged balances')
            ) : (
              <p>No before/after balance pair could be read.</p>
            )}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="method">
          <AccordionTrigger>How balances are calculated</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
