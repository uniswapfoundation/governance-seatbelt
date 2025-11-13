import { describe, expect, test } from 'bun:test';
import type { CallTrace } from '../../types';
import { parseArbitrumL1L2Messages } from '../../utils/bridges/arbitrum';
import { parseOptimismL1L2Messages } from '../../utils/bridges/optimism';
import { createRealisticSimulation } from './test-utils';

describe('Cross-Chain Bridge Parsing Integration Tests', () => {
  describe('Arbitrum Bridge Parsing - Real World Scenarios', () => {
    test('should parse complex nested Arbitrum calls', () => {
      const complexSimulation = createRealisticSimulation([
        {
          to: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', // Timelock
          from: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3', // Governor
          input: '0x1234567890',
          calls: [
            {
              to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f', // Arbitrum DelayedInbox
              from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', // Timelock
              input:
                '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
              calls: [],
            },
          ],
        },
      ]);

      const messages = parseArbitrumL1L2Messages(complexSimulation);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'ArbitrumL1L2',
        destinationChainId: '42161',
        l2TargetAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548',
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
    });

    test('should handle multiple Arbitrum calls with different functions', () => {
      const multiCallSimulation = createRealisticSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000fd2892eff2615c9f29af83fb528faf3fe41c142600000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
          calls: [],
        },
      ]);

      const messages = parseArbitrumL1L2Messages(multiCallSimulation);

      expect(messages).toHaveLength(2);
      expect(messages[0].l2TargetAddress).toBe('0x912CE59144191C1204E64559FE8253a0e49E6548');
      expect(messages[1].l2TargetAddress).toBe('0x912CE59144191C1204E64559FE8253a0e49E6548');
    });

    test('should handle edge cases in Arbitrum parsing', () => {
      const edgeCaseSimulation = createRealisticSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x', // Empty input
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x123', // Too short
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x12345678${'0'.repeat(200)}`, // Invalid function selector
          calls: [],
        },
      ]);

      const messages = parseArbitrumL1L2Messages(edgeCaseSimulation);

      // Should handle all edge cases gracefully
      expect(messages).toHaveLength(0);
    });
  });

  describe('Optimism Bridge Parsing - Real World Scenarios', () => {
    test('should parse OP Mainnet and Base calls correctly', () => {
      const opSimulation = createRealisticSimulation([
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP Mainnet messenger
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
        {
          to: '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa', // Base messenger
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
      ]);

      const messages = parseOptimismL1L2Messages(opSimulation);

      expect(messages).toHaveLength(2);

      const opMessage = messages.find((m) => m.destinationChainId === '10');
      const baseMessage = messages.find((m) => m.destinationChainId === '8453');

      expect(opMessage).toBeDefined();
      expect(baseMessage).toBeDefined();

      expect(opMessage?.l2TargetAddress).toBe('0x4200000000000000000000000000000000000006');
      expect(baseMessage?.l2TargetAddress).toBe('0x4200000000000000000000000000000000000006');
    });

    test('should handle complex nested Optimism calls', () => {
      const nestedSimulation = createRealisticSimulation([
        {
          to: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', // Timelock
          from: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
          input: '0x1234567890',
          calls: [
            {
              to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1', // OP messenger (nested)
              from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
              input:
                '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
              value: '0',
              calls: [],
            },
          ],
        },
      ]);

      const messages = parseOptimismL1L2Messages(nestedSimulation);

      expect(messages).toHaveLength(1);
      expect(messages[0].destinationChainId).toBe('10');
    });

    test('should handle Optimism parsing edge cases', () => {
      const edgeCaseSimulation = createRealisticSimulation([
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x', // Empty input
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x123', // Too short
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x12345678${'0'.repeat(200)}`, // Invalid function selector
          calls: [],
        },
        {
          to: '0x1234567890123456789012345678901234567890', // Unknown messenger
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
      ]);

      const messages = parseOptimismL1L2Messages(edgeCaseSimulation);

      // Should handle all edge cases gracefully
      expect(messages).toHaveLength(0);
    });
  });

  describe('Cross-Chain Message Validation', () => {
    test('should validate Arbitrum message structure', () => {
      const validArbitrumSim = createRealisticSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000',
          calls: [],
        },
      ]);

      const messages = parseArbitrumL1L2Messages(validArbitrumSim);

      expect(messages).toHaveLength(1);

      const message = messages[0];
      expect(message.bridgeType).toBe('ArbitrumL1L2');
      expect(message.destinationChainId).toBe('42161');
      expect(message.l2TargetAddress).toBeDefined();
      expect(message.l2FromAddress).toBeDefined();
      expect(message.l2InputData).toBeDefined();
      expect(message.l2Value).toBeDefined();
    });

    test('should validate Optimism message structure', () => {
      const validOptimismSim = createRealisticSimulation([
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
      ]);

      const messages = parseOptimismL1L2Messages(validOptimismSim);

      expect(messages).toHaveLength(1);

      const message = messages[0];
      expect(message.bridgeType).toBe('OptimismL1L2');
      expect(message.destinationChainId).toBe('10');
      expect(message.l2TargetAddress).toBe('0x4200000000000000000000000000000000000006');
      expect(message.l2FromAddress).toBe('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
      expect(message.l2InputData).toBe('0xd0e30db0');
      expect(message.l2Value).toBe('0');
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large numbers of calls efficiently', () => {
      const largeCalls: CallTrace[] = [];

      // Generate 50 calls with mixed valid and invalid data
      for (let i = 0; i < 50; i++) {
        if (i % 10 === 0) {
          // Every 10th call is valid Arbitrum with unique recipient to avoid deduplication
          const uniqueRecipient = `0x${i.toString(16).padStart(40, '0')}`;
          largeCalls.push({
            to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
            from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
            input: `0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000${uniqueRecipient.slice(2)}00000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000`,
            calls: [],
          });
        } else {
          // Other calls are not to bridge contracts
          largeCalls.push({
            to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
            from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
            input:
              '0xa9059cbb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            calls: [],
          });
        }
      }

      const largeSimulation = createRealisticSimulation(largeCalls);

      const start = performance.now();
      const messages = parseArbitrumL1L2Messages(largeSimulation);
      const end = performance.now();

      // Should complete in reasonable time (< 1 second)
      expect(end - start).toBeLessThan(1000);

      // Should find exactly 5 valid messages with unique calldata
      expect(messages).toHaveLength(5);
    });
  });
});
