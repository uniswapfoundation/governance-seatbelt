# Report signatures (Sigstore / cosign)

This repo can optionally publish a signed bundle of the generated governance reports so downstream consumers (e.g. automated ingestion) can verify integrity and provenance.

## What gets published

In the `Governance Checks` GitHub Action workflow, successful non-`pull_request` runs package the report directory into a deterministic tarball and upload it as a separate artifact:

- `Uniswap-report.tgz`
- `Uniswap-report.tgz.sha256`
- `Uniswap-report.sigstore.json` (Sigstore bundle)

The signed artifact is uploaded as `Uniswap-signed`.

## Verifying locally

Prereqs:

- `cosign` installed (https://docs.sigstore.dev/cosign/)

Verify the Sigstore bundle against the expected GitHub Actions identity:

```sh
cosign verify-blob \
  --bundle Uniswap-report.sigstore.json \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity "https://github.com/uniswapfoundation/governance-seatbelt/.github/workflows/governance-checks.yaml@refs/heads/main" \
  Uniswap-report.tgz
```

Optionally verify the checksum:

```sh
sha256sum -c Uniswap-report.tgz.sha256
```

## Notes for automated ingestion (e.g. Tally)

- Only ingest the signed bundle from non-`pull_request` runs; the workflow intentionally skips signing for PRs.
- Prefer selecting a specific workflow run on `main` (and an allowlist of events like `schedule`/`push`/`workflow_dispatch`) rather than “latest of anything”.
