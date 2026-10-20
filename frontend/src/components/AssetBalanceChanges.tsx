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
        className="text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground whitespace-nowrap font-mono text-xs"
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
      <div className="space-y-1">
        <div className="max-w-40 break-words font-medium">
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
      <div className="rounded-md border bg-background">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
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
                    className={`text-right tabular-nums ${i === 2 ? 'font-semibold' : ''} ${value === null ? 'text-muted-foreground' : ''}`}
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
    <div className="space-y-6 text-sm">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{checked.length} balances read before and after</Badge>
          <Badge variant="outline">USD unavailable</Badge>
        </div>
        <p className="text-muted-foreground">
          {new Set(checked.map((row) => row.address.toLowerCase())).size} accounts ·{' '}
          {new Set(checked.map((row) => row.tokenAddress?.toLowerCase() ?? 'native')).size} assets
          checked. See the full list below.
        </p>
      </div>
      <section className="space-y-3">
        <h4 className="font-semibold">Treasury balance changes</h4>
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
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <h4 className="font-semibold">Transfers don’t explain these balance changes</h4>
          {mismatches.map((row) => (
            <p key={`${row.tokenAddress}:${row.address}`}>
              {account(row.address)} · {row.symbol || 'Token'}{' '}
              {row.tokenAddress && account(row.tokenAddress)}: transfer events imply{' '}
              <strong>{formatAmount(row.eventNet)}</strong>; balance changed by{' '}
              <strong>{formatAmount(row.change)}</strong> (difference {formatAmount(row.difference)}
              ).
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            A fee, burn, mint, or another balance change may explain the difference. Its cause has
            not been established.
          </p>
        </section>
      )}
      <section className="space-y-2">
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
          <li>
            Accounts and tokens we didn’t detect during execution, including other holders affected
            by a rebase.
          </li>
          <li>USD values and dollar-based risk thresholds: no pricing source.</li>
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
          Reported by transfer events or native call traces. These amounts can differ from the
          balances above.
        </p>
        {transfers.length ? (
          <div className="rounded-md border bg-background">
            <Table>
              <TableCaption className="sr-only">Observed transfers</TableCaption>
              <TableHeader>
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
      <Accordion type="multiple">
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
