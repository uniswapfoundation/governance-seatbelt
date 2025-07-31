import type { ProposalCheck } from '../types';
import { checkDecodeCalldata } from './check-decode-calldata';
import { checkEthBalanceChanges } from './check-eth-balance-changes';
import { checkLogs } from './check-logs';
import { checkSlither } from './check-slither';
import { checkSolc } from './check-solc';
import { checkStateChanges } from './check-state-changes';
import {
  checkTargetsNoSelfdestruct,
  checkTouchedContractsNoSelfdestruct,
} from './check-targets-no-selfdestruct';
import {
  checkTargetsVerifiedOnBlockExplorer,
  checkTouchedContractsVerifiedOnBlockExplorer,
} from './check-targets-verified-etherscan';
import { checkValueRequired } from './check-value-required';

const ALL_CHECKS: {
  [checkId: string]: ProposalCheck;
} = {
  checkStateChanges,
  checkDecodeCalldata,
  checkLogs,
  checkTargetsVerifiedOnBlockExplorer,
  checkTouchedContractsVerifiedOnBlockExplorer,
  checkTargetsNoSelfdestruct,
  checkTouchedContractsNoSelfdestruct,
  checkValueRequired,
  checkEthBalanceChanges,
  // The solc check must be run before the slither check, because the compilation exports a zip file
  // which is consumed by slither. This prevents us from having to compile the contracts twice.
  checkSolc,
  checkSlither,
};

export default ALL_CHECKS;
