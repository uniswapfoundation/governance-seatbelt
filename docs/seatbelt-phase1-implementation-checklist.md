# Seatbelt Phase 1 (Vercel-first) — Implementation Checklist

Source plan: `research/seatbelt-phase1-vercel-execution-plan.md`

## Build Clean Scaffold (Mode A — Design)

- [x] **Invariants**
  - [x] Publish only validated simulation artifacts.
  - [x] Published output is read-only + reproducible for the same artifact.
  - [x] Viewer path does not mutate simulation payload.
- [x] **Source of truth**
  - [x] Existing `simulation-results.json` / `report.structuredReport` contract remains canonical.
  - [x] No new report schema introduced in Phase 1.
- [x] **Failure model (guardrails)**
  - [x] Hard-block publish when required contract fields are missing/invalid.
  - [x] Hard-block publish when schema version is unsupported.
  - [x] Hard-block publish when `simulationType=executed` lacks executed metadata.
- [x] **Observability (minimum metadata)**
  - [x] `publish_id`
  - [x] `published_at`
  - [x] `artifact_hash`

## Day 1 — Contract + guardrails

- [x] Lock required pre-publish contract fields and schema gate (`schemaVersion=1`).
- [x] Add explicit, path-level validation errors for publish failures.
- [x] Ensure invalid artifacts cannot pass upload validation.
- [x] Add fixture coverage for `new`, `proposed`, `executed` contexts.

## Day 2 — Local preview parity

- [ ] Confirm local preview render path is identical to publish bundle render path.
- [ ] Add visible metadata header (simulation type, timestamp, schema version).
- [ ] Add empty/missing-data fallback UX polish for viewer.

## Day 3 — `bun upload` Vercel publish path

- [x] Scaffold `bun upload` command shape and validation wiring.
- [x] Build/inject publish bundle from validated artifact.
- [x] Wire Vercel deploy step (auth/link/project) and return share URL.
- [ ] Add duplicate publish protection keyed by artifact hash.

## Day 4 — E2E hardening

- [ ] Run happy-path end-to-end for pre-proposal and post-onchain flows.
- [ ] Add failure-path checks: invalid schema, deploy failure, oversized payload.
- [ ] Improve CLI recovery guidance and retries.

## Day 5 — Docs + handoff

- [ ] Document full `simulate → preview → upload` runbook.
- [ ] Add troubleshooting for validator and Vercel deployment.
- [ ] Capture demo artifact + published URL reference.
