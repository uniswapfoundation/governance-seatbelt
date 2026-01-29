'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface AddressChipProps {
  address: string;
  label?: string;
  chainId?: number;
  blockExplorerUrl?: string;
  className?: string;
  showCopy?: boolean;
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeBaseUrl(blockExplorerUrl?: string): string {
  const url = (blockExplorerUrl || 'https://etherscan.io').trim();
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function AddressChip({
  address,
  label,
  blockExplorerUrl,
  className,
  showCopy = true,
}: AddressChipProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const explorerHref = `${normalizeBaseUrl(blockExplorerUrl)}/address/${address}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);

      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts; ignore silently.
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'group inline-flex items-center gap-1.5 rounded bg-muted-foreground/10 px-1 py-0.5 text-xs text-foreground/80 transition-colors hover:bg-muted-foreground/15 hover:text-foreground hover:underline',
            className,
          )}
          title={address}
        >
          {label ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {label}
            </span>
          ) : null}
          <code className="font-mono text-inherit">{truncateAddress(address)}</code>
          <ExternalLinkIcon className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </a>
      </TooltipTrigger>
      <TooltipContent className="max-w-md">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono break-all">{address}</code>
            {showCopy ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={handleCopy}
                aria-label="Copy address"
              >
                {copied ? (
                  <CheckIcon className="h-3 w-3 text-green-500" />
                ) : (
                  <CopyIcon className="h-3 w-3" />
                )}
              </Button>
            ) : null}
          </div>
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
          >
            View on Explorer
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
