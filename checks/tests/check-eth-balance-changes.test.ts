import { describe, expect, test } from 'bun:test';
import { config as simConfig } from '../../sims/eth-and-erc20-transfer.sim';
import type { SimulationConfigNew } from '../../types';
import { simulateNew as simulate } from '../../utils/clients/tenderly';
import { getAssetBalanceReport } from '../check-asset-balances';
import { checkEthBalanceChanges } from '../check-eth-balance-changes';
import { checkTreasuryMovement } from '../check-treasury-movement';

describe('checkEthBalanceChanges', () => {
  const integrationTest = process.env.RUN_RPC_INTEGRATION_TESTS === '1' ? test : test.skip;

  integrationTest(
    'should correctly handle ETH and ERC20 transfers to the same address',
    async () => {
      const simResult = await simulate(simConfig);

      // Run the check
      const result = await checkEthBalanceChanges.checkProposal(
        simResult.proposal,
        simResult.sim,
        simResult.deps,
      );

      const recipientAddress = '0x0000000000000000000000000000000000000123';
      expect(result.info.join(' ')).toContain('0.1 ETH');
      expect(result.info.join(' ')).toContain(recipientAddress);
      const native = simResult.sim.assetBalances!.find(
        (row) => row.address === recipientAddress && row.tokenAddress === null,
      )!;
      expect(BigInt(native.after!) - BigInt(native.before!)).toBe(100000000000000000n);
      const uni = simResult.sim.assetBalances!.find(
        (row) =>
          row.address === recipientAddress &&
          row.tokenAddress?.toLowerCase() === '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
      )!;
      expect(BigInt(uni.after!) - BigInt(uni.before!)).toBe(1000000000000000000000n);

      const balances = await getAssetBalanceReport(simResult.sim, simResult.deps);
      expect(balances.warnings).toHaveLength(0);
      const received = balances.data.rows.filter(
        (row) => row.address.toLowerCase() === recipientAddress.toLowerCase(),
      );
      expect(received.find((row) => row.symbol === 'UNI')?.change).toBe('+1000');
      expect(received.find((row) => row.symbol === 'UNI')?.usdChange).toBeGreaterThan(0);
      expect(received.find((row) => row.tokenAddress === null)?.usdChange).toBeGreaterThan(0);
      expect(received.every((row) => row.priceTimestamp !== null)).toBe(true);
      const treasury = await checkTreasuryMovement.checkProposal(
        simResult.proposal,
        simResult.sim,
        simResult.deps,
      );
      expect(treasury.warnings.join(' ')).toMatch(/Treasury .*UNI/);
      expect(treasury.warnings.join(' ')).not.toContain('valuation is incomplete');

      // Check that there's no mention of UNI tokens in the ETH balance changes
      const uniTokenMessage = result.info.find((msg) => msg.includes('UNI'));
      expect(uniTokenMessage).toBeUndefined();

      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    },
    30000,
  );

  integrationTest(
    'should report no ETH transfers when none exist',
    async () => {
      // Update the config to set the values to 0 so that no ETH transfers occur
      const noEthTransferConfig: SimulationConfigNew = {
        ...simConfig,
        values: simConfig.targets.map(() => 0n),
      };

      const simResult = await simulate(noEthTransferConfig);

      const result = await checkEthBalanceChanges.checkProposal(
        simResult.proposal,
        simResult.sim,
        simResult.deps,
      );

      // Check passes with info message when no ETH transfers detected
      expect(result.skipped).toBeUndefined();
      expect(result.info).toContain('No native asset transfers detected in this proposal.');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    },
    30000,
  );
});
