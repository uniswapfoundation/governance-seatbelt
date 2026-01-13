# Repo protections

This repo is designed to be safe even when it is not actively maintained.

## Goals

- Keep `main` protected from accidental or malicious changes.
- Avoid “fail-closed” rules that block merges when maintainers are unavailable.
- Prefer automation gates (required CI checks) over required human reviews.

## CODEOWNERS

We use `.github/CODEOWNERS` to route review requests for critical paths (CI, dependency/toolchain files, and check execution code).

Notes:
- CODEOWNERS only *blocks merges* if branch protection enables “Require review from Code Owners”.
- To avoid fail-closed behavior, we do **not** require code-owner reviews by default.

## Recommended `main` branch protection (fail-open)

Configure these in GitHub repo settings (they are not stored in git):

- Require a pull request before merging: **ON**
- Required approvals: **0**
- Require review from Code Owners: **OFF**
- Require status checks to pass before merging: **ON**
  - Required checks:
    - `Run Type Check`
    - `Gitleaks Secret Scan`
- Require conversation resolution before merging: **OFF**
- Allow force pushes: **OFF**
- Include administrators: **OFF** (admins can bypass in emergencies)

## If you want stricter later

If the repo becomes actively maintained again, consider:
- Setting required approvals to **1+**
- Enabling “Require review from Code Owners”
- Adding required checks like `Run Tests` and `Check Uniswap Proposals` (and any future CodeQL checks)
- Enabling “Require branches to be up to date before merging” (status checks “strict”)
