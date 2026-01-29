'use client';

import type {
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';
import { SimulationPlaceholderBadge } from './SimulationPlaceholderBadge';
import { buildAddressLink, isPlaceholderAddress } from './explorer';

export function StateChangeItem({
  stateChange,
  metadata,
}: {
  stateChange: SimulationStateChange;
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const cleanValue = (value: string): string => {
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }
    return value;
  };

  const oldValueCleaned = cleanValue(stateChange.oldValue);
  const newValueCleaned = cleanValue(stateChange.newValue);

  const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);
  const isDecimalInteger = (value: string) => /^-?\d+$/.test(value);

  const isUniswapV3Slot0Change =
    stateChange.contract.toLowerCase().includes('uniswapv3pool') &&
    isHex32(oldValueCleaned) &&
    isHex32(newValueCleaned) &&
    /^0x0{64}$/i.test(stateChange.key);

  const isNumericChange = isDecimalInteger(oldValueCleaned) && isDecimalInteger(newValueCleaned);
  const isAddressChange = oldValueCleaned.startsWith('0x') && newValueCleaned.startsWith('0x');
  const isBooleanChange =
    (oldValueCleaned === 'true' || oldValueCleaned === 'false') &&
    (newValueCleaned === 'true' || newValueCleaned === 'false');

  const getDifference = () => {
    if (isUniswapV3Slot0Change) {
      try {
        const oldSlot0 = BigInt(oldValueCleaned);
        const newSlot0 = BigInt(newValueCleaned);

        const feeProtocolOld = Number((oldSlot0 >> 232n) & 0xffn);
        const feeProtocolNew = Number((newSlot0 >> 232n) & 0xffn);

        const feeProtocol0Old = feeProtocolOld & 0x0f;
        const feeProtocol1Old = feeProtocolOld >> 4;
        const feeProtocol0New = feeProtocolNew & 0x0f;
        const feeProtocol1New = feeProtocolNew >> 4;

        const unlockedOld = ((oldSlot0 >> 240n) & 0xffn) === 1n;
        const unlockedNew = ((newSlot0 >> 240n) & 0xffn) === 1n;

        return (
          <div className="bg-muted p-3 rounded-md mt-4 space-y-2">
            <div className="text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Decoded (Uniswap V3 slot0)</span>
            </div>
            <div className="text-xs font-mono">
              feeProtocol (raw): {feeProtocolOld} → {feeProtocolNew}
            </div>
            <div className="text-xs font-mono">
              feeProtocol (token0, token1): ({feeProtocol0Old}, {feeProtocol1Old}) → (
              {feeProtocol0New}, {feeProtocol1New})
            </div>
            <div className="text-xs font-mono">
              unlocked: {String(unlockedOld)} → {String(unlockedNew)}
            </div>
          </div>
        );
      } catch {
        // fall through to generic rendering
      }
    }

    if (isNumericChange) {
      try {
        const oldNum = BigInt(oldValueCleaned);
        const newNum = BigInt(newValueCleaned);
        const diff = newNum - oldNum;

        const isPositive = diff > BigInt(0);
        const isNegative = diff < BigInt(0);
        const absDiff = isNegative ? -diff : diff;

        const formattedDiff = absDiff.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        let percentageDisplay = '';

        if (oldNum !== BigInt(0)) {
          try {
            const oldNumDigits = oldNum.toString().length;
            const diffDigits = diff.toString().length;

            if (oldNumDigits > 15 || diffDigits > 15) {
              const oldNumPrefix = Number(oldNum.toString().substring(0, 5));
              const diffPrefix = Number(diff.toString().substring(0, 5));

              const percentChange = Math.abs((diffPrefix / oldNumPrefix) * 100);

              if (percentChange > 0.1 && percentChange < 10000) {
                percentageDisplay = `${isPositive ? '+' : '-'}${Math.round(percentChange)}%`;
              }
            } else {
              const percentChange = Math.abs(Number((diff * BigInt(100)) / oldNum));
              if (percentChange > 0 && percentChange < 10000) {
                percentageDisplay = `${isPositive ? '+' : '-'}${percentChange}%`;
              }
            }
          } catch {
            // ignore
          }
        }

        return (
          <div className="bg-muted p-3 rounded-md mt-4">
            <div className="text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Change</span>
              <div className="flex flex-col items-end">
                <span
                  className={`font-bold ${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''}`}
                >
                  {isPositive ? '+' : isNegative ? '-' : ''}
                  {formattedDiff}
                </span>
                {percentageDisplay && (
                  <span
                    className={`text-xs ${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''}`}
                  >
                    {percentageDisplay}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      } catch (error) {
        console.error('Error calculating difference:', error);
        return (
          <div className="bg-muted p-3 rounded-md mt-4">
            <div className="text-sm text-muted-foreground">Change</div>
            <div className="font-medium text-xs">Value changed</div>
          </div>
        );
      }
    }

    if (isBooleanChange) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Change</span>
            <span
              className={`font-bold ${newValueCleaned === 'true' ? 'text-green-600' : 'text-red-600'}`}
            >
              {oldValueCleaned} → {newValueCleaned}
            </span>
          </div>
        </div>
      );
    }

    if (isAddressChange) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm text-muted-foreground">Address Change</div>
          <div className="font-medium text-xs">
            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-2 flex-wrap">
                From:{' '}
                <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">
                  <a
                    href={buildAddressLink(oldValueCleaned, effectiveMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline inline-flex items-center"
                  >
                    {oldValueCleaned}
                    <ExternalLinkIcon className="h-3 w-3 ml-1" />
                  </a>
                </code>
                {isPlaceholderAddress(oldValueCleaned, effectiveMetadata) && (
                  <SimulationPlaceholderBadge />
                )}
              </span>
              <span className="inline-flex items-center gap-2 flex-wrap">
                To:{' '}
                <code className="bg-muted-foreground/10 px-1 py-0.5 rounded">
                  <a
                    href={buildAddressLink(newValueCleaned, effectiveMetadata)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline inline-flex items-center"
                  >
                    {newValueCleaned}
                    <ExternalLinkIcon className="h-3 w-3 ml-1" />
                  </a>
                </code>
                {isPlaceholderAddress(newValueCleaned, effectiveMetadata) && (
                  <SimulationPlaceholderBadge />
                )}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (isHex32(oldValueCleaned) && isHex32(newValueCleaned)) {
      return (
        <div className="bg-muted p-3 rounded-md mt-4">
          <div className="text-sm text-muted-foreground">Change</div>
          <div className="font-medium text-xs">Storage slot value changed</div>
        </div>
      );
    }

    return (
      <div className="bg-muted p-3 rounded-md mt-4">
        <div className="text-sm text-muted-foreground">Change</div>
        <div className="font-medium text-xs">Value changed</div>
      </div>
    );
  };

  return (
    <div className="border border-muted rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer flex justify-between items-start"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2">
          {isHex32(stateChange.key) ? (
            <div className="text-xs bg-muted-foreground/10 px-2 py-1 rounded text-muted-foreground">
              {isUniswapV3Slot0Change ? 'slot0' : 'Slot'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted-foreground/20 px-2 py-1 rounded">
            {stateChange.key}
          </code>
          {isExpanded ? (
            <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="p-5 pt-0 pl-11 text-sm border-t border-muted bg-muted/10">
          {getDifference()}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground font-medium">Old Value: </span>
              <div className="font-mono text-xs break-all mt-2 bg-muted p-3 rounded">
                {stateChange.oldValue}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">New Value: </span>
              <div className="font-mono text-xs break-all mt-2 bg-muted p-3 rounded">
                {stateChange.newValue}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
