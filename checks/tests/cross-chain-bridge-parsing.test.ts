import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, parseAbi } from 'viem';
import { arbitrum, base, optimism, unichain } from 'viem/chains';
import type { CallTrace, CrossChainExecutionJob } from '../../types';
import {
  extractArbitrumL1L2Jobs,
  extractArbitrumL1L2JobsFromProposal,
} from '../../utils/bridges/arbitrum';
import {
  extractOptimismL1L2Jobs,
  extractOptimismL1L2JobsFromProposal,
} from '../../utils/bridges/optimism';
import { createRealisticSimulation } from './test-utils';

function firstCall(job: CrossChainExecutionJob) {
  return job.calls[0];
}

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

      const messages = extractArbitrumL1L2Jobs(complexSimulation);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'ArbitrumL1L2',
        destinationChainId: arbitrum.id,
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x912CE59144191C1204E64559FE8253a0e49E6548',
      );
    });

    test('should route Robinhood Inbox traces to chain 4663', () => {
      const robinhoodSimulation = createRealisticSimulation([
        {
          to: '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input:
            '0x679b6ded0000000000000000000000008bceaa40b9acdfaedf85adf4ff01f5ad6517937f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d400000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000024f46901ed0000000000000000000000000e197b5b7c9eeeea25e7c8378516d68aa0df7d9200000000000000000000000000000000000000000000000000000000',
          calls: [],
        },
      ]);

      const messages = extractArbitrumL1L2Jobs(robinhoodSimulation);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'ArbitrumL1L2',
        destinationChainId: 4663,
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
      );
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

      const messages = extractArbitrumL1L2Jobs(multiCallSimulation);

      expect(messages).toHaveLength(2);
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x912CE59144191C1204E64559FE8253a0e49E6548',
      );
      expect(firstCall(messages[1]).l2TargetAddress).toBe(
        '0x912CE59144191C1204E64559FE8253a0e49E6548',
      );
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

      const messages = extractArbitrumL1L2Jobs(edgeCaseSimulation);

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

      const messages = extractOptimismL1L2Jobs(opSimulation);

      expect(messages).toHaveLength(2);

      const opMessage = messages.find((m) => m.destinationChainId === optimism.id);
      const baseMessage = messages.find((m) => m.destinationChainId === base.id);

      expect(opMessage).toBeDefined();
      expect(baseMessage).toBeDefined();

      expect(opMessage && firstCall(opMessage).l2TargetAddress).toBe(
        '0x4200000000000000000000000000000000000006',
      );
      expect(baseMessage && firstCall(baseMessage).l2TargetAddress).toBe(
        '0x4200000000000000000000000000000000000006',
      );
    });

    test('should parse depositTransaction portal calls', () => {
      const setOwnerAbi = parseAbi(['function setOwner(address _owner)']);
      const portalAbi = parseAbi([
        'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
      ]);
      const setOwnerData = encodeFunctionData({
        abi: setOwnerAbi,
        functionName: 'setOwner',
        args: ['0x1111111111111111111111111111111111111111'],
      });

      const depositCalldata = encodeFunctionData({
        abi: portalAbi,
        functionName: 'depositTransaction',
        args: ['0x42aE7Ec7ff020412639d443E245D936429Fbe717', 0n, 200000n, false, setOwnerData],
      });

      const portalSimulation = createRealisticSimulation([
        {
          to: '0x88e529A6ccd302c948689Cd5156C83D4614FAE92',
          from: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
          input: depositCalldata,
          value: '0',
          calls: [],
        },
      ]);

      const messages = extractOptimismL1L2Jobs(portalSimulation);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: 1868,
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x42aE7Ec7ff020412639d443E245D936429Fbe717',
      );
      expect(firstCall(messages[0]).l2InputData).toBe(setOwnerData);
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

      const messages = extractOptimismL1L2Jobs(nestedSimulation);

      expect(messages).toHaveLength(1);
      expect(messages[0].destinationChainId).toBe(optimism.id);
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

      const messages = extractOptimismL1L2Jobs(edgeCaseSimulation);

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

      const messages = extractArbitrumL1L2Jobs(validArbitrumSim);

      expect(messages).toHaveLength(1);

      const message = messages[0];
      expect(message.bridgeType).toBe('ArbitrumL1L2');
      expect(message.destinationChainId).toBe(arbitrum.id);
      expect(firstCall(message).l2TargetAddress).toBeDefined();
      expect(message.l2FromAddress).toBeDefined();
      expect(firstCall(message).l2InputData).toBeDefined();
      expect(firstCall(message).l2Value).toBeDefined();
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

      const messages = extractOptimismL1L2Jobs(validOptimismSim);

      expect(messages).toHaveLength(1);

      const message = messages[0];
      expect(message.bridgeType).toBe('OptimismL1L2');
      expect(message.destinationChainId).toBe(optimism.id);
      expect(firstCall(message).l2TargetAddress).toBe('0x4200000000000000000000000000000000000006');
      expect(message.l2FromAddress).toBe('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
      expect(firstCall(message).l2InputData).toBe('0xd0e30db0');
      expect(firstCall(message).l2Value).toBe('0');
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
      const messages = extractArbitrumL1L2Jobs(largeSimulation);
      const end = performance.now();

      // Should complete in reasonable time (< 1 second)
      expect(end - start).toBeLessThan(1000);

      // Should find exactly 5 valid messages with unique calldata
      expect(messages).toHaveLength(5);
    });
  });

  describe('Proposal-based extraction (fallback when trace is not decodeable)', () => {
    const arbInbox = '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f';
    const robinhoodInbox = '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D';
    const opMessenger = '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1';
    const arbCreateRetryableCalldata =
      '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e654800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a46fc7c680000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d40000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044a9059cbb00000000000000000000000066ccbf509cd28c2fc0f40b4469d6b6aa1fc0fed300000000000000000000000000000000000000000000152d02c7e14af680000000000000000000000000000000000000000000000000000000000000';

    test('extractArbitrumL1L2JobsFromProposal extracts messages for inbox targets', () => {
      const targets = ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', arbInbox];
      const calldatas = ['0xdead', arbCreateRetryableCalldata];
      const messages = extractArbitrumL1L2JobsFromProposal(targets, calldatas);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'ArbitrumL1L2',
        destinationChainId: arbitrum.id,
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x912CE59144191C1204E64559FE8253a0e49E6548',
      );
    });

    test('extractArbitrumL1L2JobsFromProposal routes Robinhood Inbox calls to chain 4663', () => {
      const timelock = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
      const messages = extractArbitrumL1L2JobsFromProposal(
        [robinhoodInbox, robinhoodInbox],
        [
          '0x679b6ded0000000000000000000000008bceaa40b9acdfaedf85adf4ff01f5ad6517937f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d400000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000024f46901ed0000000000000000000000000e197b5b7c9eeeea25e7c8378516d68aa0df7d9200000000000000000000000000000000000000000000000000000000',
          '0x679b6ded0000000000000000000000001f7d7550b1b028f7571e69a784071f0205fd2efa0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002386f26fc100000000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000002bad8182c09f50c8318d769245bea52c32be46cd0000000000000000000000000000000000000000000000000000000000030d400000000000000000000000000000000000000000000000000000000005f5e1000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000002413af403500000000000000000000000059f4888f34c5ba04086b6ed2c61044d123168a4f00000000000000000000000000000000000000000000000000000000',
        ],
        timelock,
      );

      expect(messages).toHaveLength(2);
      expect(messages.map((message) => message.destinationChainId)).toEqual([4663, 4663]);
      expect(messages.map((message) => message.l2FromAddress)).toEqual([
        '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
        '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      ]);
      expect(messages.map((message) => firstCall(message).l2TargetAddress)).toEqual([
        '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
        '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
      ]);
    });

    test('extractArbitrumL1L2JobsFromProposal ignores non-inbox targets', () => {
      const targets = ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'];
      const calldatas = [
        '0x679b6ded000000000000000000000000912ce59144191c1204e64559fe8253a0e49e6548',
      ];
      const messages = extractArbitrumL1L2JobsFromProposal(targets, calldatas);
      expect(messages).toHaveLength(0);
    });

    test('extractOptimismL1L2JobsFromProposal extracts messages for messenger targets', () => {
      const sendMessageCalldata =
        '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000';
      const targets = ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', opMessenger];
      const calldatas = ['0xdead', sendMessageCalldata];
      const messages = extractOptimismL1L2JobsFromProposal(targets, calldatas);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: optimism.id,
      });
    });

    test('extractOptimismL1L2JobsFromProposal ignores non-messenger targets', () => {
      const targets = ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'];
      const calldatas = [
        '0x3dbb202b0000000000000000000000000000000000000000000000000000000000000000',
      ];
      const messages = extractOptimismL1L2JobsFromProposal(targets, calldatas);
      expect(messages).toHaveLength(0);
    });

    test('extractOptimismL1L2JobsFromProposal parses worldchain messenger targets', () => {
      const sendMessageCalldata =
        '0x3dbb202b0000000000000000000000004200000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000004d0e30db000000000000000000000000000000000000000000000000000000000';
      const worldchainMessenger = '0xf931a81D18B1766d15695ffc7c1920a62b7e710a';
      const targets = ['0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', worldchainMessenger];
      const calldatas = ['0xdead', sendMessageCalldata];
      const messages = extractOptimismL1L2JobsFromProposal(targets, calldatas);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: 480,
      });
    });

    test('extractOptimismL1L2JobsFromProposal preserves the original sender for Unichain forwarded calls', () => {
      const timelock = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
      const unichainMessenger = '0x9A3D64E386C18Cb1d6d5179a9596A4B5736e98A6';
      const router = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
      const finalTarget = '0x4200000000000000000000000000000000000006';
      const finalData = '0xd0e30db0';
      const forwardData = encodeFunctionData({
        abi: parseAbi(['function forward(address target, bytes data)']),
        functionName: 'forward',
        args: [finalTarget, finalData],
      });
      const sendMessageCalldata = encodeFunctionData({
        abi: parseAbi([
          'function sendMessage(address _target, bytes _message, uint32 _minGasLimit)',
        ]),
        functionName: 'sendMessage',
        args: [router, forwardData, 1_000_000],
      });

      const messages = extractOptimismL1L2JobsFromProposal(
        [unichainMessenger],
        [sendMessageCalldata],
        timelock,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: unichain.id,
        l2FromAddress: timelock,
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(finalTarget);
      expect(firstCall(messages[0]).l2InputData).toBe(finalData);
    });

    test('extractOptimismL1L2JobsFromProposal parses portal depositTransaction targets', () => {
      const setOwnerAbi = parseAbi(['function setOwner(address _owner)']);
      const portalAbi = parseAbi([
        'function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data)',
      ]);
      const setOwnerData = encodeFunctionData({
        abi: setOwnerAbi,
        functionName: 'setOwner',
        args: ['0x1111111111111111111111111111111111111111'],
      });
      const depositCalldata = encodeFunctionData({
        abi: portalAbi,
        functionName: 'depositTransaction',
        args: ['0x42aE7Ec7ff020412639d443E245D936429Fbe717', 0n, 200000n, false, setOwnerData],
      });

      const soneiumPortal = '0x88e529A6ccd302c948689Cd5156C83D4614FAE92';
      const l1Sender = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC';
      const messages = extractOptimismL1L2JobsFromProposal(
        [soneiumPortal],
        [depositCalldata],
        l1Sender,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        bridgeType: 'OptimismL1L2',
        destinationChainId: 1868,
        l2FromAddress: '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
      });
      expect(firstCall(messages[0]).l2TargetAddress).toBe(
        '0x42aE7Ec7ff020412639d443E245D936429Fbe717',
      );
      expect(firstCall(messages[0]).l2InputData).toBe(setOwnerData);
    });
  });
});
