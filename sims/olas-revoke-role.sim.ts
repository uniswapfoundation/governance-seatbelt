/**
 * @notice Example executed OZ governor proposal that triggers AccessControl role changes.
 * Used to validate `structuredReport.permissionsDiff` rendering for non-Bravo governors.
 */
import type { SimulationConfigExecuted } from '../types';

export const config: SimulationConfigExecuted = {
  type: 'executed',
  daoName: 'Autonolas',
  governorAddress: '0x8E84B5055492901988B831817e4Ace5275A3b401',
  governorType: 'oz',
  proposalId: 79620632494603959991831966498278269118176151937959839188081036473771718518508n,
};
