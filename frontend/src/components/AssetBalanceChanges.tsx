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
  usdChange: z.number().finite().nullable().default(null),
  priceTimestamp: z.number().nullable().default(null),
  priceUnavailable: z.string().nullable().default(null),
});
const balanceData = z.object({
  type: z.enum(['treasuryBalances/v2', 'assetBalances/v3']),
  usdWarnings: z.array(z.string()).default([]),
  missingTreasuries: z.array(address).default([]),
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
});
type BalanceRow = z.infer<typeof rowSchema>;

function formatAmount(value: string | null) {
  if (value === null) return 'Unavailable';
  const sign = /^[+-]/.test(value) ? value[0] : '';
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  const rounded = cents + (fraction[2] >= '5' ? 1n : 0n);
  const display =
    cents === 0n && /[1-9]/.test(fraction)
      ? '<0.01'
      : `${(rounded / 100n).toLocaleString('en-US')}.${(rounded % 100n).toString().padStart(2, '0')}`;
  return (
    <span title={value}>
      {sign}
      {display}
    </span>
  );
}
const formatUsd = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : value !== 0 && Math.abs(value) < 0.01
      ? `${value < 0 ? '-' : '+'}<$0.01`
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          signDisplay: 'exceptZero',
        }).format(value);
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function AssetBalanceChanges({ data }: { data: unknown }) {
  const steps = z.object({ steps: z.array(balanceData) }).safeParse(data);
  if (steps.success)
    return (
      <div className="space-y-6">
        {steps.data.steps.map((step, index) => (
          <section key={index} className="space-y-2">
            <h4 className="text-sm font-medium">Call {index + 1}</h4>
            <AssetBalanceChanges data={step} />
          </section>
        ))}
      </div>
    );
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
    blockExplorerBaseUrl,
    treasuryAddresses,
    unavailableTokens,
    historicalReplay,
  } = parsed.data;
  const isTreasury = (value: string) =>
    treasuryAddresses.some((address) => address.toLowerCase() === value.toLowerCase());
  const treasuryOnly = parsed.data.type === 'treasuryBalances/v2';
  const unpriced = rows.filter((row) => row.usdChange === null);
  const missingPrices = unpriced.filter((row) => row.change !== null);
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
        <div className="max-w-40 whitespace-normal [overflow-wrap:anywhere] font-semibold text-foreground">
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
  function balances(items: BalanceRow[], caption: string, detailed = false) {
    return (
      <div className="min-w-0 overflow-hidden">
        <Table
          className={`${detailed ? '' : 'table-fixed sm:table-auto'} [&_th]:px-2 [&_th]:h-9 [&_th]:text-xs [&_th]:font-medium [&_td]:px-2 [&_td]:py-2`}
        >
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className={detailed ? '' : 'w-2/5 sm:w-auto'}>Asset</TableHead>
              <TableHead className={detailed ? '' : 'hidden sm:table-cell'}>Account</TableHead>
              {detailed && <TableHead className="text-right">Before</TableHead>}
              {detailed && <TableHead className="text-right">After</TableHead>}
              <TableHead className="text-right">Net change</TableHead>
              <TableHead className={`text-right ${detailed ? '' : 'hidden sm:table-cell'}`}>
                USD ≈
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={`${row.tokenAddress}:${row.address}`}>
                <TableCell className="whitespace-normal">
                  {asset(row)}
                  {!detailed && (
                    <div className="mt-1 text-xs text-muted-foreground sm:hidden">
                      {isTreasury(row.address) ? 'Treasury' : 'Account'}
                      <br />
                      {account(row.address)}
                    </div>
                  )}
                </TableCell>
                <TableCell className={detailed ? '' : 'hidden sm:table-cell'}>
                  {account(row.address)}
                  {!treasuryOnly && isTreasury(row.address) && (
                    <span className="block text-xs text-muted-foreground">Treasury</span>
                  )}
                </TableCell>
                {detailed &&
                  [row.before, row.after].map((value, i) => (
                    <TableCell key={i} className="text-right tabular-nums text-muted-foreground">
                      {formatAmount(value)}
                    </TableCell>
                  ))}
                <TableCell className="text-right tabular-nums whitespace-normal [overflow-wrap:anywhere]">
                  <span
                    className={`font-semibold text-base ${row.change === null ? 'text-muted-foreground' : ''}`}
                  >
                    {formatAmount(row.change)}
                  </span>
                  {!detailed && (
                    <span className="block text-xs text-muted-foreground sm:hidden">
                      {row.usdChange === null ? 'USD unavailable' : `≈ ${formatUsd(row.usdChange)}`}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums text-muted-foreground ${detailed ? '' : 'hidden sm:table-cell'}`}
                  title={
                    row.priceTimestamp
                      ? `DefiLlama quote: ${new Date(row.priceTimestamp * 1000).toISOString()}`
                      : (row.priceUnavailable ?? 'Price unavailable')
                  }
                >
                  {formatUsd(row.usdChange)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (treasuryOnly)
    return (
      <div className="min-w-0 space-y-2 text-sm [overflow-wrap:anywhere]">
        {rows.length > 0 ? (
          balances(rows, 'Measured treasury balance changes')
        ) : (
          <p>No treasury changes detected in available reads.</p>
        )}
        {unreadable.length > 0 && (
          <p className="font-medium">{unreadable.length} treasury balances unreadable.</p>
        )}
        {parsed.data.missingTreasuries.map((value) => (
          <p key={value}>Treasury {account(value)}: balance reads unavailable.</p>
        ))}
        {(rows.length > 0 || parsed.data.usdWarnings.length > 0) && (
          <Accordion type="single" collapsible>
            <AccordionItem value="treasury-details">
              <AccordionTrigger
                className={
                  parsed.data.usdWarnings.length ? 'text-amber-700 dark:text-amber-400' : ''
                }
              >
                {parsed.data.usdWarnings.length
                  ? `${parsed.data.usdWarnings.length} USD warning${parsed.data.usdWarnings.length === 1 ? '' : 's'}`
                  : 'Pricing & coverage'}
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-muted-foreground">
                {parsed.data.usdWarnings.map((warning) => (
                  <p key={warning} className="font-medium text-foreground">
                    {warning}
                  </p>
                ))}
                <p>
                  {gasSponsored
                    ? 'Simulation gas funding excluded.'
                    : 'Native changes include execution fees.'}{' '}
                  USD estimates use DefiLlama prices near simulation time. Missing prices are not
                  zero.
                </p>
                <p>
                  Only detected accounts and tokens were checked. See Asset balance changes for
                  mismatches and missing coverage.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    );
  return (
    <div className="min-w-0 space-y-4 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{checked.length} balances checked</span>
          {' · '}
          {new Set(checked.map((row) => row.address.toLowerCase())).size} accounts
          {' · '}
          {new Set(checked.map((row) => row.tokenAddress?.toLowerCase() ?? 'native')).size} assets
        </p>
        {rows.length > 0 && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {rows.length - unpriced.length}/{rows.length} changes valued in USD
          </Badge>
        )}
      </div>
      {rows.length ? (
        balances(rows, 'Measured asset balance changes')
      ) : (
        <p>No balance changes or transfers detected in checked accounts.</p>
      )}
      {mismatches.length > 0 && (
        <section className="border-l-2 border-amber-500 pl-3 space-y-2">
          <h4 className="font-semibold">Balance / event mismatch</h4>
          {mismatches.map((row) => (
            <div key={`${row.tokenAddress}:${row.address}`} className="space-y-1">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{row.symbol || 'Token'}</span>
                {row.tokenAddress && account(row.tokenAddress)}
                <span className="text-muted-foreground">at</span> {account(row.address)}
              </p>
              <p className="tabular-nums">
                Contract reported {formatAmount(row.eventNet)} · Balance change{' '}
                {formatAmount(row.change)} ·{' '}
                <strong>Difference {formatAmount(row.difference)}</strong>
              </p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Cause of the difference is unknown.</p>
        </section>
      )}
      <Accordion type="multiple">
        {(missingPrices.length > 0 ||
          unreadable.length > 0 ||
          unavailableTokens.length > 0 ||
          unobservedTreasuries.length > 0 ||
          historicalReplay) && (
          <AccordionItem value="coverage">
            <AccordionTrigger>
              Couldn’t check
              {missingPrices.length > 0 ? ` · ${missingPrices.length} unpriced changes` : ''}
              {unreadable.length > 0 ? ` · ${unreadable.length} unreadable balances` : ''}
              {unavailableTokens.length > 0
                ? ` · ${unavailableTokens.length} tokens unavailable`
                : ''}
              {unobservedTreasuries.length > 0
                ? ` · ${unobservedTreasuries.length} unread treasuries`
                : ''}
              {historicalReplay ? ' · historical token state' : ''}
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
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
                {historicalReplay && (
                  <li>Token balances at the exact historical transaction state.</li>
                )}
                {missingPrices.map((row) => (
                  <li key={`price:${row.tokenAddress}:${row.address}`}>
                    {row.symbol || 'Token'} at {account(row.address)}: USD unavailable.{' '}
                    {row.priceUnavailable}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        )}
        <AccordionItem value="checked">
          <AccordionTrigger>Before &amp; after balances</AccordionTrigger>
          <AccordionContent>
            {checked.length ? (
              balances(
                checked,
                'Every successfully checked balance, including unchanged balances',
                true,
              )
            ) : (
              <p>No before/after balance pair could be read.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Only accounts and tokens found in this simulation are checked.{' '}
              {gasSponsored
                ? 'Simulation gas funding is excluded.'
                : 'Native changes include execution fees.'}{' '}
              USD estimates: DefiLlama.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
