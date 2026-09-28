This is the **Governance Seatbelt** frontend (Next.js).

It reads `public/simulation-results.json` via `GET /api/simulation-results` and renders the structured report + proposal payload.

## Getting Started

### 1) Configure env

Create `frontend/.env.local` (see `frontend/.env.local.example`):
- `NEXT_PUBLIC_MAINNET_RPC_URL`: used for wallet connections and block links
- `NEXT_PUBLIC_PROJECT_ID`: WalletConnect project id

In development, the app will fall back to demo defaults if these are missing (wallet connect may be limited).

### Local E2E propose/execute demo (no Tenderly)

From the repo root:

```bash
bun run e2e:local
```

Then follow the printed steps to connect your wallet to Localhost `31337`, click **Propose**, run
`bun run e2e:local:set-proposed`, and then click **Execute**.

### 2) Provide simulation results
Generate a real file by running a Seatbelt simulation from the repo root (requires Tenderly + RPCs):

```bash
SIM_NAME=optimism-bridge-test bun run sim
```

### 3) Run the development server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Production deploys for the viewer are automated by GitHub Actions via
`.github/workflows/deploy-seatbelt-viewer.yml`.

### CI deploy trigger

The workflow deploys to production when:

- a commit is pushed to `main`, and
- the change touches `frontend/**` (or the workflow file itself)

A manual deploy can also be started with **Actions → Deploy Seatbelt viewer → Run workflow**.

### Required GitHub secret

Configure this repository secret before enabling CI deploys:

- `VERCEL_TOKEN`: Vercel token with access to project `seatbelt-viewer` in scope `marcos-projects-5a62a7ed`

The workflow links the project non-interactively and runs `vercel deploy --prod`.

## Call UI stress fixture

Run `bun dev` in `frontend`, then open `/dev/call-fixtures`. This development-only
page renders the real Calls and calldata-check components with synthetic data;
it requires no report file or simulation. It returns 404 outside development.

Check at 320px, 390px, desktop, and 200% zoom:

- Function/contract names wrap; no horizontal page scroll.
- Named arguments retain their labels, links, and copy controls.
- Large call payloads stay compact until expanded; copy returns the full value.
- Event arguments stay visible in full, with no event expanders or duplicate previews.
- Repeated proxy targets and sentence-only decodes remain readable.
- Calls with several ordinary addresses keep every argument visible, including `false`.
- Destination calls show the forwarded call's arguments, not the transport's.
- Older destination reports without argument arrays decode their signature and calldata.
- Decode warnings, destination failures, and skipped calls remain visible.
- Clicking a function row or pressing Enter opens Technical details with complete input data.

These are presentation fixtures, not evidence of a successful onchain simulation.
