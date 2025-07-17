import { describe, expect, test } from 'bun:test';
import type { CallTrace, TenderlySimulation } from '../../types';
import { parseArbitrumL1L2Messages } from '../../utils/bridges/arbitrum';
import { parseOptimismL1L2Messages } from '../../utils/bridges/optimism';
import { createMockSimulation } from './test-utils';

describe('Cross-Chain Unit Integration Tests', () => {
  describe('Arbitrum Bridge Integration', () => {
    test('should parse real Arbitrum transaction patterns', () => {
      // Based on actual Arbitrum governance transaction patterns
      const arbitrumCall = {
        to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
        calls: [],
      };

      const simulation = createMockSimulation([arbitrumCall]);
      const messages = parseArbitrumL1L2Messages(simulation);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'ArbitrumL1L2',
        destinationChainId: '42161',
        l2TargetAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
    });

    test('should handle multiple Arbitrum calls with deduplication', () => {
      const duplicateCall = {
        to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
        calls: [],
      };

      const simulation = createMockSimulation([duplicateCall, duplicateCall]);
      const messages = parseArbitrumL1L2Messages(simulation);

      // Should deduplicate
      expect(messages).toHaveLength(1);
    });

    test('should validate L2 address aliasing', () => {
      const call = {
        to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
        calls: [],
      };

      const simulation = createMockSimulation([call]);
      const messages = parseArbitrumL1L2Messages(simulation);

      expect(messages).toHaveLength(1);

      // Verify aliasing calculation
      const _l1Address = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
      const expectedL2Alias = '0x2BAD8182C09F50c8318d769245beA52C32Be46CD';

      expect(messages[0].l2FromAddress?.toLowerCase()).toBe(expectedL2Alias.toLowerCase());
    });
  });

  describe('Optimism Bridge Integration', () => {
    test('should parse real Optimism transaction patterns', () => {
      // Based on actual Optimism governance transaction patterns
      const optimismCall = {
        to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
        value: '0',
        calls: [],
      };

      const simulation = createMockSimulation([optimismCall]);
      const messages = parseOptimismL1L2Messages(simulation);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: '10',
        l2TargetAddress: '0x4200000000000000000000000000000000000006',
        l2InputData: '0xd0e30db0',
        l2FromAddress: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
      });
    });

    test('should handle Base transactions', () => {
      const baseCall = {
        to: '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
        value: '0',
        calls: [],
      };

      const simulation = createMockSimulation([baseCall]);
      const messages = parseOptimismL1L2Messages(simulation);

      expect(messages).toHaveLength(1);
      expect(messages[0].destinationChainId).toBe('8453');
    });

    test('should validate address preservation (no aliasing)', () => {
      const call = {
        to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
        value: '0',
        calls: [],
      };

      const simulation = createMockSimulation([call]);
      const messages = parseOptimismL1L2Messages(simulation);

      expect(messages).toHaveLength(1);

      // Verify address preservation (no aliasing)
      const l1Address = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
      expect(messages[0].l2FromAddress?.toLowerCase()).toBe(l1Address.toLowerCase());
    });
  });

  describe('Mixed Bridge Scenarios', () => {
    test('should handle both Arbitrum and Optimism calls in one simulation', () => {
      const arbitrumCall = {
        to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
        calls: [],
      };

      const optimismCall = {
        to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
        value: '0',
        calls: [],
      };

      const simulation = createMockSimulation([arbitrumCall, optimismCall]);

      const arbMessages = parseArbitrumL1L2Messages(simulation);
      const opMessages = parseOptimismL1L2Messages(simulation);

      expect(arbMessages).toHaveLength(1);
      expect(opMessages).toHaveLength(1);

      expect(arbMessages[0].bridgeType).toBe('ArbitrumL1L2');
      expect(opMessages[0].bridgeType).toBe('OptimismL1L2');
    });

    test('should handle deep nesting without performance issues', () => {
      function createNestedCall(depth: number): CallTrace {
        const baseCall = {
          to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0xa9059cbb',
          calls: [] as CallTrace[],
        };

        if (depth > 0) {
          baseCall.calls = [createNestedCall(depth - 1)];
        }

        // Add bridge call at depth 5
        if (depth === 5) {
          baseCall.calls.push({
            to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
            from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
            input:
              '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
            calls: [],
          });
        }

        return baseCall;
      }

      const deepSimulation = createMockSimulation([createNestedCall(10)]);

      const start = performance.now();
      const messages = parseArbitrumL1L2Messages(deepSimulation);
      const end = performance.now();

      expect(messages).toHaveLength(1);
      expect(end - start).toBeLessThan(100); // Should be very fast
    });
  });

  describe('Error Handling Integration', () => {
    test('should gracefully handle corrupted simulation data', () => {
      const corruptedSimulation = {
        transaction: {
          transaction_info: {
            call_trace: null as unknown,
          },
        },
      } as TenderlySimulation;

      expect(() => {
        const messages = parseArbitrumL1L2Messages(corruptedSimulation);
        expect(messages).toHaveLength(0);
      }).not.toThrow();
    });

    test('should handle missing transaction info', () => {
      const emptySimulation = {
        transaction: {
          transaction_info: null as unknown,
        },
      } as TenderlySimulation;

      // The parsers should handle null gracefully and return empty arrays
      // This is consistent with other invalid data handling throughout the system
      const arbMessages = parseArbitrumL1L2Messages(emptySimulation);
      expect(arbMessages).toHaveLength(0);

      const opMessages = parseOptimismL1L2Messages(emptySimulation);
      expect(opMessages).toHaveLength(0);
    });
  });

  describe('Message Format Validation', () => {
    test('should validate Arbitrum message format', () => {
      const call = {
        to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
        calls: [],
      };

      const simulation = createMockSimulation([call]);
      const messages = parseArbitrumL1L2Messages(simulation);

      expect(messages).toHaveLength(1);

      const message = messages[0];

      // Validate all required fields
      expect(message.bridgeType).toBe('ArbitrumL1L2');
      expect(message.destinationChainId).toBe('42161');
      expect(message.l2TargetAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(message.l2FromAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(message.l2InputData).toMatch(/^0x[a-fA-F0-9]*$/);
      expect(message.l2Value).toBeDefined();
      expect(typeof message.l2Value).toBe('string');
    });

    test('should validate Optimism message format', () => {
      const call = {
        to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
        from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
        input:
          '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
        value: '0',
        calls: [],
      };

      const simulation = createMockSimulation([call]);
      const messages = parseOptimismL1L2Messages(simulation);

      expect(messages).toHaveLength(1);

      const message = messages[0];

      // Validate all required fields
      expect(message.bridgeType).toBe('OptimismL1L2');
      expect(message.destinationChainId).toBe('10');
      expect(message.l2TargetAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(message.l2FromAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(message.l2InputData).toMatch(/^0x[a-fA-F0-9]*$/);
      expect(message.l2Value).toBeDefined();
      expect(typeof message.l2Value).toBe('string');
    });
  });
});
