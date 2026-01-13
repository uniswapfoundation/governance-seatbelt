'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AddressLabel as AddressLabelType } from '@/hooks/use-simulation-results';
import { CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface AddressLabelProps {
  address: string;
  label?: AddressLabelType;
  blockExplorerUrl?: string;
  showLink?: boolean;
  linkMode?: 'none' | 'tooltip' | 'inline';
  className?: string;
}

/**
 * Abbreviate an address to first 6 and last 4 characters
 */
function abbreviateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get badge variant based on label type
 */
function getTypeVariant(type?: string): 'default' | 'secondary' | 'outline' {
  switch (type) {
    case 'governance':
      return 'default';
    case 'token':
      return 'secondary';
    case 'bridge':
      return 'outline';
    default:
      return 'outline';
  }
}

/**
 * AddressLabel component displays an address with its human-readable label.
 *
 * Format: "Label (0x1234...5678)" or just "0x1234...5678" if no label
 *
 * Features:
 * - Tooltip with full address
 * - Copy to clipboard button
 * - Optional link to block explorer
 * - Type badge (governance, token, bridge, etc.)
 */
export function AddressLabel({
  address,
  label,
  blockExplorerUrl,
  showLink = true,
  linkMode = 'tooltip',
  className = '',
}: AddressLabelProps) {
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

  const abbreviated = abbreviateAddress(address);
  const displayText = label ? `${label.label} (${abbreviated})` : abbreviated;

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

  const explorerLink = blockExplorerUrl ? `${blockExplorerUrl}/address/${address}` : undefined;

  const Trigger = explorerLink && showLink && linkMode === 'inline' ? 'a' : 'span';
  const triggerProps =
    Trigger === 'a'
      ? {
          href: explorerLink,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: address,
        }
      : {};

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Trigger
            {...triggerProps}
            className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}
          >
            {label?.type && (
              <Badge variant={getTypeVariant(label.type)} className="text-xs px-1.5 py-0">
                {label.type}
              </Badge>
            )}
            <span className="hover:underline cursor-help">{displayText}</span>
            {Trigger === 'a' && <ExternalLinkIcon className="h-3 w-3" />}
          </Trigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-md">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono break-all">{address}</code>
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
            </div>
            {label && (
              <div className="text-xs text-muted-foreground">
                {label.source === 'ens' && 'ENS Name'}
                {label.source === 'custom' && 'Custom Label'}
                {label.source === 'tenderly' && 'Contract Name'}
              </div>
            )}
            {showLink && explorerLink && linkMode !== 'none' && (
              <a
                href={explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
              >
                View on Explorer
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Helper hook to get label for an address from the labels map
 */
export function useAddressLabel(
  address: string,
  labels?: Record<string, AddressLabelType>,
): AddressLabelType | undefined {
  if (!labels) return undefined;

  // Try exact match first
  const label = labels[address];
  if (label) return label;

  // Try lowercase match (addresses might have different casing)
  const lowerAddress = address.toLowerCase();
  for (const [key, value] of Object.entries(labels)) {
    if (key.toLowerCase() === lowerAddress) {
      return value;
    }
  }

  return undefined;
}
