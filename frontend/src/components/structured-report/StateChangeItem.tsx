'use client';

import { AddressChip } from '@/components/AddressChip';
import { Badge } from '@/components/ui/badge';
import type {
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { SimulationPlaceholderBadge } from './SimulationPlaceholderBadge';
import { getAddressLabel, isPlaceholderAddress } from './explorer';

export function StateChangeItem({
  stateChange,
  metadata,
}: {
  stateChange: SimulationStateChange;
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };
  const cleanValue = (value: string) => value.replace(/^"(.*)"$/, '$1');
  const oldValue = cleanValue(stateChange.oldValue);
  const newValue = cleanValue(stateChange.newValue);
  const raw = stateChange.storageDetails;
  const isRawSlot = /^0x[0-9a-fA-F]{64}$/.test(stateChange.key);
  const slotName = isRawSlot
    ? BigInt(stateChange.key) < 2n ** 64n
      ? `Slot ${BigInt(stateChange.key)}`
      : `Slot ${stateChange.key.slice(0, 10)}…${stateChange.key.slice(-6)}`
    : stateChange.key;
  const isV3Slot0 =
    stateChange.contract.toLowerCase().includes('uniswapv3pool') &&
    /^0x0{64}$/i.test(stateChange.key) &&
    [oldValue, newValue].every((value) => /^0x[0-9a-fA-F]{64}$/.test(value));
  const numericDelta =
    /^-?\d+$/.test(oldValue) && /^-?\d+$/.test(newValue)
      ? BigInt(newValue) - BigInt(oldValue)
      : null;
  const renderValue = (value: string) =>
    /^0x[0-9a-fA-F]{40}$/.test(value) ? (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <AddressChip
          address={value}
          label={
            value.toLowerCase() === '0x0000000000000000000000000000000000000000'
              ? 'Zero address'
              : (getAddressLabel(value, effectiveMetadata) ?? undefined)
          }
          blockExplorerUrl={effectiveMetadata.blockExplorerBaseUrl}
        />
        {isPlaceholderAddress(value, effectiveMetadata) && <SimulationPlaceholderBadge />}
      </span>
    ) : (
      <code className="text-xs break-all">{value}</code>
    );

  return (
    <div className="py-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="font-semibold text-sm break-all">{stateChange.label ?? slotName}</code>
        {stateChange.label && isRawSlot && (
          <Badge variant="secondary" className="font-mono text-muted-foreground">
            {slotName}
          </Badge>
        )}
        {numericDelta !== null && (
          <span className="text-xs text-muted-foreground">
            Delta {numericDelta > 0n ? '+' : ''}
            {numericDelta.toString()}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Before</dt>
        <dd className="min-w-0">{renderValue(oldValue)}</dd>
        <dt className="text-muted-foreground">After</dt>
        <dd className="min-w-0">{renderValue(newValue)}</dd>
      </dl>
      {(raw || isRawSlot) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
          <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] sm:grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3">
            {raw && (
              <>
                <dt className="text-muted-foreground">Label source</dt>
                <dd className="space-y-1">
                  <p>{raw.source}</p>
                  <p className="text-muted-foreground">
                    We rebuilt the verified source and matched the deployed code to identify this
                    field.
                  </p>
                </dd>
                <dt className="text-muted-foreground">Compiler version</dt>
                <dd className="font-mono break-all">{raw.compilerVersion}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Storage slot</dt>
            <dd className="font-mono break-all">{stateChange.key}</dd>
            {raw && (
              <>
                <dt className="text-muted-foreground">Raw before</dt>
                <dd className="font-mono break-all">{raw.oldValue}</dd>
                <dt className="text-muted-foreground">Raw after</dt>
                <dd className="font-mono break-all">{raw.newValue}</dd>
              </>
            )}
            {isV3Slot0 && (
              <>
                <dt className="text-muted-foreground">Decoded Uniswap V3 slot0</dt>
                <dd className="space-y-1 font-mono">
                  <div>
                    feeProtocol (token0, token1): ({Number((BigInt(oldValue) >> 232n) & 0xfn)},{' '}
                    {Number((BigInt(oldValue) >> 236n) & 0xfn)}) → (
                    {Number((BigInt(newValue) >> 232n) & 0xfn)},{' '}
                    {Number((BigInt(newValue) >> 236n) & 0xfn)})
                  </div>
                  <div>
                    unlocked: {String(((BigInt(oldValue) >> 240n) & 0xffn) === 1n)} →{' '}
                    {String(((BigInt(newValue) >> 240n) & 0xffn) === 1n)}
                  </div>
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
