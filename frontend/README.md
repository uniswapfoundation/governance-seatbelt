This is the **Governance Seatbelt** frontend (Next.js).

It reads `public/simulation-results.json` via `GET /api/simulation-results` and renders the structured report + proposal payload.

## Getting Started

### 1) Configure env

Create `frontend/.env.local` (see `frontend/.env.local.example`):
- `NEXT_PUBLIC_MAINNET_RPC_URL`: used for wallet connections and block links
- `NEXT_PUBLIC_PROJECT_ID`: WalletConnect project id

In development, the app will fall back to demo defaults if these are missing (wallet connect may be limited).

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

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
