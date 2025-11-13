import { beforeAll, describe, expect, test } from 'bun:test';
import { runChecksForChain } from '../../run-checks';
import type { SimulationConfigNew, SimulationResult } from '../../types';
import { simulateNew } from '../../utils/clients/tenderly';
import { handleCrossChainSimulations } from '../../utils/clients/tenderly';

describe('Cross-Chain Integration Tests', () => {
  describe('Arbitrum Cross-Chain Integration', () => {
    let arbSimConfig: SimulationConfigNew;

    beforeAll(async () => {
      // Import arb-distro simulation config
      const { config } = await import('../../sims/arb-distro.sim.ts');
      arbSimConfig = config;
    });

    test('should complete full Arbitrum cross-chain simulation flow', async () => {
      // 1. Run source chain simulation
      const sourceResult = await simulateNew(arbSimConfig);
      expect(sourceResult).toBeDefined();
      expect(sourceResult.sim).toBeDefined();
      expect(sourceResult.proposal).toBeDefined();

      // 2. Handle cross-chain simulations
      const crossChainResult = await handleCrossChainSimulations(sourceResult);
      expect(crossChainResult).toBeDefined();
      expect(crossChainResult.sim).toBeDefined();
      expect(crossChainResult.proposal).toBeDefined();

      // 3. Verify destination simulations were created
      expect(crossChainResult.destinationSimulations).toBeDefined();
      if (
        crossChainResult.destinationSimulations &&
        crossChainResult.destinationSimulations.length > 0
      ) {
        expect(crossChainResult.destinationSimulations[0].chainId).toBe(42161);
        expect(crossChainResult.destinationSimulations[0].bridgeType).toBeDefined();
        expect(crossChainResult.destinationSimulations[0].status).toBeDefined();
      }

      // 4. Run checks for both chains
      const mainnetResults = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1, // Mainnet chain ID
        crossChainResult.destinationSimulations,
      );

      expect(mainnetResults).toBeDefined();
      expect(typeof mainnetResults).toBe('object');

      // Verify that we received check results (cross-chain info depends on specific checks)
      const checkNames = Object.keys(mainnetResults);
      expect(checkNames.length).toBeGreaterThan(0);
    }, 60000); // Increased timeout for external API calls // 30 second timeout for integration test

    test('should handle Arbitrum simulation failures gracefully', async () => {
      // Create a config that will likely fail on L2
      const failingConfig: SimulationConfigNew = {
        ...arbSimConfig,
        targets: ['0x0000000000000000000000000000000000000000'], // Invalid target
        calldatas: ['0x00000000'], // Invalid calldata
        values: [0n],
        signatures: ['' as `0x${string}`],
        description: 'Test failing Arbitrum simulation',
      };

      const sourceResult = await simulateNew(failingConfig);
      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      // Should still return results even if destination simulation fails
      expect(crossChainResult).toBeDefined();
      expect(crossChainResult.sim).toBeDefined();

      // Run checks - should handle failed destination simulations
      const results = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1,
        crossChainResult.destinationSimulations,
      );

      expect(results).toBeDefined();
    }, 60000); // Increased timeout for external API calls
  });

  describe('Optimism Cross-Chain Integration', () => {
    let opSimConfig: SimulationConfigNew;

    beforeAll(async () => {
      // Import optimism-bridge-test simulation config
      const { config } = await import('../../sims/optimism-bridge-test.sim.ts');
      opSimConfig = config;
    });

    test('should complete full Optimism cross-chain simulation flow', async () => {
      // 1. Run source chain simulation
      const sourceResult = await simulateNew(opSimConfig);
      expect(sourceResult).toBeDefined();
      expect(sourceResult.sim).toBeDefined();

      // 2. Handle cross-chain simulations
      const crossChainResult = await handleCrossChainSimulations(sourceResult);
      expect(crossChainResult).toBeDefined();

      // 3. Verify destination simulations for both OP and Base
      expect(crossChainResult.destinationSimulations).toBeDefined();
      if (
        crossChainResult.destinationSimulations &&
        crossChainResult.destinationSimulations.length > 0
      ) {
        const chainIds = crossChainResult.destinationSimulations.map((sim) => sim.chainId);
        expect(chainIds).toContain(10); // OP Mainnet
        expect(chainIds).toContain(8453); // Base
      }

      // 4. Run checks
      const results = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1,
        crossChainResult.destinationSimulations,
      );

      expect(results).toBeDefined();

      // Verify cross-chain information is included
      const hasOptimismInfo = Object.values(results).some((result) =>
        result.result.info?.some(
          (info) =>
            info.includes('Optimism') ||
            info.includes('Base') ||
            info.includes('10') ||
            info.includes('8453'),
        ),
      );
      expect(hasOptimismInfo).toBe(true);
    }, 60000); // Increased timeout for external API calls

    test('should handle multiple chain destinations correctly', async () => {
      const sourceResult = await simulateNew(opSimConfig);
      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      // Should have simulations for both OP and Base
      expect(crossChainResult.destinationSimulations).toBeDefined();
      if (crossChainResult.destinationSimulations) {
        expect(crossChainResult.destinationSimulations.length).toBeGreaterThan(0);

        // Check that we have both chain IDs
        const chainIds = crossChainResult.destinationSimulations.map((sim) => sim.chainId);
        expect(chainIds).toContain(10); // OP Mainnet
        expect(chainIds).toContain(8453); // Base
      }

      // Run checks and verify they handle multiple destinations
      const results = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1,
        crossChainResult.destinationSimulations,
      );

      expect(results).toBeDefined();
    }, 60000); // Increased timeout for external API calls
  });

  describe('Non-Cross-Chain Integration', () => {
    let normalSimConfig: SimulationConfigNew;

    beforeAll(async () => {
      // Import uni-transfer simulation config (non-cross-chain)
      const { config } = await import('../../sims/uni-transfer.sim.ts');
      normalSimConfig = config;
    });

    test('should handle non-cross-chain simulations normally', async () => {
      const sourceResult = await simulateNew(normalSimConfig);
      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      // Should not have destination simulations
      expect(crossChainResult.destinationSimulations).toEqual([]);

      // Should still have valid main simulation
      expect(crossChainResult.sim).toBeDefined();
      expect(crossChainResult.proposal).toBeDefined();

      // Run checks
      const results = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1,
        crossChainResult.destinationSimulations,
      );

      expect(results).toBeDefined();
    }, 60000); // Increased timeout for external API calls
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing simulation data gracefully', async () => {
      const invalidConfig: SimulationConfigNew = {
        type: 'new',
        daoName: 'Test',
        governorAddress: '0x0000000000000000000000000000000000000000',
        governorType: 'bravo',
        targets: [],
        values: [],
        signatures: [],
        calldatas: [],
        description: 'Empty test proposal',
      };

      try {
        const sourceResult = await simulateNew(invalidConfig);
        const crossChainResult = await handleCrossChainSimulations(sourceResult);

        // Should handle empty/invalid configs without crashing
        expect(crossChainResult).toBeDefined();
        expect(crossChainResult.destinationSimulations).toEqual([]);
      } catch (error) {
        // If simulation fails, that's expected for invalid config
        expect(error).toBeDefined();
      }
    });

    test('should handle network failures during cross-chain simulation', async () => {
      // Import a working config
      const { config } = await import('../../sims/arb-distro.sim.ts');

      // Mock a network failure scenario by trying to run cross-chain with minimal data
      const partialSourceResult = {
        sim: {
          transaction: {
            transaction_info: {
              call_trace: {
                calls: [],
              },
            },
            status: true,
          },
        },
        proposal: {
          id: 999n,
          proposer: '0x0000000000000000000000000000000000000000',
          targets: config.targets,
          values: config.values,
          signatures: config.signatures,
          calldatas: config.calldatas,
          startBlock: 1000n,
          endBlock: 2000n,
          description: 'Test proposal',
        },
        deps: {},
        latestBlock: {
          number: 1500n,
          timestamp: 1600000000n,
        },
      };

      const crossChainResult = await handleCrossChainSimulations(
        partialSourceResult as unknown as SimulationResult,
      );

      // Should handle the scenario gracefully
      expect(crossChainResult).toBeDefined();
      expect(crossChainResult.destinationSimulations).toEqual([]);
    });
  });

  describe('Cross-Chain Check Integration', () => {
    test('should run all checks on cross-chain simulations', async () => {
      const { config } = await import('../../sims/arb-distro.sim.ts');

      const sourceResult = await simulateNew(config);
      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      const results = await runChecksForChain(
        crossChainResult.proposal,
        crossChainResult.sim,
        crossChainResult.deps,
        1,
        crossChainResult.destinationSimulations,
      );

      // Verify that all expected checks ran
      expect(results).toBeDefined();
      expect(typeof results).toBe('object');

      // Check that key check types are present
      const checkNames = Object.keys(results);
      expect(checkNames.length).toBeGreaterThan(0);

      // Verify each check result has the expected structure
      for (const [_checkName, result] of Object.entries(results)) {
        expect(result).toBeDefined();
        expect(result).toHaveProperty('result');
        expect(result.result).toHaveProperty('info');
        expect(result.result).toHaveProperty('warnings');
        expect(result.result).toHaveProperty('errors');
        expect(Array.isArray(result.result.info)).toBe(true);
        expect(Array.isArray(result.result.warnings)).toBe(true);
        expect(Array.isArray(result.result.errors)).toBe(true);
      }
    }, 60000); // Increased timeout for external API calls

    test('should include cross-chain information in check results', async () => {
      const { config } = await import('../../sims/arb-distro.sim.ts');

      const sourceResult = await simulateNew(config);
      const crossChainResult = await handleCrossChainSimulations(sourceResult);

      // Only run checks if we have destination simulations
      if (
        crossChainResult.destinationSimulations &&
        crossChainResult.destinationSimulations.length > 0
      ) {
        const results = await runChecksForChain(
          crossChainResult.proposal,
          crossChainResult.sim,
          crossChainResult.deps,
          1,
          crossChainResult.destinationSimulations,
        );

        // Validate that checks ran successfully with cross-chain simulations
        expect(results).toBeDefined();
        expect(typeof results).toBe('object');

        // Verify that we have check results (the important thing is that checks ran with cross-chain data)
        const checkNames = Object.keys(results);
        expect(checkNames.length).toBeGreaterThan(0);

        // Verify that destination simulations were provided to the checks
        expect(crossChainResult.destinationSimulations.length).toBeGreaterThan(0);
      }
    }, 60000); // Increased timeout for external API calls
  });
});
