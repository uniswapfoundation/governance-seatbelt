# Arc integration spike

This is a simulation fixture; no governance transaction has been submitted.

Arc mainnet (5042) uses Wormhole chain ID 71. The supplied receiver is the live V2 fee setter and V3/V4 owner. Its payload version and sequence getters match Seatbelt's modern receiver path. The core address is from Wormhole's upstream SDK mainnet registry and was exercised in the receiver simulation.

Run `SIM_NAME=arc-bridge-test bun run sim` with the usual local credentials and Arc network access. The fixture calls authority-gated setters on all three supplied contracts while preserving their existing authority. It encodes the Arc receiver in the Ethereum sender message. No destination ownership overrides are used.

Verified September 16, 2026:

- Tenderly source simulation and Arc receiver execution succeeded for all three calls.
- Receiver sequence storage advanced from 0 to 1 in simulation.
- The existing live Arc authority test passed 12 assertions against the real receiver, core, and V2/V3/V4 governance authorities.
- Actual local frontend rendered Arc coverage, all three successful calls, warnings, and state changes.
- Backend and frontend typechecks passed. Backend tests: 480 passed, 45 skipped, 0 failed.

Limits:

- Wormhole core verification is stubbed, as in existing receiver simulations. This does not prove guardian verification, message delivery, or source/destination message equivalence.
- Arc is listed as healthy in the official Etherscan V2 chain registry. The integration now uses Etherscan V2, and the local report was regenerated. Authenticated source checks found verified source and ABI for the V4 PoolManager; the receiver and V2/V3 factories returned unverified results.
- Local solc-select encountered a compiler-download HTTP 403; the report retains the analysis warnings.
- Arc currently uses the generic chain icon.

Local preview: `cd frontend && NODE_OPTIONS=--no-experimental-webstorage bun run dev --hostname 127.0.0.1 --port 3117`. The Node option avoids the local Node 25 experimental storage incompatibility; the project targets Node 24.
