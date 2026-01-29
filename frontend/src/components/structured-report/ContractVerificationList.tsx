'use client';

import { Badge } from '@/components/ui/badge';
import {
  ExternalLinkIcon,
  InfoIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';
import { useMemo } from 'react';

type VerificationStatus = 'verified' | 'unverified' | 'eoa' | 'unknown';

interface ParsedContract {
  address: string;
  status: VerificationStatus;
  statusLabel: string;
  isPlaceholder: boolean;
}

function parseVerificationLine(line: string): ParsedContract | null {
  const addressMatch = line.match(/\[(0x[a-fA-F0-9]{40})\]/) || line.match(/(0x[a-fA-F0-9]{40})/);
  if (!addressMatch) return null;

  const address = addressMatch[1];
  const isPlaceholder = line.includes('simulation placeholder');

  let status: VerificationStatus = 'unknown';
  let statusLabel = 'Unknown';

  if (line.includes('Contract (verified)')) {
    status = 'verified';
    statusLabel = 'Verified';
  } else if (line.includes('Contract (unverified)')) {
    status = 'unverified';
    statusLabel = 'Unverified';
  } else if (line.includes('EOA') || line.includes('verification not applicable')) {
    status = 'eoa';
    statusLabel = isPlaceholder ? 'Placeholder' : 'EOA';
  } else if (line.includes('Contract (looks safe)')) {
    status = 'verified';
    statusLabel = 'Looks Safe';
  } else if (line.includes('Trusted contract')) {
    status = 'verified';
    statusLabel = 'Trusted';
  }

  return { address, status, statusLabel, isPlaceholder };
}

interface ContractVerificationListProps {
  details: string;
  info?: string[];
}

interface ContractCardProps {
  contract: ParsedContract;
  variant: 'success' | 'danger' | 'neutral';
}

function ContractCard({ contract, variant }: ContractCardProps) {
  const variantStyles = {
    success: {
      card: 'bg-green-50 border-green-200 hover:border-green-300',
      badge: 'bg-green-100 text-green-800 border-green-300',
      icon: <ShieldCheckIcon className="h-4 w-4 text-green-600" />,
    },
    danger: {
      card: 'bg-red-50 border-red-200 hover:border-red-300',
      badge: 'bg-red-100 text-red-700 border-red-300',
      icon: <ShieldAlertIcon className="h-4 w-4 text-red-500" />,
    },
    neutral: {
      card: 'bg-gray-50 border-gray-200 hover:border-gray-300',
      badge: 'bg-gray-100 text-gray-600 border-gray-300',
      icon: <UserIcon className="h-4 w-4 text-gray-500" />,
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${styles.card}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {styles.icon}
        <a
          href={`https://etherscan.io/address/${contract.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm truncate hover:underline inline-flex items-center gap-1 group"
        >
          <span className="truncate">{contract.address}</span>
          <ExternalLinkIcon className="h-3 w-3 opacity-50 group-hover:opacity-100 flex-shrink-0" />
        </a>
      </div>
      <Badge variant="outline" className={`text-xs font-medium flex-shrink-0 ${styles.badge}`}>
        {contract.statusLabel}
        {contract.isPlaceholder && ' (Sim)'}
      </Badge>
    </div>
  );
}

export function ContractVerificationList({ details, info }: ContractVerificationListProps) {
  const contracts = useMemo(() => {
    const lines = info || details.split('\n').filter((l) => l.trim());
    return lines.map(parseVerificationLine).filter((c): c is ParsedContract => c !== null);
  }, [details, info]);

  const grouped = useMemo(() => {
    const unverified = contracts.filter((c) => c.status === 'unverified');
    const verified = contracts.filter((c) => c.status === 'verified');
    const eoa = contracts.filter((c) => c.status === 'eoa');
    const unknown = contracts.filter((c) => c.status === 'unknown');
    return { unverified, verified, eoa, unknown };
  }, [contracts]);

  const totalCount = contracts.length;
  const verifiedCount = grouped.verified.length;
  const unverifiedCount = grouped.unverified.length;

  if (contracts.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground border border-muted rounded-md">
        <InfoIcon className="h-4 w-4 mr-2" />
        <span>No contracts found</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 pb-3 border-b border-muted">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-semibold">{totalCount}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheckIcon className="h-4 w-4 text-green-600" />
          <span className="text-green-700 font-medium">{verifiedCount} verified</span>
        </div>
        {unverifiedCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlertIcon className="h-4 w-4 text-red-500" />
            <span className="text-red-600 font-medium">{unverifiedCount} unverified</span>
          </div>
        )}
        {grouped.eoa.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <UserIcon className="h-4 w-4 text-gray-500" />
            <span className="text-muted-foreground">{grouped.eoa.length} EOA/Other</span>
          </div>
        )}
      </div>

      {grouped.unverified.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-red-600 flex items-center gap-2">
            <ShieldAlertIcon className="h-4 w-4" />
            Unverified Contracts
          </h4>
          <div className="space-y-2">
            {grouped.unverified.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="danger" />
            ))}
          </div>
        </div>
      )}

      {grouped.verified.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-green-700 flex items-center gap-2">
            <ShieldCheckIcon className="h-4 w-4" />
            Verified Contracts
          </h4>
          <div className="space-y-2">
            {grouped.verified.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="success" />
            ))}
          </div>
        </div>
      )}

      {grouped.eoa.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <UserIcon className="h-4 w-4" />
            EOA / Other Addresses
          </h4>
          <div className="space-y-2">
            {grouped.eoa.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="neutral" />
            ))}
          </div>
        </div>
      )}

      {grouped.unknown.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <InfoIcon className="h-4 w-4" />
            Unknown Status
          </h4>
          <div className="space-y-2">
            {grouped.unknown.map((contract) => (
              <ContractCard key={contract.address} contract={contract} variant="neutral" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
