import { http, createPublicClient } from 'viem';
import type { PublicClient } from 'viem';
import {
  arbitrum,
  base,
  bob,
  celo,
  ink,
  mainnet,
  optimism,
  soneium,
  unichain,
  worldchain,
  xLayer,
  zora,
} from 'viem/chains';

export enum BlockExplorerSource {
  Blockscout = 'blockscout',
  Etherscan = 'etherscan',
}

export interface ChainConfig {
  chainId: number;
  blockExplorer: {
    baseUrl: string;
    apiUrl: string;
    source: BlockExplorerSource;
    apiKey?: string;
  };
  rpcUrl: string;
}

if (!process.env.MAINNET_RPC_URL || !process.env.ARBITRUM_RPC_URL) {
  throw new Error(
    'MAINNET_RPC_URL and ARBITRUM_RPC_URL must be set. Optional: OPTIMISM_RPC_URL, BASE_RPC_URL, or ALCHEMY_API_KEY',
  );
}

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const OPTIMISM_RPC_URL =
  process.env.OPTIMISM_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.optimism.io');
const BASE_RPC_URL =
  process.env.BASE_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.base.org');
const UNICHAIN_RPC_URL =
  process.env.UNICHAIN_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://unichain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://mainnet.unichain.org');
const INK_RPC_URL =
  process.env.INK_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://ink-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://rpc-gel.inkonchain.com');
const SONEIUM_RPC_URL = process.env.SONEIUM_RPC_URL || soneium.rpcUrls.default.http[0];
const BOB_RPC_URL = process.env.BOB_RPC_URL || 'https://bob.drpc.org';
const CELO_RPC_URL = process.env.CELO_RPC_URL || celo.rpcUrls.default.http[0];
const WORLDCHAIN_RPC_URL = process.env.WORLDCHAIN_RPC_URL || worldchain.rpcUrls.default.http[0];
const ZORA_RPC_URL = process.env.ZORA_RPC_URL || zora.rpcUrls.default.http[0];
const XLAYER_RPC_URL = process.env.XLAYER_RPC_URL || xLayer.rpcUrls.default.http[0];

const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api';

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [mainnet.id]: {
    chainId: mainnet.id,
    blockExplorer: {
      baseUrl: mainnet.blockExplorers?.default.url || 'https://etherscan.io',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: process.env.MAINNET_RPC_URL,
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    blockExplorer: {
      baseUrl: arbitrum.blockExplorers?.default.url || 'https://arbiscan.io',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: process.env.ARBITRUM_RPC_URL,
  },
  [optimism.id]: {
    chainId: optimism.id,
    blockExplorer: {
      baseUrl: optimism.blockExplorers?.default.url || 'https://optimistic.etherscan.io',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: OPTIMISM_RPC_URL,
  },
  [base.id]: {
    chainId: base.id,
    blockExplorer: {
      baseUrl: base.blockExplorers?.default.url || 'https://basescan.org',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: BASE_RPC_URL,
  },
  [unichain.id]: {
    chainId: unichain.id,
    blockExplorer: {
      baseUrl: unichain.blockExplorers?.default.url || 'https://uniscan.xyz',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: UNICHAIN_RPC_URL,
  },
  [ink.id]: {
    chainId: ink.id,
    blockExplorer: {
      baseUrl: ink.blockExplorers?.default.url,
      apiUrl: ink.blockExplorers?.default.apiUrl,
      source: BlockExplorerSource.Blockscout,
    },
    rpcUrl: INK_RPC_URL,
  },
  [soneium.id]: {
    chainId: soneium.id,
    blockExplorer: {
      baseUrl: soneium.blockExplorers?.default.url,
      apiUrl: 'https://soneium.blockscout.com/api/v2',
      source: BlockExplorerSource.Blockscout,
    },
    rpcUrl: SONEIUM_RPC_URL,
  },
  [bob.id]: {
    chainId: bob.id,
    blockExplorer: {
      baseUrl: bob.blockExplorers?.default.url,
      apiUrl: 'https://explorer.gobob.xyz/api/v2',
      source: BlockExplorerSource.Blockscout,
    },
    rpcUrl: BOB_RPC_URL,
  },
  [celo.id]: {
    chainId: celo.id,
    blockExplorer: {
      baseUrl: celo.blockExplorers?.default.url || 'https://celoscan.io',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: CELO_RPC_URL,
  },
  [worldchain.id]: {
    chainId: worldchain.id,
    blockExplorer: {
      baseUrl: worldchain.blockExplorers?.default.url || 'https://worldscan.org',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: WORLDCHAIN_RPC_URL,
  },
  [zora.id]: {
    chainId: zora.id,
    blockExplorer: {
      baseUrl: zora.blockExplorers?.default.url || 'https://explorer.zora.energy',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: ZORA_RPC_URL,
  },
  [xLayer.id]: {
    chainId: xLayer.id,
    blockExplorer: {
      baseUrl: xLayer.blockExplorers?.default.url || 'https://www.oklink.com/xlayer',
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: XLAYER_RPC_URL,
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`No configuration found for chain ID ${chainId}`);
  }
  return config;
}

const clients: Record<number, PublicClient> = {
  [mainnet.id]: createPublicClient({
    chain: mainnet,
    transport: http(CHAIN_CONFIGS[mainnet.id].rpcUrl),
  }),
  [arbitrum.id]: createPublicClient({
    chain: arbitrum,
    transport: http(CHAIN_CONFIGS[arbitrum.id].rpcUrl),
  }),
  [optimism.id]: createPublicClient({
    chain: optimism,
    transport: http(CHAIN_CONFIGS[optimism.id].rpcUrl),
  }) as unknown as PublicClient,
  [base.id]: createPublicClient({
    chain: base,
    transport: http(CHAIN_CONFIGS[base.id].rpcUrl),
  }) as unknown as PublicClient,
  [unichain.id]: createPublicClient({
    chain: unichain,
    transport: http(CHAIN_CONFIGS[unichain.id].rpcUrl),
  }) as unknown as PublicClient,
  [ink.id]: createPublicClient({
    chain: ink,
    transport: http(CHAIN_CONFIGS[ink.id].rpcUrl),
  }) as unknown as PublicClient,
  [soneium.id]: createPublicClient({
    chain: soneium,
    transport: http(CHAIN_CONFIGS[soneium.id].rpcUrl),
  }) as unknown as PublicClient,
  [bob.id]: createPublicClient({
    chain: bob,
    transport: http(CHAIN_CONFIGS[bob.id].rpcUrl),
  }) as unknown as PublicClient,
  [celo.id]: createPublicClient({
    chain: celo,
    transport: http(CHAIN_CONFIGS[celo.id].rpcUrl),
  }) as unknown as PublicClient,
  [worldchain.id]: createPublicClient({
    chain: worldchain,
    transport: http(CHAIN_CONFIGS[worldchain.id].rpcUrl),
  }) as unknown as PublicClient,
  [zora.id]: createPublicClient({
    chain: zora,
    transport: http(CHAIN_CONFIGS[zora.id].rpcUrl),
  }) as unknown as PublicClient,
  [xLayer.id]: createPublicClient({
    chain: xLayer,
    transport: http(CHAIN_CONFIGS[xLayer.id].rpcUrl),
  }) as unknown as PublicClient,
};

export const publicClient = clients[mainnet.id];

export function getClientForChain(chainId: number) {
  const client = clients[chainId];
  if (!client) {
    throw new Error(`No client found for chain ID ${chainId}`);
  }
  return client;
}
