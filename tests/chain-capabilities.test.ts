import { describe, expect, test } from 'bun:test';
import {
  getChainName,
  getOpStackDestinationChainIds,
  supportsL2Checks,
  supportsTenderlyDestinationSimulation,
} from '../utils/chains/capabilities';

describe('chain capabilities registry', () => {
  test('returns canonical chain names when known', () => {
    expect(getChainName(1)).toBe('Ethereum');
    expect(getChainName(42161)).toContain('Arbitrum');
    expect(getChainName(10)).toBeTruthy();
    expect(getChainName(56)).toContain('BNB');
    expect(getChainName(137)).toContain('Polygon');
    expect(getChainName(43114)).toContain('Avalanche');
    expect(getChainName(143)).toContain('Monad');
    expect(getChainName(4217)).toContain('Tempo');
    expect(getChainName(4326)).toBe('MegaETH');
  });

  test('falls back to generic chain label for unknown chain ids', () => {
    expect(getChainName(999999999)).toBe('Chain 999999999');
  });

  test('keeps l2-check and tenderly-destination capability differences explicit', () => {
    expect(supportsL2Checks(7777777)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(7777777)).toBe(false);

    expect(supportsL2Checks(42161)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(42161)).toBe(true);
    expect(supportsL2Checks(56)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(56)).toBe(true);
    expect(supportsL2Checks(137)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(137)).toBe(true);
    expect(supportsL2Checks(43114)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(43114)).toBe(true);
    expect(supportsL2Checks(143)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(143)).toBe(true);
    expect(supportsL2Checks(4217)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(4217)).toBe(true);
    expect(supportsL2Checks(4326)).toBe(true);
    expect(supportsTenderlyDestinationSimulation(4326)).toBe(true);
  });

  test('exposes OP Stack destination ordering used for summaries', () => {
    expect(getOpStackDestinationChainIds()).toEqual([
      10, 8453, 130, 196, 480, 42220, 57073, 1868, 60808, 7777777,
    ]);
  });
});
