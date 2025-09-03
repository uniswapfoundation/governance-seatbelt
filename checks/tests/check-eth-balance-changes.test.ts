import { describe, expect, test } from 'bun:test';
import { config as simConfig } from '../../sims/eth-and-erc20-transfer.sim';
import type { SimulationConfigNew } from '../../types';
import { simulateNew as simulate } from '../../utils/clients/tenderly';
import { checkEthBalanceChanges } from '../check-eth-balance-changes';

describe('checkEthBalanceChanges', () => {
  test('should correctly handle ETH and ERC20 transfers to the same address', async () => {
    const simResult = await simulate(simConfig);

    // Run the check
    const result = await checkEthBalanceChanges.checkProposal(
      simResult.proposal,
      simResult.sim,
      simResult.deps,
    );

    // Verify the results
    expect(result.info.length).toBeGreaterThan(0);

    // Check that the output contains the ETH balance changes table
    const tableHeader = result.info.find((msg) => msg.includes('ETH Balance Changes'));
    expect(tableHeader).toBeDefined();

    // Check that the table contains the recipient address with positive change
    const recipientAddress = '0x0000000000000000000000000000000000000123';
    const recipientRow = result.info.find(
      (msg) =>
        msg.includes(recipientAddress) &&
        msg.includes('color:green') &&
        msg.includes('+0.1000 ETH'),
    );
    expect(recipientRow).toBeDefined();

    // Check that the table contains the proposer address with negative change
    const proposerAddress = '0x0000000000000000000000000000000000001234';
    const proposerRow = result.info.find(
      (msg) =>
        msg.includes(proposerAddress) && msg.includes('color:red') && msg.includes('-0.1000 ETH'),
    );
    expect(proposerRow).toBeDefined();

    // Check that there's no mention of UNI tokens in the ETH balance changes
    const uniTokenMessage = result.info.find((msg) => msg.includes('UNI'));
    expect(uniTokenMessage).toBeUndefined();

    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('should report no ETH transfers when none exist', async () => {
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

    expect(result.info).toContain('No ETH transfers detected');
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
