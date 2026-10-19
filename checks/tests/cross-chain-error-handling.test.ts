import { describe, expect, test } from 'bun:test';
import { extractArbitrumL1L2Jobs } from '../../utils/bridges/arbitrum';
import { extractOptimismL1L2Jobs } from '../../utils/bridges/optimism';
import { createMockSimulation } from './test-utils';

describe('Cross-Chain Error Handling and Recovery Tests', () => {
  describe('Bridge Parsing Error Recovery', () => {
    test('should handle corrupted Arbitrum call data gracefully', () => {
      const corruptedSimulation = createMockSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x679b6ded${'x'.repeat(500)}`, // Corrupted hex data
          calls: [],
        },
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x679b6ded${'gg'.repeat(100)}`, // Invalid hex characters
          calls: [],
        },
      ]);

      const messages = extractArbitrumL1L2Jobs(corruptedSimulation);

      // Should return empty array without crashing
      expect(messages).toHaveLength(0);
    });

    test('should handle malformed Optimism call data gracefully', () => {
      const malformedSimulation = createMockSimulation([
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x3dbb202b' + 'invalid_hex_data',
          value: '0',
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: `0x3dbb202b${'f'.repeat(1000)}`, // Extremely long but valid hex
          value: '0',
          calls: [],
        },
      ]);

      const messages = extractOptimismL1L2Jobs(malformedSimulation);

      // Should handle gracefully
      expect(messages).toHaveLength(0);
    });

    test('should handle missing call trace data', () => {
      const emptySimulation = createMockSimulation([]);

      const arbMessages = extractArbitrumL1L2Jobs(emptySimulation);
      const opMessages = extractOptimismL1L2Jobs(emptySimulation);

      expect(arbMessages).toHaveLength(0);
      expect(opMessages).toHaveLength(0);
    });

    test('should handle null/undefined call properties', () => {
      const nullDataSimulation = createMockSimulation([
        {
          to: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
          from: undefined as unknown as string,
          input: null as unknown as string,
          calls: [],
        },
        {
          to: null as unknown as string,
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: '0x679b6ded',
          calls: [],
        },
      ]);

      const messages = extractArbitrumL1L2Jobs(nullDataSimulation);

      // Should handle null/undefined gracefully
      expect(messages).toHaveLength(0);
    });
  });

  describe('Recovery and Continuation', () => {
    test('should continue processing after encountering errors', () => {
      const mixedSimulation = createMockSimulation([
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
          input: '0x679b6ded_corrupted_data',
          calls: [],
        },
        {
          to: '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000',
          value: '0',
          calls: [],
        },
      ]);

      // Should parse valid calls and skip invalid ones
      const arbMessages = extractArbitrumL1L2Jobs(mixedSimulation);
      const opMessages = extractOptimismL1L2Jobs(mixedSimulation);

      expect(arbMessages).toHaveLength(1); // Should find 1 valid Arbitrum call
      expect(opMessages).toHaveLength(1); // Should find 1 valid Optimism call
    });
  });
});
