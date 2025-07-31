import { describe, expect, it } from 'bun:test';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';

describe('Block Explorer Factory', () => {
  it('should use Blockscout for Ink chain', async () => {
    // Test fetching ABI for Multicall3 on Ink
    const abi = await BlockExplorerFactory.fetchContractAbi(
      '0xcA11bde05977b3631167028862bE2a173976CA11',
      57073,
    );

    expect(abi).toBeDefined();
    expect(Array.isArray(abi)).toBe(true);
    expect(abi!.length).toBeGreaterThan(0);
  }, 10000); // 10 second timeout

  it('should verify contract status on Ink chain', async () => {
    // Test verification status for Multicall3 on Ink
    const isVerified = await BlockExplorerFactory.isContractVerified(
      '0xcA11bde05977b3631167028862bE2a173976CA11',
      57073,
    );

    expect(isVerified).toBe(true);
  }, 10000); // 10 second timeout

  it('should use Etherscan for mainnet', async () => {
    // Test fetching ABI for a known contract on mainnet (WETH)
    const abi = await BlockExplorerFactory.fetchContractAbi(
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      1,
    );

    // Should return ABI for WETH contract
    expect(abi).toBeDefined();
    expect(Array.isArray(abi)).toBe(true);
  }, 10000); // 10 second timeout

  it('should handle unsupported chains gracefully', async () => {
    // Test with an unsupported chain ID
    const abi = await BlockExplorerFactory.fetchContractAbi(
      '0xA0b86a33E6441b8c4C8C0C4C8C0C4C8C0C4C8C0C',
      999999,
    );

    // Should return null for unsupported chains
    expect(abi).toBeNull();
  }, 15000); // 15 second timeout for network calls
});
