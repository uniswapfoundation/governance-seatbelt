import { describe, expect, it } from 'bun:test';
import type { AllCheckResults, ProposalEvent } from '../types';
import { generateProposalSummary } from '../utils/proposal-summary';

describe('Proposal Summary Generation', () => {
  // Helper function to create a basic proposal
  function createProposal(overrides?: Partial<ProposalEvent>): ProposalEvent {
    return {
      id: 1n,
      proposalId: 1n,
      proposer: '0x1234567890123456789012345678901234567890',
      startBlock: 1000n,
      endBlock: 2000n,
      description: 'Test Proposal',
      targets: ['0xabc0000000000000000000000000000000000001'],
      values: [0n],
      signatures: [''],
      calldatas: ['0x'],
      ...overrides,
    };
  }

  // Helper function to create check results with info messages
  function createChecks(calldataInfo: string[]): AllCheckResults {
    return {
      checkDecodeCalldata: {
        name: 'Decode Calldata',
        result: {
          info: calldataInfo,
          warnings: [],
          errors: [],
        },
      },
    };
  }

  describe('Transfer Operations', () => {
    it('should detect token transfers', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` transfers 1000000 USDC to `0x456...` on USDC Token (formatted)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Transfers 1000000 USDC to 0x456');
    });

    it('should detect ETH transfers from decoded calldata', () => {
      const proposal = createProposal({
        values: [1000000000000000000n], // 1 ETH
      });
      const checks = createChecks(['`0x123...` transfers 1.0 ETH to `0x456...` (formatted)']);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Sends 1.0 ETH to 0x456');
    });

    it('should detect ETH transfers from proposal values with recipient', () => {
      const proposal = createProposal({
        targets: ['0x1234567890123456789012345678901234567890'],
        values: [1000000000000000000n], // 1 ETH
      });
      const checks = createChecks([]); // No decoded calldata

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Sends 1 ETH to 0x1234...7890');
    });

    it('should handle multiple transfers', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` transfers 1000 USDC to `0x456...` on USDC Token (formatted)',
        '`0x123...` transfers 500 DAI to `0x789...` on DAI Token (formatted)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Transfers 1000 USDC');
      expect(summary).toContain('transfers 500 DAI');
      expect(summary.toLowerCase()).toContain('and');
    });
  });

  describe('Permission Operations', () => {
    it('should detect grant role operations', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `grantRole(0xabc..., 0x456...)` on AccessControl (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Grants permissions');
    });

    it('should detect revoke role operations', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `revokeRole(0xabc..., 0x456...)` on AccessControl (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Revokes permissions');
    });

    it('should detect ownership transfers', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `transferOwnership(0x456...)` on Ownable (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Transfers permissions');
    });
  });

  describe('Upgrade Operations', () => {
    it('should detect proxy upgrades', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `upgradeTo(0x456789abc...)` on TransparentUpgradeableProxy (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Upgrades proxy');
    });

    it('should detect upgradeToAndCall operations', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `upgradeToAndCall(0x456..., 0x789...)` on Proxy (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Upgrades proxy');
    });
  });

  describe('Cross-Chain Operations', () => {
    it('should detect Arbitrum createRetryableTicket calls', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Sends via Arbitrum bridge');
    });

    it('should detect Optimism sendMessage calls', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `sendMessage(...)` on L1CrossDomainMessenger at 0x456... (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Sends via Optimism bridge');
    });

    it('should NOT falsely detect base/l2 in parameter names', () => {
      const proposal = createProposal();
      const checks = createChecks(['MessageDelivered(baseFeeL1: 45422782, l2CallValue: 0)']);

      const summary = generateProposalSummary(proposal, checks);
      // Should NOT contain cross-chain since baseFeeL1 and l2CallValue are just parameter names
      expect(summary).not.toContain('cross-chain');
      expect(summary).not.toContain('Base');
      expect(summary).not.toContain('Layer 2');
    });

    it('should use L2 checks to describe what happens on destination chain', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);
      // L2 checks showing token transfer
      const l2Checks: Record<number, AllCheckResults> = {
        42161: createChecks([
          '`0x2bad...` transfers 100000000000000000000000 ARB to `0x66cc...` on Arbitrum (arb) at `0x912CE...` (formatted)',
        ]),
      };

      const summary = generateProposalSummary(proposal, checks, undefined, l2Checks);
      expect(summary).toContain('Transfers ARB on Arbitrum');
    });

    it('should extract token symbol from contract name when null', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);
      // L2 checks with null token symbol but contract name has symbol
      const l2Checks: Record<number, AllCheckResults> = {
        42161: createChecks([
          '`0x2bad...` transfers 100000000000000000000000 null to `0x66cc...` on Arbitrum (arb) at `0x912CE...` (formatted)',
        ]),
      };

      const summary = generateProposalSummary(proposal, checks, undefined, l2Checks);
      expect(summary).toContain('Transfers ARB on Arbitrum');
      expect(summary).not.toContain('null');
    });

    it('should include ETH for L2 gas in cross-chain description', () => {
      const proposal = createProposal({
        values: [1000000000000000n], // 0.001 ETH
      });
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);
      const l2Checks: Record<number, AllCheckResults> = {
        42161: createChecks([
          '`0x2bad...` transfers 100000 ARB to `0x66cc...` on Arbitrum at `0x912CE...` (formatted)',
        ]),
      };

      const summary = generateProposalSummary(proposal, checks, undefined, l2Checks);
      expect(summary).toContain('with');
      expect(summary).toContain('ETH for L2 gas');
    });

    it('should not show separate ETH transfer when cross-chain has ETH for gas', () => {
      const proposal = createProposal({
        values: [1000000000000000n], // 0.001 ETH
      });
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);
      const l2Checks: Record<number, AllCheckResults> = {
        42161: createChecks([
          '`0x2bad...` transfers 100000 ARB to `0x66cc...` on Arbitrum at `0x912CE...` (formatted)',
        ]),
      };

      const summary = generateProposalSummary(proposal, checks, undefined, l2Checks);
      // Should not have a separate "Sends X ETH" operation - ETH is in the cross-chain description
      expect(summary).not.toMatch(/and sends \d+\.?\d* ETH$/);
    });

    it('should describe multiple recipients for same token', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox at 0x456... (decoded from ABI)',
      ]);
      const l2Checks: Record<number, AllCheckResults> = {
        42161: createChecks([
          '`0x2bad...` transfers 100000 ARB to `0x66cc...` (formatted)',
          '`0x2bad...` transfers 100000 ARB to `0x789a...` (formatted)',
          '`0x2bad...` transfers 100000 ARB to `0xabcd...` (formatted)',
        ]),
      };

      const summary = generateProposalSummary(proposal, checks, undefined, l2Checks);
      // With 3 transfers of ARB, should say "Transfers ARB on Arbitrum to 3 recipients"
      expect(summary).toContain('Transfers ARB on Arbitrum');
    });
  });

  describe('Parameter Changes', () => {
    it('should detect fee parameter changes', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `setFee(1000)` on FeeManager (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Updates fee parameters');
    });

    it('should detect rate parameter changes', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `setRate(500)` on RateController (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Updates rate parameters');
    });

    it('should detect threshold changes', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `setThreshold(10000)` on ThresholdManager (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Updates threshold values');
    });
  });

  describe('Complex Proposals', () => {
    it('should handle proposals with multiple operation types', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `createRetryableTicket(...)` on Inbox (decoded from ABI)',
        '`0x123...` calls `upgradeTo(0x456...)` on Proxy (decoded from ABI)',
        '`0x123...` transfers 1000 USDC to `0x789...` on USDC Token (formatted)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      // Cross-chain should be first (highest priority)
      expect(summary.startsWith('Sends via Arbitrum bridge')).toBe(true);
      // Should include upgrade and transfer
      expect(summary.toLowerCase()).toContain('upgrades proxy');
      expect(summary.toLowerCase()).toContain('transfers 1000 usdc');
    });

    it('should combine multiple operations with proper grammar', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` transfers 1000 USDC to `0x456...` on USDC Token (formatted)',
        '`0x123...` transfers 500 DAI to `0x789...` on DAI Token (formatted)',
        '`0x123...` calls `grantRole(...)` on AccessControl (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      // Should use comma and "and" for multiple operations
      expect(summary).toMatch(/,.*and/);
    });
  });

  describe('Fallback Behavior', () => {
    it('should provide fallback for single unknown operation', () => {
      const proposal = createProposal({
        targets: ['0x1234567890123456789012345678901234567890'],
      });
      const checks = createChecks(['Some unknown operation that does not match any pattern']);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Executes transaction on 0x1234...7890');
    });

    it('should provide fallback for multiple targets', () => {
      const proposal = createProposal({
        targets: [
          '0x1234567890123456789012345678901234567890',
          '0x2345678901234567890123456789012345678901',
          '0x3456789012345678901234567890123456789012',
        ],
      });
      const checks = createChecks([]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Executes 3 transactions across 3 contracts');
    });

    it('should handle multiple calls to same target', () => {
      const proposal = createProposal({
        targets: [
          '0x1234567890123456789012345678901234567890',
          '0x1234567890123456789012345678901234567890',
          '0x1234567890123456789012345678901234567890',
        ],
      });
      const checks = createChecks([]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Executes 3 transactions on 0x1234...7890');
    });

    it('should handle empty checks gracefully', () => {
      const proposal = createProposal();
      const checks: AllCheckResults = {};

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toBeDefined();
      expect(summary.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle proposal with no calldata info', () => {
      const proposal = createProposal();
      const checks: AllCheckResults = {
        'other-check': {
          name: 'Other Check',
          result: {
            info: ['Some other info'],
            warnings: [],
            errors: [],
          },
        },
      };

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('Executes transaction');
    });

    it('should not duplicate operations of the same type', () => {
      const proposal = createProposal();
      const checks = createChecks([
        '`0x123...` calls `grantRole(...)` on AccessControl (decoded from ABI)',
        '`0x456...` calls `grantRole(...)` on AccessControl (decoded from ABI)',
      ]);

      const summary = generateProposalSummary(proposal, checks);
      // Should only mention "Grants permissions" once
      const matches = summary.match(/Grants permissions/g);
      expect(matches?.length).toBe(1);
    });

    it('should handle malformed addresses gracefully', () => {
      const proposal = createProposal({
        targets: ['not-an-address'],
      });
      const checks = createChecks([]);

      const summary = generateProposalSummary(proposal, checks);
      expect(summary).toContain('not-an-address');
    });
  });
});
