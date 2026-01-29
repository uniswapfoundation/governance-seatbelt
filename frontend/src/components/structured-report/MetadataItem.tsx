'use client';

import type React from 'react';

export function MetadataItem({
  label,
  children,
  fullWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={`bg-muted/50 p-2.5 sm:p-3 rounded-lg ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
