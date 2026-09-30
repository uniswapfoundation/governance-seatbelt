import { AddressChip } from '@/components/AddressChip';
import type {
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { InfoIcon } from 'lucide-react';
import { SimulationPlaceholderBadge } from './SimulationPlaceholderBadge';
import { StateChangeItem } from './StateChangeItem';
import { isPlaceholderAddress } from './explorer';

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
  const changeCount = stateChanges.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-muted-foreground pb-2 border-b border-muted">
        <span>
          <strong className="text-foreground">{contractCount}</strong>{' '}
          {contractCount === 1 ? 'contract' : 'contracts'} modified
        </span>
        <span>•</span>
        <span>
          <strong className="text-foreground">{changeCount}</strong>{' '}
          {changeCount === 1 ? 'change' : 'changes'}
        </span>
      </div>

      <div className="divide-y divide-border">
        {Object.entries(groupedChanges).map(([contractKey, changes]) => {
          const [contractName, contractAddress] = contractKey.split('|');
          return (
            <section key={contractKey} className="py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2">
                <h3 className="text-base font-semibold break-all">
                  {contractName === 'balances'
                    ? 'Token Balances'
                    : contractName === 'storage'
                      ? 'Contract Storage'
                      : contractName === 'code'
                        ? 'Contract Code'
                        : contractName}
                </h3>
                {contractAddress && (
                  <>
                    <AddressChip
                      address={contractAddress}
                      blockExplorerUrl={effectiveMetadata.blockExplorerBaseUrl}
                    />
                    {isPlaceholderAddress(contractAddress, effectiveMetadata) && (
                      <SimulationPlaceholderBadge />
                    )}
                  </>
                )}
              </div>
              <div className="divide-y divide-border/50 px-3">
                {changes.map((change, index) => (
                  <StateChangeItem
                    key={`state-${change.contract}-${change.key}-${index}`}
                    stateChange={change}
                    metadata={effectiveMetadata}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
