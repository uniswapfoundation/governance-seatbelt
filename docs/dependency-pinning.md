# Dependency pinning strategy

This repository pins CI tooling for reproducibility while keeping application dependencies flexible.

## What is pinned

- **GitHub Actions**: All `uses:` references are pinned to commit SHAs.
- **Runner image**: CI uses `ubuntu-24.04` (fallback: standardize on `ubuntu-22.04` if toolchain issues arise).
- **Bun**: `.bun-version` is the single source of truth and is read by workflows.
- **Python tools**: CI installs from `requirements-ci.txt` with explicit versions.
- **JS dependencies**: `package.json` uses ranges, but `bun.lockb` is treated as the real pin.
- **Install mode**: CI uses `bun install --frozen-lockfile` to enforce deterministic installs.

## Where to update pins

- **Bun**: edit `.bun-version`, then regenerate `bun.lockb` if needed.
- **Python tools**: update `requirements-ci.txt` versions.
- **Runner image**: update `runs-on` in workflows under `.github/workflows/`.
- **Actions**: update `uses:` SHAs in workflows as needed.

## Validation steps

- Local checks:
  - `bun run check`
  - `bun test`
- CI should run without pulling `latest` versions and should fail if lockfiles drift.
