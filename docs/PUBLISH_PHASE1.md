# Phase 1 Publish Contract (Vercel-first)

This document captures the publish guardrails used by `bun upload`.

## Canonical artifact input

- Input file: `simulation-results.json`
- Source of truth: existing `proposalData` + `report.structuredReport` contract
- No new report schema is introduced in Phase 1

## Hard-block required fields

`bun upload` blocks publish when any of these are missing/invalid:

- `report.structuredReport.metadata.schemaVersion === 1`
- `report.structuredReport.metadata.simulationType` in `new | proposed | executed`
- `report.structuredReport.metadata.proposalId`
- `report.structuredReport.metadata.governorAddress` (20-byte `0x` address)
- `report.structuredReport.metadata.chainId` (positive integer)
- `report.structuredReport.metadata.simulationBlockNumber` (base-10 string)
- `report.structuredReport.metadata.simulationTimestamp` (base-10 string)
- `report.structuredReport.metadata.proposalCreatedAtBlockNumber` (`base-10 string` or `"unknown"`)
- `report.structuredReport.metadata.proposalCreatedAtTimestamp` (`base-10 string` or `"unknown"`)
- if `simulationType === "executed"`, both:
  - `proposalExecutedAtBlockNumber`
  - `proposalExecutedAtTimestamp`
- `report.status` must match `report.structuredReport.status`
- proposal call arrays must be length-aligned (`targets`, `values`, `signatures`, `calldatas`)

## Phase 1 publish metadata (minimal)

On successful validation, `bun upload` records:

- `publish_id`
- `published_at`
- `artifact_hash` (SHA-256 over artifact bytes)

Current log destination: `.seatbelt/publish-log.jsonl`

## Day 3 Vercel publish implementation

`bun upload --publish` now performs a real, non-interactive Vercel deploy using either:

- `VERCEL_TOKEN` or `SEATBELT_VERCEL_TOKEN`
- `VERCEL_PROJECT_ID` or `SEATBELT_VERCEL_PROJECT_ID`
- `VERCEL_ORG_ID` or `SEATBELT_VERCEL_ORG_ID`

Precedence: if both variants are set, `VERCEL_*` wins.

The command deploys a local temporary bundle containing:

- `simulation-results.json` (validated artifact)
- `publish-metadata.json` (publish metadata)
- `index.html` (minimal viewer/links)

No Git import flow is required.

## One-time setup (exact commands)

Run from repo root:

```bash
# 1) Install Vercel CLI (once per machine)
bun add -g vercel

# 2) Link this repo to the target Vercel project (writes .vercel/project.json)
vercel link --yes

# 3) Create a token in Vercel Dashboard and export required vars
export VERCEL_TOKEN="<token-from-vercel-account-settings>"
export VERCEL_PROJECT_ID="<projectId-from-.vercel/project.json>"
export VERCEL_ORG_ID="<orgId-from-.vercel/project.json>"

# Optional aliases (supported for teams that namespace env vars)
export SEATBELT_VERCEL_TOKEN="$VERCEL_TOKEN"
export SEATBELT_VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID"
export SEATBELT_VERCEL_ORG_ID="$VERCEL_ORG_ID"
```

Tip: copy those `export` lines into your shell profile or secret manager.

## Command shape

```bash
# Validate + metadata log only
bun upload --validate-only

# Validate + publish (provider selected by flags/env)
bun upload --publish

# Explicit providers
bun upload --publish --publish-provider managed --managed-publish-url https://publish.example/api/v1/publishes
bun upload --publish --publish-provider vercel

# Optional custom paths
bun upload --artifact frontend/public/simulation-results.json --log .seatbelt/publish-log.jsonl --publish
```

## Phase 1C scaffold (managed relay default path)

`bun upload` now includes a feature-flagged managed relay scaffold to support a zero-setup publish path:

- `--publish-provider auto|managed|vercel`
- `--managed-publish-url <url>`
- `SEATBELT_ENABLE_MANAGED_PUBLISH=1` (makes `auto` pick managed relay)
- `SEATBELT_MANAGED_PUBLISH_URL`
- `SEATBELT_MANAGED_PUBLISH_TIMEOUT_MS`
- `SEATBELT_MANAGED_PUBLISH_MAX_BYTES`

BYO Vercel remains fully supported as the advanced fallback mode.

See `docs/PUBLISH_PHASE1C.md` for full architecture/tradeoffs.
