import { describe, expect, test } from 'bun:test';
import { http, createPublicClient, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { DEFAULT_SIMULATION_ADDRESS } from '../utils/clients/tenderly';

describe('DEFAULT_SIMULATION_ADDRESS constant and on-chain state', () => {
  test('matches expected placeholder value', () => {
    const expected = getAddress('0x0000000000000000000000000000000000001234');
    expect(getAddress(DEFAULT_SIMULATION_ADDRESS)).toBe(expected);
  });

  test('is an empty EOA on mainnet (no code, nonce = 0)', async () => {
    // Use a real public client. Prefer env, fall back to a public RPC.
    const rpcUrl = process.env.MAINNET_RPC_URL || 'https://cloudflare-eth.com';
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });

    const addr = getAddress(DEFAULT_SIMULATION_ADDRESS);
    const code = await client.getCode({ address: addr });
    const nonce = await client.getTransactionCount({ address: addr });

    // Expect no bytecode and zero nonce
    expect(code === '0x' || code === undefined || code === null).toBe(true);
    expect(nonce).toBe(0);
  });
});
