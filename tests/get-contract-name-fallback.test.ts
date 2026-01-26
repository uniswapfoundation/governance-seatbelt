import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import type { TenderlyContract } from '../types.d';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { getContractName } from '../utils/clients/tenderly';

describe('getContractName() explorer fallback', () => {
  test('uses explorer name when Tenderly name is missing (no network)', async () => {
    const originalFetchContractName = BlockExplorerFactory.fetchContractName;
    let called = false;
    let seenAddress = '';
    let seenChainId = 0;

    BlockExplorerFactory.fetchContractName = async (address: string, chainId: number) => {
      called = true;
      seenAddress = address;
      seenChainId = chainId;
      return 'ExplorerFallbackName';
    };

    try {
      const targetAddress = getAddress('0x0000000000000000000000000000000000000001');
      const name = await getContractName({ address: targetAddress } as TenderlyContract, 1);

      expect(called).toBe(true);
      expect(seenAddress).toBe(targetAddress);
      expect(seenChainId).toBe(1);
      expect(name).toBe(`ExplorerFallbackName at \`${targetAddress}\``);
    } finally {
      BlockExplorerFactory.fetchContractName = originalFetchContractName;
    }
  });

  test('does not change behavior when Tenderly already provides a name (no network)', async () => {
    const originalFetchContractName = BlockExplorerFactory.fetchContractName;
    BlockExplorerFactory.fetchContractName = async () => {
      throw new Error('fetchContractName should not be called for Tenderly-named contracts');
    };

    try {
      const address = getAddress('0x0000000000000000000000000000000000000002');
      const name = await getContractName(
        { address, contract_name: 'TenderlyName' } as TenderlyContract,
        1,
      );

      expect(name).toBe(`TenderlyName at \`${address}\``);
    } finally {
      BlockExplorerFactory.fetchContractName = originalFetchContractName;
    }
  });
});
