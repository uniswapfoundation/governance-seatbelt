import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { checkTreasuryMovement } from '../check-treasury-movement';
import { createMockSimulation } from './test-utils';

type TenderlyAssetChange = NonNullable<
  NonNullable<TenderlySimulation['transaction']['transaction_info']['asset_changes']>[number]
>;

function makeDeps({
  governorAddress,
  timelockAddress,
}: {
  governorAddress: `0x${string}`;
  timelockAddress: `0x${string}`;
}) {
  return {
    governor: { address: getAddress(governorAddress) },
    timelock: { address: getAddress(timelockAddress) },
    publicClient: null,
    chainConfig: {
      chainId: 1,
      blockExplorer: {
        baseUrl: 'https://etherscan.io',
        apiUrl: 'https://api.etherscan.io/api',
        source: 'etherscan',
      },
      rpcUrl: 'http://localhost:8545',
    },
    targets: [],
    touchedContracts: [],
  } as unknown as ProposalData;
}

const proposal = {
  id: 1n,
  proposalId: 1n,
  proposer: getAddress('0x0000000000000000000000000000000000000001'),
  startBlock: 0n,
  endBlock: 0n,
  description: 'test',
  targets: [],
  values: [],
  signatures: [],
  calldatas: [],
} satisfies ProposalEvent;

describe('checkTreasuryMovement', () => {
  test('passes when no outgoing treasury transfers', async () => {
    const sim = createMockSimulation([]);
    sim.transaction.transaction_info.asset_changes =
      [] as unknown as TenderlySimulation['transaction']['transaction_info']['asset_changes'];

    const result = await checkTreasuryMovement.checkProposal(
      proposal,
      sim,
      makeDeps({
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        timelockAddress: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.info.join('\n')).toContain('No outgoing treasury transfers detected');
    expect(result.data).toBeDefined();
    expect((result.data as { type?: string }).type).toBe('treasuryMovement/v1');
  });

  test('lists top recipients and emits warnings when thresholds exceeded', async () => {
    const timelock = getAddress('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
    const recipient = getAddress('0x0000000000000000000000000000000000000123');
    const sim = createMockSimulation([]);

    const changes: TenderlyAssetChange[] = [
      {
        token_info: {
          standard: 'NativeCurrency',
          type: 'Native',
          symbol: 'ETH',
          name: 'Ether',
          logo: '',
          decimals: 18,
          dollar_value: '2000000',
        },
        type: 'transfer',
        from: timelock,
        to: recipient,
        amount: '1000',
        raw_amount: '1000000000000000000000',
        dollar_value: '2000000',
      },
    ];

    sim.transaction.transaction_info.asset_changes =
      changes as unknown as TenderlySimulation['transaction']['transaction_info']['asset_changes'];

    const result = await checkTreasuryMovement.checkProposal(
      proposal,
      sim,
      makeDeps({
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        timelockAddress: timelock,
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.info.join('\n')).toContain(`\`${recipient}\``);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join('\n')).toContain('exceeded threshold');
    expect(result.data).toBeDefined();
    expect((result.data as { type?: string }).type).toBe('treasuryMovement/v1');
    expect(
      (result.data as { topRecipients?: Array<{ recipient: string }> }).topRecipients?.[0],
    ).toMatchObject({ recipient });
  });

  test('does not throw if asset changes have missing/invalid from/to', async () => {
    const timelock = getAddress('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
    const recipient = getAddress('0x0000000000000000000000000000000000000123');
    const sim = createMockSimulation([]);

    const changes: Array<Partial<TenderlyAssetChange>> = [
      {
        token_info: {
          standard: 'ERC20',
          type: 'ERC20',
          symbol: 'UNI',
          name: 'Uniswap',
          logo: '',
          decimals: 18,
          dollar_value: '0',
        },
        type: 'transfer',
        // @ts-expect-error Simulating Tenderly occasionally returning null-ish values
        from: null,
        to: recipient,
        amount: '1',
        raw_amount: '1',
        dollar_value: '1',
      },
      {
        token_info: {
          standard: 'ERC20',
          type: 'ERC20',
          symbol: 'UNI',
          name: 'Uniswap',
          logo: '',
          decimals: 18,
          dollar_value: '0',
        },
        type: 'transfer',
        from: timelock,
        to: 'not-an-address',
        amount: '1',
        raw_amount: '1',
        dollar_value: '1',
      },
    ];

    sim.transaction.transaction_info.asset_changes =
      changes as unknown as TenderlySimulation['transaction']['transaction_info']['asset_changes'];

    const result = await checkTreasuryMovement.checkProposal(
      proposal,
      sim,
      makeDeps({
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        timelockAddress: timelock,
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.info.join('\n')).toContain('No outgoing treasury transfers detected');
  });

  test('warns when USD pricing is missing', async () => {
    const timelock = getAddress('0x1a9C8182C09F50C8318d769245beA52c32BE35BC');
    const recipient = getAddress('0x0000000000000000000000000000000000000123');
    const sim = createMockSimulation([]);

    const changes: Array<Partial<TenderlyAssetChange>> = [
      {
        token_info: {
          standard: 'ERC20',
          type: 'ERC20',
          symbol: 'UNI',
          name: 'Uniswap',
          logo: '',
          decimals: 18,
          dollar_value: '0',
        },
        type: 'transfer',
        from: timelock,
        to: recipient,
        amount: '1',
        raw_amount: '1',
        // @ts-expect-error Simulating missing pricing
        dollar_value: null,
      },
    ];

    sim.transaction.transaction_info.asset_changes =
      changes as unknown as TenderlySimulation['transaction']['transaction_info']['asset_changes'];

    const result = await checkTreasuryMovement.checkProposal(
      proposal,
      sim,
      makeDeps({
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        timelockAddress: timelock,
      }),
    );

    expect(result.skipped).toBeUndefined();
    expect(result.warnings.join('\n')).toContain('missing USD pricing');
  });
});
