import { getAddress } from 'viem';
import type { Address } from 'viem';
import type { TenderlySimulation } from '../types';

export type TreasuryMovementThresholds = {
  totalUsdWarning?: number;
  recipientUsdWarning?: number;
  topRecipients?: number;
};

export type DaoTreasuryMovementConfig = {
  includeTimelockAsTreasury?: boolean;
  treasuryAddresses?: Address[];
  thresholds?: TreasuryMovementThresholds;
};

const DEFAULT_THRESHOLDS: Required<TreasuryMovementThresholds> = {
  totalUsdWarning: 1_000_000,
  recipientUsdWarning: 250_000,
  topRecipients: 5,
};

/**
 * Configure per-governor settings here (keyed by governor address).
 * Defaults are intentionally conservative and can be overridden per DAO.
 */
const CONFIG_BY_GOVERNOR: Record<string, Record<number, DaoTreasuryMovementConfig>> = {
  // Verified deployment sources and ownership reads: docs/uniswap-treasuries.md.
  // Uniswap Governor
  [getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3')]: {
    // Ethereum
    1: { treasuryAddresses: ['0xf38521f130fcCF29dB1961597bc5d2B60F995f85'] },
    // Unichain
    130: {
      treasuryAddresses: [
        '0x2bad8182c09f50c8318d769245bea52c32be46cd',
        '0xD576BDF6b560079a4c204f7644e556DbB19140b5',
      ],
    },
    // World Chain
    480: {
      treasuryAddresses: [
        '0xcb2436774c3e191c85056d248ef4260ce5f27a9d',
        '0xbDb82c2dE7D8748A3e499e771604ef8ef8544918',
      ],
    },
    // Soneium
    1868: {
      treasuryAddresses: [
        '0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
        '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
        '0x85aeb792b94a9d79741002FC871423Ec5dAD29e9',
      ],
    },
    // Celo
    42220: {
      treasuryAddresses: [
        '0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
        '0x0Eb863541278308c3A64F8E908BC646e27BFD071',
        '0x190c22c5085640D1cB60CeC88a4F736Acb59bb6B',
      ],
    },
    // Zora
    7777777: {
      treasuryAddresses: [
        '0x36eec182d0b24df3dc23115d64db521a93d5154f',
        '0x4753C137002D802f45302b118E265c41140e73C2',
      ],
    },
    // X Layer
    196: {
      treasuryAddresses: [
        '0x044aaf330d7fd6ae683eec5c1c1d1fff5196b6b7',
        '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
        '0x8Dd8B6D56e4a4A158EDbBfE7f2f703B8FFC1a754',
      ],
    },
    // Arbitrum
    42161: {
      treasuryAddresses: [
        '0x2bad8182c09f50c8318d769245bea52c32be46cd',
        '0x95E337C5B155385945D407f5396387D0c2a3A263',
      ],
    },
    // Optimism
    10: {
      treasuryAddresses: [
        '0xa1dd330d602c32622aa270ea73d078b803cb3518',
        '0xb13285DF724ea75f3f1E9912010B7e491dCd5EE3',
      ],
    },
    // Base
    8453: {
      treasuryAddresses: [
        '0x31fafd4889fa1269f7a13a66ee0fb458f27d72a9',
        '0x9bD25e67bF390437C8fAF480AC735a27BcF6168c',
      ],
    },
    // Polygon
    137: {
      treasuryAddresses: [
        '0x8a1b966ac46f42275860f905dbc75efbfdc12374',
        '0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A',
      ],
    },
    // BNB
    56: {
      treasuryAddresses: [
        '0x341c1511141022cf8ee20824ae0ffa3491f1302b',
        '0xc6Ae6373CEcc9e595A6C8b9fe581925a8c84f70A',
      ],
    },
    // Robinhood
    4663: {
      treasuryAddresses: [
        '0x2bad8182c09f50c8318d769245bea52c32be46cd',
        '0x2aC03e14Cfe755426DaAEe0a4994184Ce81482F8',
      ],
    },
    // Monad
    143: { treasuryAddresses: ['0xe783de89a7f0408687f051e3e6d0beb62719ebad'] },
    // Tempo
    4217: { treasuryAddresses: ['0xcfb43dc56b55be9611ded8384201cecf06a9811b'] },
    // MegaETH: current and previous executors
    4326: {
      treasuryAddresses: [
        '0xa107580f73bd797bd8b87ff24e98346d99f93ddb',
        '0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c',
      ],
    },
    // Avalanche: current and previous executors
    43114: {
      treasuryAddresses: [
        '0x47eb0cf11a1626462da3c830bcde64c3f582b5a6',
        '0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc',
      ],
    },
    // Ink: v2/v4 alias and v3 owner
    57073: {
      treasuryAddresses: [
        '0x2BAD8182C09F50c8318d769245beA52C32Be46CD',
        '0x66c5d722fc52671c7f839bbbf752bc38e0520b91',
      ],
    },
    // BOB
    60808: { treasuryAddresses: ['0xa683c66045ad16abb1bce5ad46a64d95f9a25785'] },
    // Arc
    5042: {
      treasuryAddresses: [
        '0xbca30b5429935205037069cf5b8a165f55d05a75',
        '0xfd39ac616e630e9db03EFB2c9a4Fe63eDB949233',
      ],
    },
  },
};

export function getTreasuryMovementConfig({
  governorAddress,
  timelockAddress,
  chainId,
}: {
  governorAddress: Address;
  timelockAddress?: Address;
  chainId: number;
}) {
  const configured = CONFIG_BY_GOVERNOR[getAddress(governorAddress)]?.[chainId] ?? {};
  // Governors and their timelocks are currently loaded from Ethereum mainnet.
  const includeTimelock = chainId === 1 && (configured.includeTimelockAsTreasury ?? true);

  const treasuryAddresses = new Set<Address>();
  if (includeTimelock && timelockAddress) treasuryAddresses.add(getAddress(timelockAddress));
  for (const addr of configured.treasuryAddresses ?? []) treasuryAddresses.add(getAddress(addr));

  const thresholds: Required<TreasuryMovementThresholds> = {
    totalUsdWarning: configured.thresholds?.totalUsdWarning ?? DEFAULT_THRESHOLDS.totalUsdWarning,
    recipientUsdWarning:
      configured.thresholds?.recipientUsdWarning ?? DEFAULT_THRESHOLDS.recipientUsdWarning,
    topRecipients: configured.thresholds?.topRecipients ?? DEFAULT_THRESHOLDS.topRecipients,
  };

  return {
    treasuryAddresses: [...treasuryAddresses],
    thresholds,
  };
}

type TenderlyAssetChange = NonNullable<
  NonNullable<TenderlySimulation['transaction']['transaction_info']['asset_changes']>[number]
>;

function safeGetAddress(value: unknown): Address | null {
  if (typeof value !== 'string') return null;
  try {
    return getAddress(value) as Address;
  } catch {
    return null;
  }
}

export function getOutgoingTreasuryAssetChanges({
  sim,
  treasuryAddresses,
}: {
  sim: TenderlySimulation;
  treasuryAddresses: Address[];
}) {
  const assetChanges = sim.transaction.transaction_info.asset_changes;
  if (!assetChanges || assetChanges.length === 0) return [];

  const treasury = new Set(treasuryAddresses.map((a) => getAddress(a)));

  return assetChanges.filter((change): change is TenderlyAssetChange => {
    const from = safeGetAddress((change as { from?: unknown }).from);
    const to = safeGetAddress((change as { to?: unknown }).to);
    if (!from || !to) return false;

    const isFromTreasury = treasury.has(from);
    const isToTreasury = treasury.has(to);

    if (!isFromTreasury) return false;
    if (isToTreasury) return false;

    // Include all outgoing asset changes; some standards may not have pricing, which is
    // handled by the check layer (so we can warn about under-reporting).
    return true;
  });
}
