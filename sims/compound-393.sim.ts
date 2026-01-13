/**
 * @notice Example executed proposal that triggers permission diffs (Timelock admin change).
 * Useful for validating structuredReport.permissionsDiff in the report + frontend UI.
 */
import type { SimulationConfigExecuted } from '../types';

export const config: SimulationConfigExecuted = {
  type: 'executed',
  daoName: 'Compound',
  governorAddress: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529',
  governorType: 'bravo',
  proposalId: 393,
};
