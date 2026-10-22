# Managed simulation access

Team users run their existing commands and enter a team access code once. They do
not configure RPC endpoints or explorer keys. The existing relay forwards permitted
simulation reads; local Seatbelt still builds proposals, runs checks and writes reports.
Frontend Share and `bun upload --publish` keep their existing paths.

## Operator setup

Configure these **on the existing `seatbelt-relay` project**, before releasing the client:

- `SEATBELT_ACCESS_CODE_SHA256`: lowercase SHA-256 of a randomly generated team code
  with at least 32 random bytes. Distribute the code privately; never commit or log it.
- `QUICKNODE_RPC_URL` and destination `*_RPC_URL` variables from `.env.example`.
- `ETHERSCAN_API_KEY`; `BLOCKSCOUT_API_KEY` for Arc's private explorer fallback.
- Existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- Optional `SEATBELT_REQUESTS_PER_DAY`, a positive integer, defaults to 100,000.

Deploy the relay first, verify a simulation, then release the client. The access
endpoints return 503 until configured. Existing publishing and report viewing do
not require the simulation code.

Access validation checks the code and required mainnet configuration. Destination
availability is checked when that chain is requested; missing endpoints fail explicitly.

The same passcode grants access to the team pool. Anyone with it can use that pool.
It is not embedded in the repository, frontend or reports. To revoke it, replace
the server hash with a new code's hash and redeploy. Old codes stop working; the
next interactive command asks for the replacement.

## Limits and failure behavior

- Only listed read/simulation RPC methods and known chains are accepted. Transaction
  broadcasting, arbitrary URLs, JSON-RPC batches and JavaScript tracers are rejected.
- Redis atomically enforces shared limits across relay instances: 6,000 requests
  per minute, 20 traces per second per chain, three explorer lookups per second,
  and the daily allowance above. Counters expire from the first request in each window.
- An exhausted limit returns 429 with `Retry-After`; unavailable quota storage fails
  closed. Simulation traces retain their existing bounded retries.
- Calls are capped at 30 million gas. Trace execution has a 20-second provider timeout;
  upstream requests have a 30-second timeout.
- Requests are limited to 1 MiB. Provider JSON is limited to 32 MiB before compression
  and 4 MiB after gzip, below the relay host's response limit. Oversized results fail
  explicitly rather than being truncated.
- Provider errors are sanitized. Credentials are sent only to configured providers,
  never returned to clients or included in reports.

Local compiler and Slither checks fetch verified Solidity source through the relay
and run the installed tools locally. They still require the usual local tools and
internet access for compiler downloads and public data sources such as DefiLlama.
Missing exact compiler versions are installed through `solc-select`; the user's
global compiler selection is left unchanged. Installation or compilation failures
are reported as warnings, never as successful compilation.

## Local verification

`SEATBELT_RELAY_URL` can point to an isolated relay. HTTPS is required except on
localhost. Saved codes are scoped to that relay's origin. Direct-provider CI remains
supported by setting `QUICKNODE_RPC_URL`; this selects direct access for every chain
and does not prompt or fall back to managed access for missing destinations.

With Anvil and Redis installed:

```bash
bun test tests/managed-access.integration.test.ts
```

This exercises the actual hidden terminal prompt, private credential persistence,
simulation reads against Anvil, shared limits across two relay instances, and
rejection without provider traffic.
