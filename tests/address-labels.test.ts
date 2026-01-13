import { describe, expect, it } from 'bun:test';
import type { AddressLabel } from '../types';
import { extractAddressesFromReport, formatAddressWithLabel } from '../utils/labels';

describe('Address Labels', () => {
  describe('extractAddressesFromReport', () => {
    it('should extract addresses from metadata', () => {
      const addresses = extractAddressesFromReport([], [], [], {
        proposer: '0x1234567890123456789012345678901234567890',
        executor: '0xabcdef0123456789012345678901234567890123',
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
      });

      expect(addresses).toContain('0x1234567890123456789012345678901234567890');
      expect(addresses).toContain('0xabcdef0123456789012345678901234567890123');
      expect(addresses).toContain('0x408ED6354d4973f66138C91495F2f2FCbd8724C3');
    });

    it('should extract addresses from state changes', () => {
      const addresses = extractAddressesFromReport(
        [],
        [
          { contractAddress: '0x1111111111111111111111111111111111111111' },
          { contractAddress: '0x2222222222222222222222222222222222222222' },
        ],
        [],
        {},
      );

      expect(addresses).toContain('0x1111111111111111111111111111111111111111');
      expect(addresses).toContain('0x2222222222222222222222222222222222222222');
    });

    it('should extract addresses from events', () => {
      const addresses = extractAddressesFromReport(
        [],
        [],
        [
          { contractAddress: '0x3333333333333333333333333333333333333333' },
          { contractAddress: '0x4444444444444444444444444444444444444444' },
        ],
        {},
      );

      expect(addresses).toContain('0x3333333333333333333333333333333333333333');
      expect(addresses).toContain('0x4444444444444444444444444444444444444444');
    });

    it('should extract addresses from check messages using regex', () => {
      const addresses = extractAddressesFromReport(
        [
          {
            info: [
              'Transfer from 0x5555555555555555555555555555555555555555 to 0x6666666666666666666666666666666666666666',
            ],
            warnings: [],
            errors: [],
          },
        ],
        [],
        [],
        {},
      );

      expect(addresses).toContain('0x5555555555555555555555555555555555555555');
      expect(addresses).toContain('0x6666666666666666666666666666666666666666');
    });

    it('should extract addresses from warnings and errors', () => {
      const addresses = extractAddressesFromReport(
        [
          {
            info: [],
            warnings: ['Warning: 0x7777777777777777777777777777777777777777 has low balance'],
            errors: ['Error: 0x8888888888888888888888888888888888888888 reverted'],
          },
        ],
        [],
        [],
        {},
      );

      expect(addresses).toContain('0x7777777777777777777777777777777777777777');
      expect(addresses).toContain('0x8888888888888888888888888888888888888888');
    });

    it('should handle empty inputs gracefully', () => {
      const addresses = extractAddressesFromReport([], [], [], {});
      expect(addresses).toEqual([]);
    });

    it('should handle missing optional metadata fields', () => {
      const addresses = extractAddressesFromReport([], [], [], {
        governorAddress: '0x9999999999999999999999999999999999999999',
      });

      expect(addresses).toHaveLength(1);
      expect(addresses).toContain('0x9999999999999999999999999999999999999999');
    });
  });

  describe('formatAddressWithLabel', () => {
    const labels: Record<string, AddressLabel> = {
      '0x408ED6354d4973f66138C91495F2f2FCbd8724C3': {
        label: 'Uniswap Governor',
        type: 'governance',
        source: 'custom',
      },
      '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984': {
        label: 'UNI Token',
        type: 'token',
        source: 'custom',
      },
    };

    it('should format address with label', () => {
      const formatted = formatAddressWithLabel(
        '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        labels,
      );
      expect(formatted).toBe('Uniswap Governor (0x408E...24C3)');
    });

    it('should handle lowercase address input', () => {
      const formatted = formatAddressWithLabel(
        '0x408ed6354d4973f66138c91495f2f2fcbd8724c3',
        labels,
      );
      expect(formatted).toBe('Uniswap Governor (0x408E...24C3)');
    });

    it('should return abbreviated address when no label exists', () => {
      const formatted = formatAddressWithLabel(
        '0x1234567890123456789012345678901234567890',
        labels,
      );
      expect(formatted).toBe('0x1234...7890');
    });

    it('should return abbreviated address with empty labels map', () => {
      const formatted = formatAddressWithLabel('0x408ED6354d4973f66138C91495F2f2FCbd8724C3', {});
      expect(formatted).toBe('0x408E...24C3');
    });

    it('should handle invalid address gracefully', () => {
      const formatted = formatAddressWithLabel('not-an-address', labels);
      expect(formatted).toBe('not-an-address');
    });

    it('should handle short address gracefully', () => {
      const formatted = formatAddressWithLabel('0x123', labels);
      expect(formatted).toBe('0x123');
    });
  });

  describe('Label Sources', () => {
    it('should distinguish between custom, ens, and tenderly sources', () => {
      const labels: Record<string, AddressLabel> = {
        '0x1111111111111111111111111111111111111111': {
          label: 'Custom Label',
          type: 'governance',
          source: 'custom',
        },
        '0x2222222222222222222222222222222222222222': {
          label: 'vitalik.eth',
          source: 'ens',
        },
        '0x3333333333333333333333333333333333333333': {
          label: 'SomeContract',
          type: 'contract',
          source: 'tenderly',
        },
      };

      expect(labels['0x1111111111111111111111111111111111111111'].source).toBe('custom');
      expect(labels['0x2222222222222222222222222222222222222222'].source).toBe('ens');
      expect(labels['0x3333333333333333333333333333333333333333'].source).toBe('tenderly');
    });
  });

  describe('Label Types', () => {
    it('should support all label types', () => {
      const governanceLabel: AddressLabel = {
        label: 'Governor',
        type: 'governance',
        source: 'custom',
      };
      const tokenLabel: AddressLabel = {
        label: 'UNI',
        type: 'token',
        source: 'custom',
      };
      const bridgeLabel: AddressLabel = {
        label: 'Arbitrum Inbox',
        type: 'bridge',
        source: 'custom',
      };
      const contractLabel: AddressLabel = {
        label: 'Contract',
        type: 'contract',
        source: 'tenderly',
      };
      const userLabel: AddressLabel = {
        label: 'User',
        type: 'user',
        source: 'ens',
      };

      expect(governanceLabel.type).toBe('governance');
      expect(tokenLabel.type).toBe('token');
      expect(bridgeLabel.type).toBe('bridge');
      expect(contractLabel.type).toBe('contract');
      expect(userLabel.type).toBe('user');
    });

    it('should allow optional type field', () => {
      const label: AddressLabel = {
        label: 'vitalik.eth',
        source: 'ens',
      };

      expect(label.type).toBeUndefined();
    });
  });
});
