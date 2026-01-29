'use client';

import { ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';
import { useMemo } from 'react';
import { AddressChip } from '../AddressChip';

interface ProxyItem {
  type: 'eip1967' | 'beacon';
  proxy: string;
  beacon?: string;
  implementation: string;
  verification: string;
}

function parseProxyDetails(details: string): ProxyItem[] {
  const items: ProxyItem[] = [];
  const lines = details.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
    const addresses: string[] = [];
    let match: RegExpExecArray | null;
    match = linkRegex.exec(line);
    while (match !== null) {
      addresses.push(match[1]);
      match = linkRegex.exec(line);
    }

    const verificationMatch = line.match(/\(([^)]+)\)$/);
    const verification = verificationMatch ? verificationMatch[1] : '';

    if (line.includes('EIP-1967 proxy') && addresses.length >= 2) {
      items.push({
        type: 'eip1967',
        proxy: addresses[0],
        implementation: addresses[1],
        verification,
      });
    } else if (line.includes('Beacon proxy') && addresses.length >= 3) {
      items.push({
        type: 'beacon',
        proxy: addresses[0],
        beacon: addresses[1],
        implementation: addresses[2],
        verification,
      });
    }
  }

  return items;
}

export function ProxyResolutionDetails({ details }: { details: string }) {
  const items = useMemo(() => parseProxyDetails(details), [details]);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {details.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div
          key={`${item.proxy}-${idx}`}
          className="border border-border/50 rounded-lg bg-card/50 overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
            <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
              {item.type === 'eip1967' ? 'EIP-1967 Proxy' : 'Beacon Proxy'}
            </span>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <AddressChip address={item.proxy} label="Proxy" />

              <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />

              {item.beacon && (
                <>
                  <AddressChip address={item.beacon} label="Beacon" />
                  <ArrowRightIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                </>
              )}

              <AddressChip address={item.implementation} label="Impl" />
            </div>

            {item.verification && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs text-muted-foreground">{item.verification}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
