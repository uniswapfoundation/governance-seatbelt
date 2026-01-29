import { ExternalLinkIcon } from 'lucide-react';
import { buildAddressLinkForExplorer } from './explorer';

export function AddressChip({
  address,
  label,
  explorerBaseUrl,
}: {
  address: string;
  label?: string;
  explorerBaseUrl?: string;
}) {
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <a
      href={buildAddressLinkForExplorer(address, explorerBaseUrl || 'https://etherscan.io')}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/60 hover:bg-muted transition-colors"
      title={address}
    >
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
      )}
      <code className="text-xs font-mono text-foreground/80 group-hover:text-foreground">
        {truncated}
      </code>
      <ExternalLinkIcon className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
    </a>
  );
}
