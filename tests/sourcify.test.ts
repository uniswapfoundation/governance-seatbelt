import { describe, expect, it } from 'bun:test';
import { isContractVerifiedOnSourcify } from '../utils/clients/sourcify';

describe('Sourcify verification', () => {
  it('returns verified for a known verified contract', async () => {
    // Ethereum 2.0 deposit contract (commonly verified on Sourcify)
    const verified = await isContractVerifiedOnSourcify(
      '0x00000000219ab540356cBB839Cbe05303d7705Fa',
      1,
    );
    expect(verified).toBe(true);
  }, 10000);

  it('returns unverified for a known unverified contract', async () => {
    const verified = await isContractVerifiedOnSourcify(
      '0x0000000000000000000000000000000000000001',
      1,
    );
    expect(verified).toBe(false);
  }, 10000);
});
