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

## Access model (MVP decision)

Published simulation viewer links are **unlisted public** — anyone with the URL can view, but
URLs are not indexed or discoverable. This is acceptable for governance transparency tooling
where the intent is sharing with specific stakeholders (delegates, multisig signers, forum
threads).

No authentication or access-control layer is needed on viewer URLs for MVP.

---

## Ownership model (interim → handoff)

### MVP (interim): Marco's personal Vercel account

The managed relay deploys to a Vercel project under Marco's personal account. This unblocks
shipping immediately without org-level procurement or access provisioning.

**What this means concretely:**
- Vercel project + deploy token are owned by Marco's personal account.
- Relay service uses Marco's token to deploy publish bundles.
- Published URLs live under a personal-account Vercel domain (e.g. `seatbelt-*.vercel.app`).

### Handoff plan (post-MVP)

Once UF/ScopeLift confirms org-level ownership:

1. **Create org Vercel project** under `uniswapfoundation` or `scopelift` team.
2. **Rotate deploy token** — generate new token under org, update relay service env.
3. **DNS/domain transfer** — if a custom domain is configured, point it to the org project.
4. **Existing links** — previously published deployments on the personal account remain
   accessible (Vercel keeps old deployments). New publishes go to the org project.
5. **Optional cleanup** — after confirming no active links depend on the personal project,
   it can be archived.

**Handoff is non-breaking** — the relay service is the only component that holds Vercel
credentials. CLI callers never see or depend on the Vercel project identity. Swapping the
backend project is a config change, not a code change.

### Risk mitigations during interim period
- Personal account Vercel free tier has generous deploy limits (100 deploys/day).
- If limits are hit, BYO-Vercel fallback (`--publish-provider vercel`) still works.
- Provenance metadata records which relay/project handled each publish for audit trail.

---

## Tradeoffs

### Managed default (recommended)
- ✅ Zero setup for most users (best onboarding).
- ✅ Centralized abuse controls and observability.
- ✅ Enables deterministic publish policy and dedupe.
- ✅ Unlisted-public links avoid auth complexity for MVP.
- ⚠️ Adds service operation burden (uptime, quotas, moderation).
- ⚠️ Introduces central dependency (must provide fallback path).
- ⚠️ Interim personal-account ownership adds handoff step (mitigated: config-only change).

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
4. Wire relay deploy worker to Marco's personal Vercel project (interim ownership).
5. Flip CLI default from gated rollout to managed-by-default once service SLOs are stable.
6. Execute ownership handoff (see "Ownership model" above) when org confirms.
