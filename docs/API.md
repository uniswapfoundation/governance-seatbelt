# Seatbelt Report "API" (JSON Contracts)

This doc defines the **versioned JSON contracts** emitted by `@uniswap/governance-seatbelt` for:
- local frontend consumption (`frontend/public/simulation-results.json`)
- CI/GitHub artifact consumption (`reports/**` and `*-simulation-results.json`)

The goal is **stable + machine-readable** output. Consumers should be **forward-compatible** (ignore unknown fields).

## Outputs (files + when)

### 1) `simulation-results.json` (frontend / integration wrapper)

**Written when**:
- Local `SIM_NAME=... bun run sim` → `frontend/public/simulation-results.json`
- Bulk mode (no `SIM_NAME`) → `reports/<dao>/<governor>/<proposalId>-simulation-results.json`

**Shape**: either a single object or an array of objects (consumers should normalize to an array).

Top-level structure:
- `proposalData`: the calldata bundle that was simulated (and can be re-used to propose)
- `report`: human + machine readable simulation output

### 2) `reports/.../<proposalId>.json` (structured report only)

**Written when**: always (both local and CI) alongside `.md/.html/.pdf`.

**Shape**: `StructuredSimulationReport` (defined below).

### 3) `reports/.../<proposalId>-coverage.json` (coverage only)

**Written when**: coverage data is available (Seatbelt typically includes this in both CI and local runs).

**Shape**: `CoverageData` (defined below).

Also note: `StructuredSimulationReport.coverage` embeds the same `CoverageData` object when available.

## Consumer "four-gate" rule (authoritative)

Consumers should treat these outputs as a **pipeline** with four gates. If a gate fails, stop and degrade safely.

1) **Gate 1 — Parse**
   - The JSON must parse.
   - Normalize to an array: if the value is an object, treat it as a single-element array.

2) **Gate 2 — Identity**
   - The consumer must confirm it is looking at the intended proposal:
     - `report.structuredReport.metadata.proposalId` matches the proposal id it expects, and
     - `report.structuredReport.metadata.governorAddress` matches the governor it expects (when present), and
     - `report.structuredReport.metadata.chainId` matches the chain it expects (when present).

3) **Gate 3 — Completeness**
   - If `report.structuredReport.status === "inconclusive"`, treat as incomplete.
   - If `report.structuredReport.coverage` exists:
     - If `coverage.summary.skipped > 0`, treat as incomplete.
     - If `coverage.summary.inferredSkips > 0`, treat as incomplete (heuristic skips indicate partial execution).
   - If `report.structuredReport.crossChain` exists:
     - If any `crossChain.messages[].status === "failure"`, treat as incomplete (destination simulation did not complete).

4) **Gate 4 — Decision**
   - Use `report.structuredReport.status` as the canonical decision bucket:
     - `"success"` → PASS
     - `"warning"` → WARN
     - `"error"` → FAIL
     - `"inconclusive"` → INCONCLUSIVE

## Types (canonical)

These are the canonical TypeScript shapes for consumers. In JSON:
- `bigint` values are serialized as **decimal strings**
- `Address`/`Hex` are serialized as **0x-prefixed strings**

### `simulation-results.json`

```ts
export type SimulationResultsFile = FrontendData | FrontendData[];

export interface FrontendData {
  proposalData: {
    id: string;                 // e.g. "123"
    targets: `0x${string}`[];   // call targets
    values: string[];           // decimal strings
    signatures: string[];       // function signatures (may be empty for OZ governors)
    calldatas: `0x${string}`[]; // calldata per action
    description: string;        // full proposal text
  };
  report: {
    status: 'success' | 'warning' | 'error' | 'inconclusive';
    summary: string;            // short text summary, safe to display
    markdownReport: string;     // full markdown report for humans
    structuredReport?: StructuredSimulationReport; // machine contract
  };
}
```

### `StructuredSimulationReport` (machine contract)

```ts
export interface StructuredSimulationReport {
  title: string;
  proposalText: string;

  // Canonical decision bucket (see four-gate rule).
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  summary: string;

  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];

  // Optional structured payloads.
  permissionsDiff?: PermissionsDiffItem[];
  calldata?: SimulationCalldata;
  coverage?: CoverageData;

  // Optional cross-chain preview (added by PR #128; absent on older runs).
  crossChain?: CrossChainPreview;

  metadata: {
    proposalId: string;                 // formatted proposal id (e.g. "123" or "u-123")
    proposer: string;                   // 0x address
    proposerIsPlaceholder?: boolean;
    governorAddress: string;            // 0x address
    executor?: string;                  // 0x address (executed proposals only)
    executorIsPlaceholder?: boolean;

    // Simulation time + block on the source chain.
    simulationBlockNumber: string;      // decimal string, or "unknown"
    simulationTimestamp: string;        // unix seconds as string

    // Proposal lifecycle metadata (when available).
    proposalCreatedAtBlockNumber: string; // decimal string, or "unknown"
    proposalCreatedAtTimestamp: string;   // unix seconds as string, or "unknown"
    proposalExecutedAtBlockNumber?: string;
    proposalExecutedAtTimestamp?: string;

    // Extended metadata for integration/versioning.
    schemaVersion?: number;             // currently 1
    chainId?: number;                   // e.g. 1
    chainName?: string;                 // e.g. "Ethereum"
    blockExplorerBaseUrl?: string;      // e.g. "https://etherscan.io"
    simulationType?: 'executed' | 'proposed' | 'new';

    // A set of known placeholder addresses that integrations can badge/highlight.
    placeholderAddresses?: string[];

    // Provenance links (when available).
    repoCommit?: string;
    repoUrl?: string;
    tenderlyUrl?: string;

    // Optional enrichment for entity naming (when available).
    addressLabels?: Record<string, AddressLabel>;
  };
}
```

### `CoverageData` (execution coverage)

Coverage is about **whether each check executed**, not whether it passed.

```ts
export interface CoverageData {
  metadata: CoverageMetadata;
  checks: CheckCoverage[];
  summary: {
    total: number;
    ran: number;
    skipped: number;
    failed: number;
    inferredSkips: number;
  };
}

export interface CoverageMetadata {
  gitCommitHash: string;
  gitBranch: string;
  timestamp: string; // ISO string
  solcVersion?: string;
  slitherVersion?: string;
  bunVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  runnerOs?: string;
}

export interface CheckCoverage {
  checkId: string;                      // stable identifier (e.g. "check-treasury-movement")
  checkName: string;                    // human label
  status: 'ran' | 'skipped' | 'failed'; // coverage status
  skipReason?: string;                  // present when skipped
  wasInferred?: boolean;                // true when a skip was inferred heuristically
  chainId?: number;                     // present when coverage is aggregated across chains
  executionTimeMs?: number;             // reserved (may be absent)
}
```

### `CrossChainPreview` (destination simulation preview)

This is a lightweight, UI-friendly summary of extracted L2 messages. It is **optional** and may be absent.

```ts
export interface CrossChainPreview {
  messages: CrossChainMessagePreview[];
}

export interface CrossChainMessagePreview {
  chainId: number;
  chainName: string;
  blockExplorerBaseUrl: string;
  bridgeType: string;                    // e.g. "ArbitrumL1L2" | "OptimismL1L2"
  status: 'success' | 'failure';
  error?: string;

  l2FromAddress?: `0x${string}`;
  l2TargetAddress?: `0x${string}`;
  l2Value?: string;                      // decimal string
  l2InputData?: `0x${string}`;           // calldata

  // Optional label inferred from the destination simulation contract list.
  targetLabel?: string;

  // Optional decode (best-effort).
  call?: {
    selector: `0x${string}`;
    signature?: string;                  // e.g. "transfer(address,uint256)"
    args?: unknown[];                    // optional; present when full decoding is available
  };
}
```

## Field semantics (quick reference)

### Status semantics

- `StructuredSimulationReport.status` is computed from check results:
  - `"error"`: at least one check produced `errors[]`
  - `"warning"`: no errors, but at least one check produced `warnings[]`
  - `"inconclusive"`: at least one check was skipped (`result.skipped`) on the source chain
  - `"success"`: no errors, no warnings, no skipped checks

If `coverage` exists, consumers should prefer `coverage.summary.skipped/inferredSkips` for completeness gating.

### Permission diff semantics (`permissionsDiff`)

If present, this is a list of **permission-relevant** changes detected during the simulation.

```ts
export type PermissionsDiffItem =
  | {
      kind: 'ownership_transferred';
      contractAddress: `0x${string}`;
      contractName?: string;
      previous?: `0x${string}`;
      next: `0x${string}`;
      via: 'event' | 'state_diff' | 'event+state_diff';
    }
  | {
      kind: 'role_granted' | 'role_revoked';
      contractAddress: `0x${string}`;
      contractName?: string;
      role: { id: `0x${string}`; name: string | null };
      account: `0x${string}`;
      sender: `0x${string}`;
    }
  | {
      kind: 'timelock_admin_changed' | 'timelock_pending_admin_changed';
      contractAddress: `0x${string}`;
      contractName?: string;
      previous?: `0x${string}`;
      next: `0x${string}`;
      via: 'event' | 'state_diff' | 'event+state_diff';
    };
```

## Examples (valid JSON)

### Example A: PASS (single object)

```json
{
  "proposalData": {
    "id": "123",
    "targets": ["0x0000000000000000000000000000000000000001"],
    "values": ["0"],
    "signatures": ["transfer(address,uint256)"],
    "calldatas": ["0xa9059cbb0000000000000000000000000000000000000000000000000000000000000002"],
    "description": "# Example\n\nDo the thing."
  },
  "report": {
    "status": "success",
    "summary": "No meaningful state changes detected. Simulation completed successfully.",
    "markdownReport": "# Example\n\n...",
    "structuredReport": {
      "title": "Example",
      "proposalText": "# Example\n\nDo the thing.",
      "status": "success",
      "summary": "No meaningful state changes detected. Simulation completed successfully.",
      "checks": [],
      "stateChanges": [],
      "events": [],
      "metadata": {
        "proposalId": "123",
        "proposer": "0x0000000000000000000000000000000000000003",
        "governorAddress": "0x0000000000000000000000000000000000000004",
        "simulationBlockNumber": "20000000",
        "simulationTimestamp": "1700000000",
        "proposalCreatedAtBlockNumber": "19999900",
        "proposalCreatedAtTimestamp": "1699990000",
        "schemaVersion": 1,
        "chainId": 1,
        "chainName": "Ethereum",
        "blockExplorerBaseUrl": "https://etherscan.io",
        "simulationType": "proposed",
        "placeholderAddresses": ["0x0000000000000000000000000000000000000000"]
      }
    }
  }
}
```

### Example B: INCONCLUSIVE (array form)

```json
[
  {
    "proposalData": {
      "id": "456",
      "targets": [],
      "values": [],
      "signatures": [],
      "calldatas": [],
      "description": "# Example\n\nSome checks may be skipped."
    },
    "report": {
      "status": "inconclusive",
      "summary": "Some checks were skipped. Simulation completed with inconclusive results.",
      "markdownReport": "# Example\n\n...",
      "structuredReport": {
        "title": "Example",
        "proposalText": "# Example\n\nSome checks may be skipped.",
        "status": "inconclusive",
        "summary": "Some checks were skipped. Simulation completed with inconclusive results.",
        "checks": [
          {
            "checkId": "slither-timelock",
            "title": "Slither (Timelock)",
            "status": "skipped",
            "skipReason": "verification skipped",
            "warningCount": 0,
            "errorCount": 0,
            "details": "**Skipped**: verification skipped",
            "info": [],
            "warnings": [],
            "errors": []
          }
        ],
        "stateChanges": [],
        "events": [],
        "metadata": {
          "proposalId": "456",
          "proposer": "0x0000000000000000000000000000000000000003",
          "governorAddress": "0x0000000000000000000000000000000000000004",
          "simulationBlockNumber": "20000000",
          "simulationTimestamp": "1700000000",
          "proposalCreatedAtBlockNumber": "unknown",
          "proposalCreatedAtTimestamp": "unknown",
          "schemaVersion": 1,
          "chainId": 1,
          "chainName": "Ethereum",
          "blockExplorerBaseUrl": "https://etherscan.io",
          "simulationType": "proposed"
        }
      }
    }
  }
]
```

## Integration examples

### TypeScript (Node/Bun) — normalize + apply four-gate rule

```ts
import { readFile } from 'node:fs/promises';

type Decision = 'PASS' | 'WARN' | 'FAIL' | 'INCONCLUSIVE';

export async function loadSeatbeltDecision(filePath: string): Promise<Decision> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const results = Array.isArray(raw) ? raw : [raw];

  const first = results[0] as any;
  const structured = first?.report?.structuredReport as any | undefined;
  if (!structured?.metadata?.proposalId) return 'INCONCLUSIVE';

  // Gate 3: completeness
  if (structured.status === 'inconclusive') return 'INCONCLUSIVE';
  const cov = structured.coverage;
  if (cov && (cov.summary?.skipped > 0 || cov.summary?.inferredSkips > 0)) return 'INCONCLUSIVE';
  const cc = structured.crossChain;
  if (cc?.messages?.some((m: any) => m.status === 'failure')) return 'INCONCLUSIVE';

  // Gate 4: decision
  if (structured.status === 'error') return 'FAIL';
  if (structured.status === 'warning') return 'WARN';
  return 'PASS';
}
```

