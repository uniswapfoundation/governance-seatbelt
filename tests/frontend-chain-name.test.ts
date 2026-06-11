import { describe, expect, test } from 'bun:test';
import { resolveChainName } from '../frontend/src/lib/chain-name';

describe('frontend resolveChainName', () => {
  test('prefers provided non-generic names', () => {
    expect(resolveChainName(42161, 'Arbitrum One')).toBe('Arbitrum One');
  });

  test('uses known chain names when provided name is generic', () => {
    expect(resolveChainName(42220, 'Chain 42220')).toBe('Celo');
    expect(resolveChainName(7777777, 'Chain 7777777')).toBe('Zora');
  });

  test('uses known chain names when name is missing', () => {
    expect(resolveChainName(8453)).toBe('Base');
    expect(resolveChainName(4217)).toContain('Tempo');
    expect(resolveChainName(4326)).toBe('MegaETH');
  });

  test('falls back to generic chain label for unknown chain ids', () => {
    expect(resolveChainName(999999999, 'Chain 999999999')).toBe('Chain 999999999');
    expect(resolveChainName(999999999)).toBe('Chain 999999999');
  });
});
