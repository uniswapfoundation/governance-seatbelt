# Phase 1 Publish Contract (Vercel-first)

This document captures the Day 1 publish guardrails used by `bun upload`.

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

## Command shape

- Validate-only: `bun upload --validate-only`
- Publish scaffold hook: `bun upload --publish`
  - Day 1 status: Vercel deploy hook reserved and intentionally blocked until Day 3 wiring.
