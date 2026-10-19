import { getAddress } from 'viem';

// Keep these exports side-effect free so test imports don't hard-require secrets.
export const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? '';
export const BLOCK_GAS_LIMIT = 30_000_000;

// Only required when running a specific sim from a config file
// Note that if SIM_NAME is defined, that simulation takes precedence over scanning mode with GitHub Actions
export const SIM_NAME = process.env.SIM_NAME ?? null;

// Only required to scan for new proposals and simulate with GitHub Actions
export const DAO_NAME = process.env.DAO_NAME ?? null;
export const GOVERNOR_ADDRESS = process.env.GOVERNOR_ADDRESS
  ? getAddress(process.env.GOVERNOR_ADDRESS)
  : null;
export const REPORTS_OUTPUT_DIRECTORY = 'reports';

// Re-export security constants (these can be imported without env validation)
export { SECURITY_TOOL_TIMEOUT_MS } from './security-constants';

// Slither configuration
// When true, allows Slither to run on unverified contracts (not recommended for security)
export const SLITHER_ALLOW_UNVERIFIED = process.env.SLITHER_ALLOW_UNVERIFIED === 'true';
