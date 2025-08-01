import { http, createPublicClient } from 'viem';
import type { PublicClient } from 'viem';
import { arbitrum, base, ink, mainnet, optimism, soneium, unichain } from 'viem/chains';

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

// Optional RPC URLs for Optimism and Base - can be computed from Alchemy API key
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
const SONEIUM_RPC_URL =
  process.env.SONEIUM_RPC_URL ||
  (ALCHEMY_API_KEY
    ? `https://soneium-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : 'https://rpc.soneium.org');

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [mainnet.id]: {
    chainId: mainnet.id,
    blockExplorer: {
      baseUrl: mainnet.blockExplorers?.default.url || 'https://etherscan.io',
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY,
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: process.env.MAINNET_RPC_URL,
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    blockExplorer: {
      baseUrl: arbitrum.blockExplorers?.default.url || 'https://arbiscan.io',
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: process.env.ARBITRUM_RPC_URL,
  },
  [optimism.id]: {
    chainId: optimism.id,
    blockExplorer: {
      baseUrl: optimism.blockExplorers?.default.url || 'https://optimistic.etherscan.io',
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: OPTIMISM_RPC_URL,
  },
  [base.id]: {
    chainId: base.id,
    blockExplorer: {
      baseUrl: base.blockExplorers?.default.url || 'https://basescan.org',
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
      source: BlockExplorerSource.Etherscan,
    },
    rpcUrl: BASE_RPC_URL,
  },
  [unichain.id]: {
    chainId: unichain.id,
    blockExplorer: {
      baseUrl: unichain.blockExplorers?.default.url || 'https://uniscan.xyz',
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
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
      apiUrl: soneium.blockExplorers?.default.apiUrl,
      source: BlockExplorerSource.Blockscout,
    },
    rpcUrl: SONEIUM_RPC_URL,
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`No configuration found for chain ID ${chainId}`);
  }
  return config;
}

// Create clients for each chain
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
  }) as PublicClient,
  [base.id]: createPublicClient({
    chain: base,
    transport: http(CHAIN_CONFIGS[base.id].rpcUrl),
  }) as PublicClient,
  [unichain.id]: createPublicClient({
    chain: unichain,
    transport: http(CHAIN_CONFIGS[unichain.id].rpcUrl),
  }) as PublicClient,
  [ink.id]: createPublicClient({
    chain: ink,
    transport: http(CHAIN_CONFIGS[ink.id].rpcUrl),
  }) as PublicClient,
  [soneium.id]: createPublicClient({
    chain: soneium,
    transport: http(CHAIN_CONFIGS[soneium.id].rpcUrl),
  }) as PublicClient,
};

export const publicClient = clients[mainnet.id];

export function getClientForChain(chainId: number) {
  const client = clients[chainId];
  if (!client) {
    throw new Error(`No client found for chain ID ${chainId}`);
  }
  return client;
}
