import { Badge } from '@/components/ui/badge';
import { ArrowRightIcon, ExternalLinkIcon, KeyIcon, ShieldIcon, UserIcon } from 'lucide-react';
import type { Address } from 'viem';

type PermissionsDiffItem =
  | {
      kind: 'ownership_transferred';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    }
  | {
      kind: 'role_granted' | 'role_revoked';
      contractAddress: Address;
      contractName?: string;
      role: { id: `0x${string}`; name: string | null };
      account: Address;
      sender: Address;
    }
  | {
      kind: 'timelock_admin_changed';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    }
  | {
      kind: 'timelock_pending_admin_changed';
      contractAddress: Address;
      contractName?: string;
      previous?: Address;
      next: Address;
      via: 'event' | 'state_diff' | 'event+state_diff';
    };

interface PermissionsDiffProps {
  items: PermissionsDiffItem[];
}

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function AddressDisplay({ address, label }: { address: string; label?: string }) {
  const truncated = truncateAddress(address);

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <a
        href={`https://etherscan.io/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-sm bg-muted px-2 py-1.5 rounded hover:bg-muted-foreground/20 transition-colors"
        title={address}
      >
        {truncated}
        <ExternalLinkIcon className="h-3 w-3 text-muted-foreground" />
      </a>
    </div>
  );
}

function AddressTransition({
  from,
  to,
  fromLabel = 'From',
  toLabel = 'To',
}: {
  from?: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{fromLabel}</span>
        {from ? (
          <a
            href={`https://etherscan.io/address/${from}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-sm bg-muted px-2 py-1.5 rounded hover:bg-muted-foreground/20 transition-colors"
            title={from}
          >
            {truncateAddress(from)}
            <ExternalLinkIcon className="h-3 w-3 text-muted-foreground" />
          </a>
        ) : (
          <span className="font-mono text-sm bg-muted px-2 py-1.5 rounded text-muted-foreground italic">
            unknown
          </span>
        )}
      </div>

      <ArrowRightIcon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-5" />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{toLabel}</span>
        <a
          href={`https://etherscan.io/address/${to}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-sm bg-muted px-2 py-1.5 rounded hover:bg-muted-foreground/20 transition-colors"
          title={to}
        >
          {truncateAddress(to)}
          <ExternalLinkIcon className="h-3 w-3 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}

function ContractHeader({
  contractName,
  contractAddress,
}: {
  contractName?: string;
  contractAddress: string;
}) {
  // Parse contract name to extract just the name part (without address)
  const displayName = contractName?.replace(/\s+at\s+`0x[a-fA-F0-9]+`$/, '') || 'Contract';

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
      <span>{displayName}</span>
      <a
        href={`https://etherscan.io/address/${contractAddress}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs bg-muted-foreground/10 px-1.5 py-0.5 rounded hover:underline"
        title={contractAddress}
      >
        {truncateAddress(contractAddress)}
        <ExternalLinkIcon className="h-3 w-3" />
      </a>
    </div>
  );
}

function OwnershipTransferredCard({
  item,
}: {
  item: Extract<PermissionsDiffItem, { kind: 'ownership_transferred' }>;
}) {
  return (
    <div className="border border-muted rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <UserIcon className="h-4 w-4 text-orange-500" />
        <span className="font-medium">Ownership Transferred</span>
      </div>
      <ContractHeader contractName={item.contractName} contractAddress={item.contractAddress} />
      <AddressTransition
        from={item.previous}
        to={item.next}
        fromLabel="Previous Owner"
        toLabel="New Owner"
      />
    </div>
  );
}

function RoleChangeCard({
  item,
}: {
  item: Extract<PermissionsDiffItem, { kind: 'role_granted' | 'role_revoked' }>;
}) {
  const isGranted = item.kind === 'role_granted';
  const roleName = item.role.name || truncateAddress(item.role.id);

  return (
    <div className="border border-muted rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <ShieldIcon className={`h-4 w-4 ${isGranted ? 'text-green-500' : 'text-red-500'}`} />
        <span className="font-medium">Role {isGranted ? 'Granted' : 'Revoked'}</span>
        <Badge
          variant="outline"
          className={
            isGranted
              ? 'bg-green-100 text-green-800 border-green-300'
              : 'bg-red-100 text-red-800 border-red-300'
          }
        >
          {roleName}
        </Badge>
      </div>
      <ContractHeader contractName={item.contractName} contractAddress={item.contractAddress} />
      <div className="space-y-3">
        <AddressDisplay address={item.account} label={isGranted ? 'Granted To' : 'Revoked From'} />
        <AddressDisplay address={item.sender} label="By" />
      </div>
    </div>
  );
}

function TimelockAdminCard({
  item,
}: {
  item: Extract<
    PermissionsDiffItem,
    { kind: 'timelock_admin_changed' | 'timelock_pending_admin_changed' }
  >;
}) {
  const isPending = item.kind === 'timelock_pending_admin_changed';

  return (
    <div className="border border-muted rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <KeyIcon className="h-4 w-4 text-yellow-600" />
        <span className="font-medium">{isPending ? 'Pending Admin Changed' : 'Admin Changed'}</span>
        {isPending && (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            Pending
          </Badge>
        )}
      </div>
      <ContractHeader contractName={item.contractName} contractAddress={item.contractAddress} />
      {isPending && !item.previous ? (
        <AddressDisplay address={item.next} label="Pending Admin Set" />
      ) : (
        <AddressTransition
          from={item.previous}
          to={item.next}
          fromLabel={isPending ? 'Previous Pending Admin' : 'Previous Admin'}
          toLabel={isPending ? 'New Pending Admin' : 'New Admin'}
        />
      )}
    </div>
  );
}

function TimelockAdminTransferCard({
  pending,
  admin,
}: {
  pending: Extract<PermissionsDiffItem, { kind: 'timelock_pending_admin_changed' }>;
  admin: Extract<PermissionsDiffItem, { kind: 'timelock_admin_changed' }>;
}) {
  return (
    <div className="border border-muted rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <KeyIcon className="h-4 w-4 text-yellow-600" />
        <span className="font-medium">Admin Transfer</span>
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
          2-step
        </Badge>
      </div>
      <ContractHeader
        contractName={pending.contractName || admin.contractName}
        contractAddress={admin.contractAddress}
      />

      <div className="space-y-4">
        {pending.previous ? (
          <AddressTransition
            from={pending.previous}
            to={pending.next}
            fromLabel="Previous Pending Admin"
            toLabel="New Pending Admin"
          />
        ) : (
          <AddressDisplay address={pending.next} label="Pending Admin Set" />
        )}
        <AddressTransition
          from={admin.previous}
          to={admin.next}
          fromLabel="Previous Admin"
          toLabel="New Admin"
        />
      </div>
    </div>
  );
}

export function PermissionsDiff({ items }: PermissionsDiffProps) {
  if (!items || items.length === 0) {
    return <div className="text-muted-foreground text-sm p-4">No permission changes detected.</div>;
  }

  // Group items by type
  const ownershipChanges = items.filter(
    (item): item is Extract<PermissionsDiffItem, { kind: 'ownership_transferred' }> =>
      item.kind === 'ownership_transferred',
  );
  const roleChanges = items.filter(
    (item): item is Extract<PermissionsDiffItem, { kind: 'role_granted' | 'role_revoked' }> =>
      item.kind === 'role_granted' || item.kind === 'role_revoked',
  );
  const timelockChanges = items.filter(
    (
      item,
    ): item is Extract<
      PermissionsDiffItem,
      { kind: 'timelock_admin_changed' | 'timelock_pending_admin_changed' }
    > => item.kind === 'timelock_admin_changed' || item.kind === 'timelock_pending_admin_changed',
  );

  const timelockDisplayItems = (() => {
    type Pending = Extract<PermissionsDiffItem, { kind: 'timelock_pending_admin_changed' }>;
    type Admin = Extract<PermissionsDiffItem, { kind: 'timelock_admin_changed' }>;
    type DisplayItem =
      | { kind: 'timelock_admin_transfer'; pending: Pending; admin: Admin }
      | { kind: 'single'; item: Pending | Admin };

    const keyFor = (item: Pending | Admin) => `${item.contractAddress}:${item.next}`;
    const used = new Set<number>();
    const pendingIndicesByKey = new Map<string, number[]>();
    const adminIndicesByKey = new Map<string, number[]>();

    timelockChanges.forEach((item, index) => {
      const key = keyFor(item);
      if (item.kind === 'timelock_pending_admin_changed') {
        pendingIndicesByKey.set(key, [...(pendingIndicesByKey.get(key) ?? []), index]);
      } else {
        adminIndicesByKey.set(key, [...(adminIndicesByKey.get(key) ?? []), index]);
      }
    });

    const takeFirstUnused = (indices: number[], preferAfterIndex: number) => {
      const after = indices.find((idx) => idx > preferAfterIndex && !used.has(idx));
      if (after !== undefined) return after;
      return indices.find((idx) => !used.has(idx));
    };

    const result: DisplayItem[] = [];
    for (let i = 0; i < timelockChanges.length; i++) {
      if (used.has(i)) continue;
      const item = timelockChanges[i];
      const key = keyFor(item);

      if (item.kind === 'timelock_pending_admin_changed') {
        const adminIndex = takeFirstUnused(adminIndicesByKey.get(key) ?? [], i);
        if (adminIndex !== undefined) {
          used.add(i);
          used.add(adminIndex);
          result.push({
            kind: 'timelock_admin_transfer',
            pending: item,
            admin: timelockChanges[adminIndex] as Admin,
          });
          continue;
        }
      } else {
        const pendingIndex = takeFirstUnused(pendingIndicesByKey.get(key) ?? [], i);
        if (pendingIndex !== undefined) {
          used.add(i);
          used.add(pendingIndex);
          result.push({
            kind: 'timelock_admin_transfer',
            pending: timelockChanges[pendingIndex] as Pending,
            admin: item,
          });
          continue;
        }
      }

      used.add(i);
      result.push({
        kind: 'single',
        item: item as Pending | Admin,
      });
    }

    return result;
  })();

  return (
    <div className="space-y-6 mt-4">
      {timelockDisplayItems.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Timelock Admin Changes
          </h4>
          <div className="space-y-3">
            {timelockDisplayItems.map((displayItem, index) => {
              if (displayItem.kind === 'timelock_admin_transfer') {
                return (
                  <TimelockAdminTransferCard
                    key={`timelock-transfer-${displayItem.admin.contractAddress}-${displayItem.admin.next}-${index}`}
                    pending={displayItem.pending}
                    admin={displayItem.admin}
                  />
                );
              }

              return (
                <TimelockAdminCard
                  key={`timelock-${displayItem.item.contractAddress}-${index}`}
                  item={displayItem.item}
                />
              );
            })}
          </div>
        </div>
      )}

      {ownershipChanges.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Ownership Changes
          </h4>
          <div className="space-y-3">
            {ownershipChanges.map((item, index) => (
              <OwnershipTransferredCard
                key={`ownership-${item.contractAddress}-${index}`}
                item={item}
              />
            ))}
          </div>
        </div>
      )}

      {roleChanges.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Role Changes
          </h4>
          <div className="space-y-3">
            {roleChanges.map((item, index) => (
              <RoleChangeCard
                key={`role-${item.contractAddress}-${item.account}-${index}`}
                item={item}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
