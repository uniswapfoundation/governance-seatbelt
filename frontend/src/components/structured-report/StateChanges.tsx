import type {
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { ExternalLinkIcon, InfoIcon } from 'lucide-react';
import { SimulationPlaceholderBadge } from './SimulationPlaceholderBadge';
import { StateChangeItem } from './StateChangeItem';
import { buildAddressLink, isPlaceholderAddress } from './explorer';

interface StateChangesProps {
  stateChanges: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}

export function StateChanges({ stateChanges, metadata }: StateChangesProps) {
  if (stateChanges.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground border border-muted rounded-md">
        <InfoIcon className="h-4 w-4 mr-2" />
        <span>No state changes found in the report</span>
      </div>
    );
  }

  const effectiveMetadata = metadata || { proposalId: '', proposer: '' as `0x${string}` };

  const groupedChanges = stateChanges.reduce<Record<string, SimulationStateChange[]>>(
    (acc, change) => {
      const contractName = change.contract;
      const key = `${contractName}|${change.contractAddress || ''}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(change);
      return acc;
    },
    {},
  );

  const contractCount = Object.keys(groupedChanges).length;
  const slotCount = stateChanges.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 text-sm text-muted-foreground pb-2 border-b border-muted">
        <span>
          <strong className="text-foreground">{contractCount}</strong>{' '}
          {contractCount === 1 ? 'contract' : 'contracts'} modified
        </span>
        <span>•</span>
        <span>
          <strong className="text-foreground">{slotCount}</strong>{' '}
          {slotCount === 1 ? 'storage slot' : 'storage slots'} changed
        </span>
      </div>

      {Object.entries(groupedChanges).map(([contractKey, changes]) => {
        const [contractName, contractAddress] = contractKey.split('|');
        return (
          <div key={contractKey} className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">
                {contractName === 'balances'
                  ? 'Token Balances'
                  : contractName === 'storage'
                    ? 'Contract Storage'
                    : contractName === 'code'
                      ? 'Contract Code'
                      : contractName}
                {contractAddress && (
                  <span className="ml-2 text-sm font-normal inline-flex items-center gap-2">
                    at{' '}
                    <a
                      href={buildAddressLink(contractAddress, effectiveMetadata)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs bg-muted-foreground/10 px-1 py-0.5 rounded hover:underline inline-flex items-center"
                    >
                      {contractAddress}
                      <ExternalLinkIcon className="h-3 w-3 ml-1" />
                    </a>
                    {isPlaceholderAddress(contractAddress, effectiveMetadata) && (
                      <SimulationPlaceholderBadge />
                    )}
                  </span>
                )}
              </h3>
            </div>
            <div className="space-y-3 pl-2">
              {changes.map((change, index) => (
                <StateChangeItem
                  key={`state-${change.contract}-${change.key}-${index}`}
                  stateChange={change}
                  metadata={effectiveMetadata}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
