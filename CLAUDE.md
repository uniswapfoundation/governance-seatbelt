# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Main Application:**
- `bun start` - Run governance simulation and checks on all proposals
- `SIM_NAME=<simulation> bun start` - Run specific simulation (see `sims/` folder)
- `bun run check-proposal` - Run checks on proposals using run-checks.ts
- `bun run typecheck` - Type check TypeScript files
- `bun run lint` - Run type check and biome linting
- `bun run lint:fix` - Fix linting issues automatically

**Frontend:**
- `bun run propose` - Run simulation and start frontend dev server
- `SIM_NAME=<simulation> bun run propose` - Run specific simulation and start frontend
- `cd frontend && bun dev` - Start frontend development server only
- `cd frontend && bun run typecheck` - Type check frontend code

**Testing:**
- `cd checks && bun test` - Run all tests in checks directory
- `cd checks && bun test <test-file>` - Run specific test file

**Running Specific Proposals:**
- `bun run check-proposal <proposal-id>` - Run checks on specific proposal using environment variables
- `./run-proposal.sh <proposal-id>` - Run checks on specific Uniswap proposal (sets DAO_NAME and GOVERNOR_ADDRESS)
- `DAO_NAME=<dao> GOVERNOR_ADDRESS=<address> bun run-checks.ts <proposal-id>` - Run checks on specific proposal with custom DAO

## Architecture Overview

This is a governance safety tool that simulates on-chain proposals and runs safety checks against them.

**Core Flow:**
1. **Simulation**: Uses Tenderly API to simulate proposal execution
2. **Cross-chain**: Handles L1→L2 bridge messages (currently Arbitrum)
3. **Checks**: Runs safety checks on simulation results
4. **Reports**: Generates markdown reports and structured data

**Key Components:**
- `index.ts` - Main entry point, orchestrates simulation and checking
- `checks/` - Individual safety checks (state changes, logs, balance changes, etc.)
- `utils/clients/` - External service clients (Tenderly, Etherscan, GitHub)
- `utils/contracts/` - Governor and timelock contract interactions
- `sims/` - Custom simulation configurations
- `frontend/` - Next.js app for proposal visualization and creation

**Governor Support:**
- Compound GovernorBravo (`bravo` type)
- OpenZeppelin Governor (`oz` type)

**Environment Setup:**
Requires `.env` file with:
- `ETHERSCAN_API_KEY` - For contract verification
- `RPC_URL` - Ethereum node endpoint
- `TENDERLY_ACCESS_TOKEN`, `TENDERLY_USER`, `TENDERLY_PROJECT_SLUG` - For simulations
- `DAO_NAME`, `GOVERNOR_ADDRESS` - Target governance configuration

**Report Generation:**
- Reports saved to `reports/` directory (gitignored)
- Path: `./reports/${daoName}/${governorAddress}/${proposalId}.md`
- Structured data available via frontend API at `/api/simulation-results`

**Cross-chain Flow:**
1. Simulates mainnet proposal execution
2. Extracts cross-chain messages from logs
3. Simulates destination chain execution
4. Runs checks on both chains
5. Generates combined reports

**Cross-chain Testing:**
To verify cross-chain functionality is working correctly, run these test simulations:
- `SIM_NAME=uni-transfer bun start` - Non-cross-chain simulation (should succeed)
- `SIM_NAME=arb-distro bun start` - Arbitrum cross-chain simulation (should succeed)
- `SIM_NAME=optimism-bridge-test bun start` - Optimism cross-chain simulation (should succeed)

All three simulations should complete successfully without failures for the system to be considered working correctly.

## Pull Request Guidelines

**Repository Setup:**
- This is a fork of the main Uniswap governance-seatbelt repository
- Always create PRs against this fork: https://github.com/uniswapfoundation/governance-seatbelt/pulls
- Do NOT create PRs against the upstream Uniswap repository unless specifically requested
- The fork serves as the primary development repository for this project