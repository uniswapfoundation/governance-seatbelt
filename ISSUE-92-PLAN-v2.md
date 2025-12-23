# Issue #92: Decision Header Implementation Plan (Revised)

## Overview
Implement a Decision Header component that consolidates key simulation information into a compact, scannable header at the top of the report, and add a matching executive summary to markdown reports. This header must satisfy Issue #92 acceptance criteria: status chip (PASS/WARN/INCONCLUSIVE/FAIL), "Ran N/N checks" coverage summary, block number + age, and links to repo commit and Tenderly.

## Critical Design Decisions

### 1. Metadata Panel: KEEP IT
- **Keep the Metadata panel** in the Overview tab to preserve proposer/executor/governor addresses
- Decision Header supplements, not replaces, the detailed metadata
- This avoids regression and maintains all contextual information

### 2. Coverage vs Outcome Metrics
- Primary metric: "**Ran N/N checks**" (coverage summary required by Issue #92)
- Optional outcome summary: show **Warnings: X** and/or **Failures: Y** if non-zero
- Avoid "Passed X/Y" in the header to keep coverage vs quality distinct

### 3. Status Chip Taxonomy
- Use labeled chip text: **PASS / WARN / INCONCLUSIVE / FAIL**
- Map to color + icon for quick scanning; include label text (not icon-only)

### 4. Warning Strategy: Single Location
- **Remove** the DecisionHeaderWarning component
- **Keep** only the SimulationWarningBanner for detailed warnings
- Decision Header focuses on core metrics without duplicating warnings

### 5. Required Links in Header
- Include repo commit link (repo@commit) and Tenderly simulation link when available
- Omit links gracefully if missing (no placeholders)

### 6. Markdown Parity
- Add a short executive summary at the top of the markdown report with the same fields as the Decision Header
- Keep the existing markdown report body and table of contents intact

## Current State (from PR #109)

### Backend provides in `metadata`:
- `simulationBlockNumber` and `simulationTimestamp` (new format)
- `blockNumber` and `timestamp` (legacy format - some reports still use this)
- `proposerIsPlaceholder` and `executorIsPlaceholder` flags
- `governorAddress`, `proposalId`, `proposer`, `executor`
- `schemaVersion`, `chainId`, `chainName`, `blockExplorerBaseUrl`
- `simulationType` ('executed' | 'proposed' | 'new')
- `placeholderAddresses` array

### Frontend has (from PR #109):
- Helper functions: `buildAddressLink()`, `buildBlockLink()`, `isPlaceholderAddress()`
- `SimulationWarningBanner` component for simulation type warnings
- `SimulationPlaceholderBadge` component for marking placeholder addresses
- Dynamic explorer URL support based on chain

### Data Gaps to Satisfy Issue #92
- `metadata.repoCommit` and `metadata.repoUrl` (for repo@commit link)
- `metadata.tenderlyUrl` (for Tenderly simulation link)
- Optional `metadata.checksTotal` (if total checks can differ from executed)
- `status: 'inconclusive'` support (when partial/timeout)

### Data Sourcing Notes
- `repoCommit`: prefer CI env (e.g., `GITHUB_SHA`); fallback to `git rev-parse HEAD` in local runs
- `repoUrl`: prefer CI env (e.g., `GITHUB_REPOSITORY` -> `https://github.com/{owner}/{repo}`); fallback to `git config --get remote.origin.url`
- `tenderlyUrl`: only if the simulation is saved and has a `simulation.id`; build from `TENDERLY_USER`, `TENDERLY_PROJECT_SLUG`, and `simulation.id` (confirm final dashboard URL path, e.g. `https://dashboard.tenderly.co/{user}/{project}/sim/{id}`)

## Design Specification

### Decision Header Component

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [PASS] Proposal Title                                          #92    │
│  Ran 10/10 checks • 2 hours ago • Block 12345678 ↗ • Ethereum         │
│  Repo abc1234 • Tenderly ↗                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Features:
1. **Status Chip**: Visual indicator with label (PASS/WARN/INCONCLUSIVE/FAIL)
2. **Proposal Title**: Main title with proposal ID (if not already in title)
3. **Coverage Summary**: "Ran N/N checks" (coverage)
4. **Outcome Summary**: Optional warnings/failures counts
5. **Age**: Relative time from timestamp (static after render)
6. **Block Info**: Block number with explorer link (only if valid block number)
7. **Chain Name**: Network name from metadata
8. **Repo@Commit Link**: Link to the exact commit used for the simulation
9. **Tenderly Link**: Link to Tenderly simulation

## Implementation Steps

### 0. Add Required Metadata Fields
- Extend `StructuredSimulationReport.metadata` to include `repoCommit`, `repoUrl`, `tenderlyUrl`, and optional `checksTotal`
- Extend report `status` to include `inconclusive` (or map partial/timeout to INCONCLUSIVE)
- Ensure JSON output includes these fields when available

### 1. Create DecisionHeader Component
Location: `frontend/src/components/DecisionHeader.tsx`

```typescript
import { buildBlockLink } from '@/utils/explorer';
import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';
import { CheckCircleIcon, AlertTriangleIcon, XCircleIcon, ExternalLinkIcon } from 'lucide-react';

interface DecisionHeaderProps {
  report: StructuredSimulationReport;
}

export function DecisionHeader({ report }: DecisionHeaderProps) {
  const checks = report.checks ?? [];
  const ranChecks = checks.length;
  const totalChecks = report.metadata.checksTotal ?? ranChecks;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  const failureCount = checks.filter((check) => check.status === 'failed').length;
  
  // Get timestamp with fallback for legacy format
  const timestamp = report.metadata.simulationTimestamp || 
                   report.metadata.timestamp || 
                   '0';
  const age = formatRelativeTime(timestamp);
  
  // Get block number with fallback for legacy format
  const blockNumber = report.metadata.simulationBlockNumber || 
                     report.metadata.blockNumber;
  
  // Extract proposal ID - check if it's already in the title
  const proposalId = report.metadata.proposalId;
  const showProposalId = proposalId && !report.title.includes(`#${proposalId}`);

  const repoCommit = report.metadata.repoCommit;
  const repoUrl = report.metadata.repoUrl;
  const tenderlyUrl = report.metadata.tenderlyUrl;
  
  return (
    <div className="border border-muted rounded-md p-4 mb-4">
      {/* Main header line */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <StatusChip status={report.status} />
          <h1 className="text-xl font-bold">{report.title}</h1>
        </div>
        {showProposalId && (
          <span className="text-muted-foreground">#{proposalId}</span>
        )}
      </div>
      
      {/* Info line */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <span>Ran {ranChecks}/{totalChecks} checks</span>
        {(warningCount > 0 || failureCount > 0) && (
          <>
            <span>•</span>
            {warningCount > 0 && <span>Warnings: {warningCount}</span>}
            {warningCount > 0 && failureCount > 0 && <span>•</span>}
            {failureCount > 0 && <span>Failures: {failureCount}</span>}
          </>
        )}
        <span>•</span>
        <span>{age}</span>
        {blockNumber && blockNumber !== 'unknown' && (
          <>
            <span>•</span>
            <a 
              href={buildBlockLink(blockNumber, report.metadata)} 
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center"
            >
              Block {blockNumber}
              <ExternalLinkIcon className="h-3 w-3 ml-1" />
            </a>
          </>
        )}
        <span>•</span>
        <span>{report.metadata.chainName || 'Ethereum'}</span>
      </div>

      {(repoCommit && repoUrl) || tenderlyUrl ? (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {repoCommit && repoUrl && (
            <a
              href={`${repoUrl}/commit/${repoCommit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center"
            >
              Repo {repoCommit.slice(0, 7)}
              <ExternalLinkIcon className="h-3 w-3 ml-1" />
            </a>
          )}
          {tenderlyUrl && (
            <>
              <span>•</span>
              <a
                href={tenderlyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline inline-flex items-center"
              >
                Tenderly
                <ExternalLinkIcon className="h-3 w-3 ml-1" />
              </a>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Helper: Format relative time (static, not updating)
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = parseInt(timestamp) * 1000;
  const diff = now - then;
  
  if (isNaN(then) || then === 0) {
    return 'Unknown time';
  }
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// Helper: Status chip component
function StatusChip({
  status,
}: {
  status: 'success' | 'warning' | 'error' | 'inconclusive';
}) {
  switch (status) {
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 text-xs font-semibold">
          <CheckCircleIcon className="h-4 w-4" />
          PASS
        </span>
      );
    case 'warning':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-0.5 text-xs font-semibold">
          <AlertTriangleIcon className="h-4 w-4" />
          WARN
        </span>
      );
    case 'inconclusive':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-800 border border-gray-300 px-2 py-0.5 text-xs font-semibold">
          <AlertTriangleIcon className="h-4 w-4" />
          INCONCLUSIVE
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 border border-red-300 px-2 py-0.5 text-xs font-semibold">
          <XCircleIcon className="h-4 w-4" />
          FAIL
        </span>
      );
  }
}
```

### 1b. Extract Explorer Helpers
- Move `buildBlockLink`/`getExplorerUrl` out of `StructuredReport.tsx` into `frontend/src/utils/explorer.ts` (or similar)
- Avoid circular imports between `DecisionHeader` and `StructuredReport`

### 2. Update StructuredReport Component
```typescript
// In StructuredReport.tsx

import { DecisionHeader } from './DecisionHeader';

export function StructuredReport({ report }: StructuredReportProps) {
  return (
    <div className="w-full">
      {/* NEW: Decision Header at the top */}
      <DecisionHeader report={report} />
      
      <div className="border border-muted rounded-md p-6">
        {/* KEEP: Simulation warning banner */}
        <SimulationWarningBanner metadata={report.metadata} />
        
        {/* REMOVE: Old header section with title and status badge */}
        {/* The title and status are now in DecisionHeader */}

        {/* KEEP: Summary line (to avoid regressions) */}
        {/* Consider rendering report.summary under the DecisionHeader or above the Tabs */}
        
        <Tabs defaultValue="overview" className="w-full">
          {/* ... tabs content ... */}
          
          <TabsContent value="overview">
            {/* KEEP: All existing content including Metadata panel */}
            {/* This preserves proposer/executor/governor information */}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
```

### 3. Add Markdown Executive Summary
- Update `presentation/report.ts` (`toMarkdownProposalReport`) to render an "Executive Summary" section near the top
- Include status (PASS/WARN/INCONCLUSIVE/FAIL), ran checks, age, block link, chain name, repo@commit link, and Tenderly link
- Use the same data contract as the Decision Header; omit links if missing

## Testing Checklist

### Functionality
- [ ] Status chip matches report status (success/warning/error/inconclusive)
- [ ] Shows "Ran N/N checks" with accurate count
- [ ] Shows warnings/failures counts when non-zero
- [ ] Age calculation handles both timestamp formats (simulationTimestamp and timestamp)
- [ ] Age shows "Unknown time" for missing/invalid timestamps
- [ ] Block link only appears when valid block number exists
- [ ] Block explorer link uses correct chain-specific URL
- [ ] Chain name displays correctly for all supported chains
- [ ] Proposal ID only shows if not already in title
- [ ] Repo commit link appears when metadata present
- [ ] Tenderly link appears when metadata present
- [ ] Repo/Tenderly links are omitted when metadata missing
- [ ] INCONCLUSIVE status renders correctly
- [ ] Markdown executive summary renders with the same fields

### Visual/UX
- [ ] Header is compact and scannable
- [ ] Information hierarchy is clear
- [ ] Links are clearly indicated and functional
- [ ] No duplicate warnings (only SimulationWarningBanner)
- [ ] Component is responsive on mobile screens
- [ ] Metadata panel still accessible in Overview tab

### Edge Cases
- [ ] Handles missing simulationTimestamp/simulationBlockNumber gracefully
- [ ] Falls back to legacy timestamp/blockNumber fields
- [ ] Works with both old and new report formats
- [ ] Displays appropriately for all simulation types
- [ ] Handles very long proposal titles
- [ ] Handles reports with no checks array (default to 0)

### Backwards Compatibility
- [ ] Test with recent reports (have simulationTimestamp)
- [ ] Test with older reports (have timestamp only)
- [ ] Verify Metadata panel still shows all addresses

### Test Commands
```bash
# Test with new proposal simulation
SIM_NAME=uni-transfer bun run propose

# Test with cross-chain simulation
SIM_NAME=arb-distro bun run propose

# Test with existing proposals
bun run propose
```

## Benefits
1. **Improved Scannability**: Key metrics visible at a glance
2. **No Information Loss**: Metadata panel preserved for detailed context
3. **Markdown Parity**: Downloaded reports include the same at-a-glance summary
4. **Accurate Terminology**: "Ran N/N" reflects coverage, warnings/failures show quality
4. **No Redundancy**: Single warning location (SimulationWarningBanner)
5. **Backwards Compatible**: Handles both old and new data formats
6. **Chain Awareness**: Dynamic explorer links based on actual chain

## What This Does NOT Change
- Metadata panel remains in Overview tab (no regression)
- SimulationWarningBanner continues to provide detailed warnings
- All address information remains accessible
- Placeholder badges still shown where relevant
- Summary text remains visible (no regression)

## Summary of Changes from v1
1. **KEEP Metadata panel** - Avoids regression, maintains all context
2. **Use "Ran N/N checks"** - Coverage summary per Issue #92
3. **Remove DecisionHeaderWarning** - Avoid duplicate warnings
4. **Add fallback for legacy fields** - Handle old report formats
5. **Conditional block link** - Only show when valid
6. **Check proposal ID in title** - Avoid duplicate display
7. **Static age display** - No auto-update (as designed)
8. **Add repo@commit and Tenderly links** - Required by Issue #92
9. **Status chip taxonomy** - PASS/WARN/INCONCLUSIVE/FAIL
