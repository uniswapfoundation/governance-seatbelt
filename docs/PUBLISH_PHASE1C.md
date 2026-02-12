# Phase 1C — Zero-setup publish default ("anyone can publish")

## Build Clean Scaffold

- **Mode:** B (design + low-risk scaffold)
- **Invariants:**
  1. Reuse existing `simulation-results.json` contract + validator (`validatePublishArtifact`).
  2. Keep publish output read-only + reproducible for a given `artifact_hash`.
  3. Preserve advanced BYO-Vercel path (`--publish-provider vercel`).
- **Source of truth (SoT):**
  - `report.structuredReport.metadata` and existing publish validator in `utils/publish/artifact-validator.ts`.
  - Existing publish metadata fields (`publish_id`, `published_at`, `artifact_hash`).
- **Failure model:**
  - Invalid artifact => hard fail before network.
  - Oversized payload => hard fail client-side before network.
  - Relay rate-limit / abuse response (429/413/etc.) => actionable CLI error.
  - Relay unavailable => fallback path remains available (`--publish-provider vercel`).
- **Observability:**
  - Existing local log: `.seatbelt/publish-log.jsonl`.
  - Relay request includes deterministic idempotency key (`artifact_hash`) + provenance metadata.

---

## Problem

Phase 1A/1B currently require each user to bring Vercel credentials locally. That adds setup/token friction and blocks the desired default UX: **single command publish for anyone**.

## Recommendation

Adopt a **managed publish relay** as the default provider, while keeping BYO-Vercel as an explicit fallback.

### UX target

```bash
bun upload --publish
```

- Default path (Phase 1C): managed relay (no local Vercel token/project setup).
- Advanced path: `bun upload --publish --publish-provider vercel` (unchanged power-user fallback).

---

## Proposed architecture (minimal viable)

1. **CLI (this repo)**
   - Validate artifact with existing validator.
   - Compute `artifact_hash` and append local publish log.
   - POST validated artifact + publish metadata + provenance to managed endpoint.

2. **Managed Publish Relay (new service, thin API)**
   - Endpoint: `POST /api/v1/publishes`
   - Server-side controls:
     - request body size cap (same order as frontend artifact cap)
     - IP + fingerprint token bucket rate limit
     - idempotency by `artifact_hash`
     - strict schema re-validation server-side
   - On accept: deploy to Seatbelt-owned Vercel project and return canonical URLs.

3. **Storage + provenance**
   - Persist metadata row keyed by `publish_id` and `artifact_hash`.
   - Record provenance fields (request timestamp, hashed IP/user-agent, relay version, source metadata).

### Relay response shape (proposed)

```json
{
  "deploymentUrl": "https://...",
  "artifactUrl": "https://.../simulation-results.json",
  "metadataUrl": "https://.../publish-metadata.json",
  "duplicateOfPublishId": "optional"
}
```

---

## Abuse/security controls (Phase 1C requirement)

- **Rate limiting:** per IP + sliding window token bucket (429 with retry guidance).
- **Payload limits:** reject oversized upload (413), plus client-side pre-check.
- **Idempotency/dedupe:** `Idempotency-Key = artifact_hash` to avoid duplicate deploy spam.
- **Provenance metadata:** include source (`seatbelt-cli`), runtime, artifact path, optional git context; store server-side audit fields.
- **Server-side revalidation:** never trust client-only validation.

---

## Tradeoffs

### Managed default (recommended)
- ✅ Zero setup for most users (best onboarding).
- ✅ Centralized abuse controls and observability.
- ✅ Enables deterministic publish policy and dedupe.
- ⚠️ Adds service operation burden (uptime, quotas, moderation).
- ⚠️ Introduces central dependency (must provide fallback path).

### BYO-Vercel only (current)
- ✅ Fully decentralized responsibility.
- ❌ High friction (token/project setup per user).
- ❌ No unified abuse controls or provenance pipeline.

---

## What was scaffolded in this PR

Feature-flagged CLI scaffold (no breaking default change yet):

- Added publish provider selection:
  - `--publish-provider auto|managed|vercel`
  - `--managed-publish-url <url>`
- Added environment gates for rollout:
  - `SEATBELT_ENABLE_MANAGED_PUBLISH=1` to make `auto` pick managed relay
  - `SEATBELT_MANAGED_PUBLISH_URL` relay endpoint
  - `SEATBELT_MANAGED_PUBLISH_TIMEOUT_MS` (optional)
  - `SEATBELT_MANAGED_PUBLISH_MAX_BYTES` (optional)
- Added managed relay request path with:
  - payload size pre-check
  - 429/413 specific error handling
  - idempotency + hash headers
  - provenance payload
- Preserved existing Vercel path as explicit fallback (`--publish-provider vercel`).

---

## Minimal implementation plan after scaffold

1. Stand up relay service endpoint (`POST /api/v1/publishes`) with authless rate-limited ingress.
2. Re-validate artifact server-side using same contract/validator.
3. Add artifact-hash dedupe table and publish metadata persistence.
4. Wire relay deploy worker to Seatbelt-owned Vercel project.
5. Flip CLI default from gated rollout to managed-by-default once service SLOs are stable.
