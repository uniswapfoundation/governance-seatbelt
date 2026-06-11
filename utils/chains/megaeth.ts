import type { Chain } from 'viem';

export const MEGAETH_CHAIN_ID = 4326;
export const MEGAETH_CHAIN_NAME = 'MegaETH';
export const MEGAETH_BLOCK_EXPLORER_BASE_URL = 'https://mega.etherscan.io';
export const MEGAETH_DEFAULT_RPC_URL = 'https://mainnet.megaeth.com/rpc';

export const megaeth = {
  id: MEGAETH_CHAIN_ID,
  name: MEGAETH_CHAIN_NAME,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [MEGAETH_DEFAULT_RPC_URL],
    },
    public: {
      http: [MEGAETH_DEFAULT_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'MegaETH Etherscan',
      url: MEGAETH_BLOCK_EXPLORER_BASE_URL,
    },
  },
} as const satisfies Chain;
