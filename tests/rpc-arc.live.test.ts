import { expect, test } from 'bun:test';
import { encodeFunctionData, parseAbi } from 'viem';
import { checkAssetBalances } from '../checks/check-asset-balances';
import { checkTreasuryMovement } from '../checks/check-treasury-movement';
import type { ProposalData, ProposalEvent, TenderlyPayload } from '../types';
import { getChainConfig } from '../utils/clients/client';
import { sendRpcSimulation, simulationRpc } from '../utils/clients/rpc-simulation';

const liveTest = process.env.RUN_ARC_RPC_TESTS === '1' ? test : test.skip;

// Arc precompiles and trace gas refunds cannot be reproduced by standard Anvil.
// These calls use state overrides only; nothing is signed or broadcast.
liveTest(
  'Arc USDC transfers reconcile once, preserve treasury reads, and price in USD',
  async () => {
    const sender = '0x0000000000000000000000000000000000001234';
    const recipient = '0x0000000000000000000000000000000000005678';
    const receiver = '0xbCA30b5429935205037069cF5b8A165F55d05a75';
    const tokenJar = '0xfd39ac616e630e9db03EFB2c9a4Fe63eDB949233';
    const contract = '0x0000000000000000000000000000000000009aBC';
    const block = await simulationRpc<{ number: string }>(5042, 'eth_getBlockByNumber', [
      'latest',
      false,
    ]);
    const payload: TenderlyPayload = {
      network_id: '5042' as TenderlyPayload['network_id'],
      block_number: Number(BigInt(block.number)),
      from: sender,
      to: recipient,
      input: '0x',
      gas: 1_000_000,
      value: '2000000000000000000',
      fund_synthetic_sender: true,
      balance_addresses: [receiver, tokenJar],
      state_objects: {
        [sender]: { balance: '10000000000000000000' },
        [recipient]: { balance: '0' },
        [tokenJar]: { balance: '5000000000000000000' },
      },
    };
    const deps = {
      governor: { address: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' },
      timelock: { address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' },
      chainConfig: getChainConfig(5042),
    } as ProposalData;
    const proposal = {} as ProposalEvent;
    for (const erc20 of [false, true]) {
      const sim = await sendRpcSimulation(
        erc20
          ? {
              ...payload,
              to: '0x3600000000000000000000000000000000000000',
              value: '0',
              input: encodeFunctionData({
                abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
                functionName: 'transfer',
                args: [recipient, 2_000_000n],
              }),
            }
          : payload,
      );
      expect(sim.transaction.status).toBe(true);
      expect(sim.assetBalances?.filter((row) => row.address === sender)).toEqual([
        {
          address: sender,
          tokenAddress: null,
          symbol: 'USDC',
          decimals: 18,
          before: '10000000000000000000',
          after: '8000000000000000000',
        },
      ]);
      expect(sim.assetBalances?.find((row) => row.address === recipient)).toMatchObject({
        before: '0',
        after: '2000000000000000000',
      });
      expect(sim.assetBalances?.find((row) => row.address === tokenJar)).toMatchObject({
        before: '5000000000000000000',
        after: '5000000000000000000',
      });
      expect(sim.assetWarnings).toEqual([]);
      expect(sim.transaction.transaction_info.asset_changes).toHaveLength(1);
      expect(sim.transaction.transaction_info.asset_changes?.[0]).toMatchObject({
        from: sender,
        to: recipient,
        raw_amount: '2000000000000000000',
        amount: '2',
        token_info: { standard: 'NativeCurrency', decimals: 18 },
      });
      const assets = await checkAssetBalances.checkProposal(proposal, sim, deps);
      const senderRow = assets.data.rows.find((row: { address: string }) => row.address === sender);
      expect(senderRow.change).toBe('-2');
      expect(senderRow.usdChange).toBeGreaterThan(-2.1);
      expect(senderRow.usdChange).toBeLessThan(-1.9);
      expect(assets.warnings).toEqual([]);
      const treasury = await checkTreasuryMovement.checkProposal(proposal, sim, deps);
      expect(treasury.data.treasuryAddresses).toEqual([receiver, tokenJar]);
      expect(treasury.data.checked).toHaveLength(2);
      expect(treasury.data.measuredDecreaseUsd).toBe(0);
      expect(treasury.warnings).toEqual([]);
    }
    const paid = await sendRpcSimulation({ ...payload, fund_synthetic_sender: false });
    const balance = paid.assetBalances!.find((row) => row.address === sender)!;
    expect(BigInt(balance.before!) - BigInt(balance.after!)).toBe(
      2_000_000_000_000_000_000n + 21_000n * BigInt(paid.simulation.gas_price),
    );
    for (const [code, success] of [
      ['0x333160005260206000a000', true],
      ['0x60006000fd', false],
    ] as const) {
      const sim = await sendRpcSimulation({
        ...payload,
        to: contract,
        value: '0',
        state_objects: { ...payload.state_objects, [contract]: { code } },
      });
      expect(sim.transaction.status).toBe(success);
      expect(sim.assetBalances?.find((row) => row.address === sender)).toMatchObject({
        before: '10000000000000000000',
        after: '10000000000000000000',
      });
      if (success)
        expect(BigInt(sim.transaction.transaction_info.logs![0].raw.data)).toBe(
          10_000_000_000_000_000_000n,
        );
    }
  },
  120_000,
);
