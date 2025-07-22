import { http, createPublicClient } from 'viem';
import type { PublicClient } from 'viem';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';

export interface ChainConfig {
  chainId: number;
  blockExplorer: {
    baseUrl: string;
    apiUrl: string;
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

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [mainnet.id]: {
    chainId: mainnet.id,
    blockExplorer: {
      baseUrl: mainnet.blockExplorers?.default.url,
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: process.env.MAINNET_RPC_URL,
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    blockExplorer: {
      baseUrl: arbitrum.blockExplorers?.default.url,
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
    },
    rpcUrl: process.env.ARBITRUM_RPC_URL,
  },
  [optimism.id]: {
    chainId: optimism.id,
    blockExplorer: {
      baseUrl: optimism.blockExplorers?.default.url,
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
    },
    rpcUrl: OPTIMISM_RPC_URL,
  },
  [base.id]: {
    chainId: base.id,
    blockExplorer: {
      baseUrl: base.blockExplorers?.default.url,
      apiUrl: 'https://api.etherscan.io/v2/api', // Using v2 unified API
      apiKey: process.env.ETHERSCAN_API_KEY, // Single API key for all chains
    },
    rpcUrl: BASE_RPC_URL,
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
};

export const publicClient = clients[mainnet.id];

export function getClientForChain(chainId: number) {
  const client = clients[chainId];
  if (!client) {
    throw new Error(`No client found for chain ID ${chainId}`);
  }
  return client;
}
