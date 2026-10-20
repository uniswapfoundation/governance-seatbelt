import { expect, test } from 'bun:test';
import type { TenderlyPayload } from '../types';
import { sendRpcSimulation, simulationRpc } from '../utils/clients/rpc-simulation';

const liveTest = process.env.RUN_CHAIN_RPC_TESTS === '1' ? test : test.skip;

// These node fee rules and protected system accounts do not exist in Anvil.
// State overrides only: no transactions are signed or broadcast.
for (const chainId of [137, 143, 196, 42161, 43114, 4326, 4663]) {
  liveTest(
    `Chain ${chainId}: gas sponsorship preserves balances and chained calls`,
    async () => {
      const sender = '0x0000000000000000000000000000000000001234';
      const recipient = '0x0000000000000000000000000000000000005678';
      const contract = '0x0000000000000000000000000000000000009aBC';
      const block = await simulationRpc<string>(chainId, 'eth_blockNumber', []);
      const payload: TenderlyPayload = {
        network_id: String(chainId) as TenderlyPayload['network_id'],
        block_number: Number(BigInt(block)),
        from: sender,
        to: recipient,
        input: '0x',
        gas: 1_000_000,
        value: '2000000000000000000',
        fund_synthetic_sender: true,
        state_objects: {
          [sender]: { balance: '10000000000000000000' },
          [recipient]: { balance: '0' },
        },
      };
      const first = await sendRpcSimulation(payload);
      expect(first.transaction.status).toBe(true);
      expect(first.assetBalances?.find((row) => row.address === sender)).toMatchObject({
        before: '10000000000000000000',
        after: '8000000000000000000',
      });
      expect(first.assetBalances?.find((row) => row.address === recipient)).toMatchObject({
        before: '0',
        after: '2000000000000000000',
      });
      const second = await sendRpcSimulation({ ...payload, state_objects: first.postState });
      expect(second.transaction.status).toBe(true);
      expect(second.assetBalances?.find((row) => row.address === sender)).toMatchObject({
        before: '8000000000000000000',
        after: '6000000000000000000',
      });
      expect(second.assetBalances?.find((row) => row.address === recipient)).toMatchObject({
        before: '2000000000000000000',
        after: '4000000000000000000',
      });
      const visible = await sendRpcSimulation({
        ...payload,
        to: contract,
        value: '0',
        state_objects: {
          ...payload.state_objects,
          [contract]: { code: '0x333160005260206000a000' },
        },
      });
      expect(visible.transaction.status).toBe(true);
      expect(BigInt(visible.transaction.transaction_info.logs![0].raw.data)).toBe(
        10_000_000_000_000_000_000n,
      );
      expect(visible.assetBalances?.find((row) => row.address === sender)?.after).toBe(
        '10000000000000000000',
      );
    },
    120_000,
  );
}
