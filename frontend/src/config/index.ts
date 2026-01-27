import { GOVERNOR_ABI } from './abis';
import { projectId, queryClient, config as wagmiConfig, walletConnectEnabled } from './wagmi';

// State names for readability
export const PROPOSAL_STATES = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
];

// Default Uniswap Governor Bravo address
export const DEFAULT_GOVERNOR_ADDRESS = '0x408ED6354d4973f66138C91495F2f2FCbd8724C3';
export const DEFAULT_DAO_NAME = 'Uniswap';

// Paths to data directories
export const REPORTS_DIR = process.env.REPORTS_DIR || '../reports';
export const SIMS_DIR = process.env.SIMS_DIR || '../sims';

export { GOVERNOR_ABI };
export { wagmiConfig, queryClient, projectId, walletConnectEnabled };
