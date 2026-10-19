import { expect, test } from 'bun:test';
import { checkEthBalanceChanges } from '../checks/check-eth-balance-changes';
import { checkStateChanges } from '../checks/check-state-changes';
import { checkTreasuryMovement } from '../checks/check-treasury-movement';
import { config } from '../sims/eth-and-erc20-transfer.sim';
import { simulateNew } from '../utils/clients/tenderly';

const liveTest = process.env.RUN_RPC_INTEGRATION_TESTS === '1' ? test : test.skip;

liveTest(
  'RPC governance draft executes real transfers and reports transfers and reverts',
  async () => {
    const result = await simulateNew(config);
    expect(result.sim.provider).toBe('rpc');
    expect(result.sim.transaction.status).toBe(true);
    expect(result.sim.transaction.transaction_info.logs?.length).toBeGreaterThan(0);
    expect(result.sim.transaction.transaction_info.state_diff?.length).toBeGreaterThan(0);
    for (const check of [checkEthBalanceChanges, checkTreasuryMovement]) {
      const coverage = await check.checkProposal(result.proposal, result.sim, result.deps);
      expect(coverage.skipped).toBeUndefined();
      expect(
        result.sim.transaction.transaction_info.asset_changes?.some(
          (change) => change.token_info.standard === 'NativeCurrency',
        ),
      ).toBe(true);
      expect(
        result.sim.transaction.transaction_info.asset_changes?.some(
          (change) => change.token_info.standard === 'ERC20',
        ),
      ).toBe(true);
    }

    const failed = await simulateNew({
      ...config,
      targets: [config.targets[1]],
      values: [0n],
      signatures: [''],
      calldatas: ['0xdeadbeef'],
    });
    expect(failed.sim.transaction.status).toBe(false);
    const stateCheck = await checkStateChanges.checkProposal(
      failed.proposal,
      failed.sim,
      failed.deps,
    );
    expect(stateCheck.errors[0]).toContain('Transaction reverted');
  },
  240_000,
);
