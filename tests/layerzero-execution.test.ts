import { describe, expect, test } from 'bun:test';
import { type Hex, getAddress } from 'viem';
import {
  UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
} from '../utils/bridges/layerzero';
import { layerZeroTrustedRemoteMatches } from '../utils/bridges/layerzero-execution';

const WRONG_REMOTE = getAddress('0x000000000000000000000000000000000000dEaD');
const WRONG_LOCAL = getAddress('0x000000000000000000000000000000000000bEEF');

function trustedRemotePath(remoteAddress: `0x${string}`, localAddress: `0x${string}`): Hex {
  return `${getAddress(remoteAddress)}${getAddress(localAddress).slice(2)}` as Hex;
}

describe('LayerZero receiver execution checks', () => {
  test('accepts a trusted remote path for the expected source and local receiver', () => {
    expect(
      layerZeroTrustedRemoteMatches(
        trustedRemotePath(
          UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
          UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
        ),
        UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
        UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      ),
    ).toBe(true);
  });

  test('rejects the wrong source remote address', () => {
    expect(
      layerZeroTrustedRemoteMatches(
        trustedRemotePath(WRONG_REMOTE, UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR),
        UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
        UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      ),
    ).toBe(false);
  });

  test('rejects the wrong local receiver address', () => {
    expect(
      layerZeroTrustedRemoteMatches(
        trustedRemotePath(UNISWAP_OMNICHAIN_PROPOSAL_SENDER, WRONG_LOCAL),
        UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
        UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      ),
    ).toBe(false);
  });

  test('rejects unset trusted remote bytes', () => {
    expect(
      layerZeroTrustedRemoteMatches(
        '0x',
        UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
        UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
      ),
    ).toBe(false);
  });
});
