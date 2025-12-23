# Contextual Terminology for Proposer/Executor Display

## Current Issue
The metadata panel always shows "Proposer" and "Executor" labels, but this doesn't reflect the actual governance flow based on simulation type.

## Correct Contextual Labels

### For 'new' proposals (simulationType: 'new')
- **"Proposer"**: The address that would propose this (often placeholder)
- **"Executor"**: Not shown (proposal hasn't been proposed yet)

### For 'proposed' proposals (simulationType: 'proposed') 
- **"Proposer"**: The address that proposed this
- **"Executor"**: The address that will execute (if proposal passes)

### For 'executed' proposals (simulationType: 'executed')
- **"Proposer"**: The address that originally proposed this
- **"Executor"**: The address that executed this

## Implementation in Metadata Panel

```typescript
// In the metadata panel section:
function getProposerLabel(simulationType?: string): string {
  // Proposer is always "Proposer" regardless of simulation type
  return "Proposer";
}

function getExecutorLabel(simulationType?: string): string {
  switch (simulationType) {
    case 'new':
      return "Intended Executor"; // Or don't show at all
    case 'proposed':
      return "Will Execute";
    case 'executed':
      return "Executed By";
    default:
      return "Executor"; // Fallback for unknown types
  }
}

// Usage in JSX:
<div className="text-sm text-muted-foreground">
  {getProposerLabel(report.metadata.simulationType)}
</div>

{report.metadata.executor && (
  <div className="text-sm text-muted-foreground">
    {getExecutorLabel(report.metadata.simulationType)}
  </div>
)}
```

## Alternative: Show Contextual Information

For even better UX, we could show more contextual info:

### 'new' proposals:
```
Simulated Proposer: 0x0000...1234 [Simulation Placeholder]
```

### 'proposed' proposals:  
```
Proposed By: 0x1234...5678
Will Execute: 0x5678...90ab (if passed)
```

### 'executed' proposals:
```
Proposed By: 0x1234...5678  
Executed By: 0x5678...90ab (on Block 12345678)
```

## Recommendation

**Option 1 (Simple)**: Update just the executor label based on simulation type
- Keeps current "Proposer" label (always accurate)
- Changes "Executor" to "Will Execute" / "Executed By" / "Intended Executor"

**Option 2 (Rich)**: Add more contextual information
- Show action status: "Proposed By" / "Will Execute" / "Executed By"  
- Include timing info when available

I recommend **Option 1** for this issue to keep it focused and avoid scope creep.