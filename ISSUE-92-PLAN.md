# Issue #92: Decision Header Implementation Plan

## Overview
Implement a Decision Header component that consolidates key simulation information into a compact, scannable header at the top of the report. This builds on PR #109's work which added placeholder warnings and dynamic explorer links.

## Current State (from PR #109)

### Backend provides in `metadata`:
- `simulationBlockNumber` and `simulationTimestamp`
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

## Design Specification

### Decision Header Component

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [✓ Passed] Proposal Title                                    #92       │
│  Ran 10/10 checks • 2 hours ago • Block 12345678 ↗ • Ethereum         │
│  ⚠️ This is a simulated proposal with placeholder addresses            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Features:
1. **Status Badge**: Visual indicator (✓ Passed, ⚠️ Warning, ❌ Failed)
2. **Proposal Title**: Main title with proposal ID
3. **Check Status**: "Ran X/Y checks" where X = passed checks, Y = total
4. **Age**: Relative time from `simulationTimestamp`
5. **Block Info**: Block number with explorer link
6. **Chain Name**: Network name from metadata
7. **Warning Banner**: Contextual warning for simulation type/placeholders

## Implementation Steps

### 1. Create DecisionHeader Component
Location: `frontend/src/components/DecisionHeader.tsx`

```typescript
interface DecisionHeaderProps {
  report: StructuredSimulationReport;
}

export function DecisionHeader({ report }: DecisionHeaderProps) {
  // Calculate check statistics
  const passedChecks = report.checks.filter(c => c.status !== 'failed').length;
  const totalChecks = report.checks.length;
  
  // Calculate age from timestamp
  const age = formatRelativeTime(report.metadata.simulationTimestamp);
  
  // Get block number
  const blockNumber = report.metadata.simulationBlockNumber || 'unknown';
  
  // Determine if placeholder warning needed
  const hasPlaceholders = report.metadata.proposerIsPlaceholder || 
                          report.metadata.executorIsPlaceholder;
  
  return (
    <div className="border border-muted rounded-md p-4 mb-4">
      {/* Main header line */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <StatusIcon status={report.status} />
          <h1 className="text-xl font-bold">{report.title}</h1>
        </div>
        <span className="text-muted-foreground">#{report.metadata.proposalId}</span>
      </div>
      
      {/* Info line */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Ran {passedChecks}/{totalChecks} checks</span>
        <span>•</span>
        <span>{age}</span>
        <span>•</span>
        <a href={buildBlockLink(blockNumber, report.metadata)} 
           className="hover:underline inline-flex items-center">
          Block {blockNumber}
          <ExternalLinkIcon className="h-3 w-3 ml-1" />
        </a>
        <span>•</span>
        <span>{report.metadata.chainName || 'Ethereum'}</span>
      </div>
      
      {/* Contextual warning */}
      {(hasPlaceholders || report.metadata.simulationType) && (
        <DecisionHeaderWarning 
          simulationType={report.metadata.simulationType}
          hasPlaceholders={hasPlaceholders}
        />
      )}
    </div>
  );
}
```

### 2. Update StructuredReport Component
- Replace current header section with DecisionHeader
- Remove Metadata panel from Overview tab (info now in header)
- Keep the SimulationWarningBanner (it provides detailed context)

### 3. Helper Functions Needed

```typescript
// Format relative time
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = parseInt(timestamp) * 1000;
  const diff = now - then;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// Status icon component
function StatusIcon({ status }: { status: 'success' | 'warning' | 'error' }) {
  switch (status) {
    case 'success':
      return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    case 'warning':
      return <AlertTriangleIcon className="h-5 w-5 text-yellow-500" />;
    case 'error':
      return <XCircleIcon className="h-5 w-5 text-red-500" />;
  }
}

// Contextual warning for header
function DecisionHeaderWarning({ 
  simulationType, 
  hasPlaceholders 
}: { 
  simulationType?: string; 
  hasPlaceholders: boolean;
}) {
  let message = '';
  
  if (simulationType === 'new') {
    message = 'This is a simulated new proposal';
  } else if (simulationType === 'proposed') {
    message = 'This proposal is pending execution';
  } else if (simulationType === 'executed') {
    message = 'This is a re-simulation of an executed proposal';
  }
  
  if (hasPlaceholders) {
    message += message ? ' with placeholder addresses' : 'This simulation uses placeholder addresses';
  }
  
  if (!message) return null;
  
  return (
    <div className="mt-2 flex items-center gap-2 text-sm text-orange-600">
      <AlertTriangleIcon className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}
```

## Testing Checklist

### Functionality
- [ ] Status icon matches report status (success/warning/error)
- [ ] Check count shows correct passed/total ratio
- [ ] Age calculation is accurate and updates appropriately
- [ ] Block explorer link uses correct chain-specific URL
- [ ] Chain name displays correctly for all supported chains
- [ ] Placeholder warning appears when appropriate

### Visual/UX
- [ ] Header is compact and scannable
- [ ] Information hierarchy is clear
- [ ] Links are clearly indicated and functional
- [ ] Warning messages are noticeable but not overwhelming
- [ ] Component is responsive on mobile screens

### Edge Cases
- [ ] Handles missing metadata fields gracefully
- [ ] Works with both old and new report formats
- [ ] Displays appropriately for all simulation types
- [ ] Handles very long proposal titles

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
1. **Improved Scannability**: Key info visible at a glance
2. **Better Context**: Simulation type and placeholder warnings prominent
3. **Reduced Redundancy**: Removes duplicate metadata panel
4. **Enhanced UX**: Clean, professional appearance
5. **Chain Awareness**: Dynamic explorer links based on actual chain

## Dependencies
- Builds on PR #109's work
- Uses existing helper functions and components
- Compatible with current backend data structure