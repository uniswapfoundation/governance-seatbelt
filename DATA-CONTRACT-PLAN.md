# Data Contract Plan for Issue #92

## Required Metadata Fields

### 1. repoCommit & repoUrl
**Source Priority:**
1. **CI Environment** (preferred):
   - `repoCommit`: `process.env.GITHUB_SHA` or `process.env.CI_COMMIT_SHA`
   - `repoUrl`: `https://github.com/${process.env.GITHUB_REPOSITORY}` 
2. **Git Fallback** (local runs):
   - `repoCommit`: `git rev-parse HEAD`
   - `repoUrl`: Parse `git config --get remote.origin.url`

**Implementation:**
```typescript
// In presentation/report.ts
function getRepoInfo(): { repoCommit?: string; repoUrl?: string } {
  try {
    // Prefer CI environment
    if (process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY) {
      return {
        repoCommit: process.env.GITHUB_SHA,
        repoUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}`
      };
    }
    
    // Fallback to git commands
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim();
    
    // Convert git URL to https if needed
    const httpsUrl = remoteUrl.replace(/^git@github\.com:/, 'https://github.com/')
                              .replace(/\.git$/, '');
    
    return {
      repoCommit: commit,
      repoUrl: httpsUrl
    };
  } catch {
    // Git not available or not in repo
    return {};
  }
}
```

### 2. tenderlyUrl
**Source:** Tenderly simulation response
**Condition:** Only if simulation is saved (has `simulation.id`)

**Question for confirmation:** 
- Are Tenderly saves enabled in current setup?
- What's the correct dashboard URL format?

**Expected format:**
```
https://dashboard.tenderly.co/{TENDERLY_USER}/{TENDERLY_PROJECT_SLUG}/simulator/{simulation.id}
```

**Implementation:**
```typescript
// In utils/clients/tenderly.ts - after simulation creation
function getTenderlyUrl(simulation: any): string | undefined {
  if (!simulation.simulation?.id) return undefined;
  
  return `https://dashboard.tenderly.co/${TENDERLY_USER}/${TENDERLY_PROJECT_SLUG}/simulator/${simulation.simulation.id}`;
}
```

## 2. INCONCLUSIVE Status

### Current State Analysis
✅ **Confirmed:** No INCONCLUSIVE support exists yet
- Report status is only `success | warning | error`
- Backend sets status based on errors/warnings only
- No timeout/partial run handling

### Proposed INCONCLUSIVE Triggers
1. **Simulation timeout** (if Tenderly has timeout limits)
2. **Partial check execution** (if some checks fail to run)
3. **Cross-chain bridge failures** (L2 simulation fails but L1 succeeds)
4. **Network connectivity issues** during simulation

### Implementation Options

#### Option A: Add INCONCLUSIVE to backend (Full Implementation)
```typescript
// In types.d.ts
export interface StructuredSimulationReport {
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  // ...
}

// In presentation/report.ts
function generateStructuredReport(...): StructuredSimulationReport {
  let status: 'success' | 'warning' | 'error' | 'inconclusive' = 'success';
  
  // Check for inconclusive conditions first
  if (simulation.timedOut || checksPartiallyExecuted) {
    status = 'inconclusive';
  } else {
    // Existing error/warning logic
    for (const checkId in checks) {
      const { result } = checks[checkId];
      if (result.errors.length > 0) {
        status = 'error';
        break;
      }
      if (result.warnings.length > 0) {
        status = 'warning';
      }
    }
  }
  
  return { ...report, status };
}
```

#### Option B: UI-only implementation (MVP)
```typescript
// Frontend handles it as mapping
function getStatusInfo(report: StructuredSimulationReport): StatusInfo {
  // Custom logic to detect inconclusive conditions
  const hasPartialData = /* some heuristic */;
  
  if (hasPartialData) {
    return { label: 'INCONCLUSIVE', ... };
  }
  
  // Existing success/warning/error logic
}
```

## Recommendations

### For MVP (Issue #92):
1. **Implement repo/Tenderly links** - These are straightforward
2. **UI-only INCONCLUSIVE support** - Prepare frontend for future backend integration
3. **Backend can stay unchanged** initially

### For Full Implementation:
1. **Add backend INCONCLUSIVE triggers** - Timeout detection, partial execution
2. **Update types and report generation**
3. **Add specific conditions for when to set INCONCLUSIVE**

## Questions for Confirmation:

1. **Tenderly saves**: Are they enabled? What's the exact dashboard URL pattern?
2. **INCONCLUSIVE scope**: Should we implement backend logic now, or UI-only for MVP?
3. **Timeout detection**: Does Tenderly provide timeout indicators in responses?
4. **Cross-chain failures**: Should L2 simulation failure = INCONCLUSIVE when L1 succeeds?

## Proposed Approach:
**Start with repo/Tenderly links + UI-only INCONCLUSIVE**, then add backend INCONCLUSIVE logic in follow-up if needed.