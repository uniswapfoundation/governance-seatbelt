import { http, createPublicClient, custom } from 'viem';
import type { PublicClient, Transport } from 'viem';
import {
  arbitrum,
  arc,
  avalanche,
  base,
  bob,
  bsc,
  celo,
  ink,
  mainnet,
  megaeth,
  monad,
  optimism,
  polygon,
  robinhood,
  soneium,
  tempo,
  unichain,
  worldchain,
  xLayer,
  zora,
} from 'viem/chains';
import { configuredRpc } from '../chains/rpc-endpoints';
import { DEFAULT_BLOCK_EXPLORER_BASE_URL, normalizeBlockExplorerBaseUrl } from '../explorer-links';
import { managedFetch, usesManagedAccess } from './managed-access';

export enum BlockExplorerSource {
  Blockscout = 'blockscout',
  Etherscan = 'etherscan',
}

export enum VerificationBackend {
  EtherscanV2 = 'etherscan-v2',
  Blockscout = 'blockscout',
  Tempo = 'tempo',
  SourcifyOnly = 'sourcify-only',
}

export interface ChainConfig {
  chainId: number;
  blockExplorer: {
    baseUrl: string;
    // Legacy fields retained for test fixture compatibility only.
    apiUrl?: string;
    source?: BlockExplorerSource;
    apiKey?: string;
  };
  verification?: {
    backend: VerificationBackend;
    apiUrl?: string;
    apiKey?: string;
    degradedReason?: string;
  };
  /** Optional Blockscout API v2 URL for ABI and verified-source fallback. */
  blockscoutApiUrl?: string;
  rpcUrl: string;
}

const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api';

type ChainById = {
  [arc.id]: typeof arc;
  [mainnet.id]: typeof mainnet;
  [arbitrum.id]: typeof arbitrum;
  [robinhood.id]: typeof robinhood;
  [optimism.id]: typeof optimism;
  [base.id]: typeof base;
  [unichain.id]: typeof unichain;
  [ink.id]: typeof ink;
  [soneium.id]: typeof soneium;
  [bob.id]: typeof bob;
  [bsc.id]: typeof bsc;
  [celo.id]: typeof celo;
  [polygon.id]: typeof polygon;
  [avalanche.id]: typeof avalanche;
  [monad.id]: typeof monad;
  [tempo.id]: typeof tempo;
  [megaeth.id]: typeof megaeth;
  [worldchain.id]: typeof worldchain;
  [zora.id]: typeof zora;
  [xLayer.id]: typeof xLayer;
};

const CHAIN_BY_ID: ChainById = {
  [arc.id]: arc,
  [mainnet.id]: mainnet,
  [arbitrum.id]: arbitrum,
  [robinhood.id]: robinhood,
  [optimism.id]: optimism,
  [base.id]: base,
  [unichain.id]: unichain,
  [ink.id]: ink,
  [soneium.id]: soneium,
  [bob.id]: bob,
  [bsc.id]: bsc,
  [celo.id]: celo,
  [polygon.id]: polygon,
  [avalanche.id]: avalanche,
  [monad.id]: monad,
  [tempo.id]: tempo,
  [megaeth.id]: megaeth,
  [worldchain.id]: worldchain,
  [zora.id]: zora,
  [xLayer.id]: xLayer,
};

type SupportedChainId = keyof ChainById;
type ChainForId<I extends SupportedChainId> = ChainById[I];
type ClientRegistry = {
  [I in SupportedChainId]: PublicClient<Transport, ChainForId<I>>;
};

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [arc.id]: {
    chainId: arc.id,
    blockscoutApiUrl:
      process.env.BLOCKSCOUT_API_KEY || usesManagedAccess()
        ? 'https://api.blockscout.com/5042/api/v2'
        : 'https://explorer.arc.io/api/v2',
    blockExplorer: { baseUrl: 'https://arc.etherscan.io' },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(arc.id),
  },
  [mainnet.id]: {
    chainId: mainnet.id,
    blockscoutApiUrl: 'https://eth.blockscout.com/api/v2',
    blockExplorer: {
      baseUrl: mainnet.blockExplorers?.default.url || 'https://etherscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(mainnet.id),
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    blockscoutApiUrl: 'https://arbitrum.blockscout.com/api/v2',
    blockExplorer: {
      baseUrl: arbitrum.blockExplorers?.default.url || 'https://arbiscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(arbitrum.id),
  },
  [robinhood.id]: {
    chainId: robinhood.id,
    blockExplorer: {
      baseUrl: robinhood.blockExplorers.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://robinhoodchain.blockscout.com/api/v2',
    },
    rpcUrl: configuredRpc(robinhood.id),
  },
  [optimism.id]: {
    chainId: optimism.id,
    blockscoutApiUrl: 'https://optimism.blockscout.com/api/v2',
    blockExplorer: {
      baseUrl: optimism.blockExplorers?.default.url || 'https://optimistic.etherscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(optimism.id),
  },
  [base.id]: {
    chainId: base.id,
    blockscoutApiUrl: 'https://base.blockscout.com/api/v2',
    blockExplorer: {
      baseUrl: base.blockExplorers?.default.url || 'https://basescan.org',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(base.id),
  },
  [unichain.id]: {
    chainId: unichain.id,
    blockscoutApiUrl: 'https://unichain.blockscout.com/api/v2',
    blockExplorer: {
      baseUrl: unichain.blockExplorers?.default.url || 'https://uniscan.xyz',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(unichain.id),
  },
  [ink.id]: {
    chainId: ink.id,
    blockExplorer: {
      baseUrl: ink.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: ink.blockExplorers?.default.apiUrl,
    },
    rpcUrl: configuredRpc(ink.id),
  },
  [soneium.id]: {
    chainId: soneium.id,
    blockExplorer: {
      baseUrl: soneium.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://soneium.blockscout.com/api/v2',
    },
    rpcUrl: configuredRpc(soneium.id),
  },
  [bob.id]: {
    chainId: bob.id,
    blockExplorer: {
      baseUrl: bob.blockExplorers?.default.url,
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://explorer.gobob.xyz/api/v2',
    },
    rpcUrl: configuredRpc(bob.id),
  },
  [bsc.id]: {
    chainId: bsc.id,
    blockExplorer: {
      baseUrl: bsc.blockExplorers?.default.url || 'https://bscscan.com',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(bsc.id),
  },
  [celo.id]: {
    chainId: celo.id,
    blockExplorer: {
      baseUrl: celo.blockExplorers?.default.url || 'https://celoscan.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(celo.id),
  },
  [polygon.id]: {
    chainId: polygon.id,
    blockExplorer: {
      baseUrl: polygon.blockExplorers?.default.url || 'https://polygonscan.com',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(polygon.id),
  },
  [avalanche.id]: {
    chainId: avalanche.id,
    blockExplorer: {
      baseUrl: avalanche.blockExplorers?.default.url || 'https://snowtrace.io',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(avalanche.id),
  },
  [monad.id]: {
    chainId: monad.id,
    blockExplorer: {
      baseUrl: monad.blockExplorers?.default.url || 'https://monadvision.com',
    },
    verification: {
      backend: VerificationBackend.SourcifyOnly,
      degradedReason: 'Monad explorer verification API is not supported yet; using Sourcify only.',
    },
    rpcUrl: configuredRpc(monad.id),
  },
  [tempo.id]: {
    chainId: tempo.id,
    blockExplorer: {
      baseUrl: tempo.blockExplorers?.default.url || 'https://explore.tempo.xyz',
    },
    verification: {
      backend: VerificationBackend.Tempo,
      apiUrl: 'https://contracts.tempo.xyz',
    },
    rpcUrl: configuredRpc(tempo.id),
  },
  [megaeth.id]: {
    chainId: megaeth.id,
    blockExplorer: {
      baseUrl: megaeth.blockExplorers.default.url,
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(megaeth.id),
  },
  [worldchain.id]: {
    chainId: worldchain.id,
    blockExplorer: {
      baseUrl: worldchain.blockExplorers?.default.url || 'https://worldscan.org',
    },
    verification: {
      backend: VerificationBackend.EtherscanV2,
      apiUrl: ETHERSCAN_V2_API_URL,
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
    rpcUrl: configuredRpc(worldchain.id),
  },
  [zora.id]: {
    chainId: zora.id,
    blockExplorer: {
      baseUrl: zora.blockExplorers?.default.url || 'https://explorer.zora.energy',
    },
    verification: {
      backend: VerificationBackend.Blockscout,
      apiUrl: 'https://explorer.zora.energy/api/v2',
    },
    rpcUrl: configuredRpc(zora.id),
  },
  [xLayer.id]: {
    chainId: xLayer.id,
    blockExplorer: {
      baseUrl: xLayer.blockExplorers?.default.url || 'https://www.oklink.com/xlayer',
    },
    verification: {
      backend: VerificationBackend.SourcifyOnly,
      degradedReason: 'XLayer verification backend API is not supported yet; using Sourcify only.',
    },
    rpcUrl: configuredRpc(xLayer.id),
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`No configuration found for chain ID ${chainId}`);
  }
  return config;
}

export function formatVerificationBackend(backend: VerificationBackend): string {
  if (backend === VerificationBackend.EtherscanV2) return 'Etherscan v2 API';
  if (backend === VerificationBackend.Blockscout) return 'Blockscout API';
  if (backend === VerificationBackend.Tempo) return 'Tempo verifier API';
  return 'Sourcify-only (no verification API backend)';
}

export function getBlockExplorerBaseUrlForChain(chainId: number): string {
  try {
    return normalizeBlockExplorerBaseUrl(getChainConfig(chainId).blockExplorer.baseUrl);
  } catch {
    return DEFAULT_BLOCK_EXPLORER_BASE_URL;
  }
}

export interface ResolvedVerificationConfig {
  backend: VerificationBackend;
  apiUrl?: string;
  apiKey?: string;
  degradedReason?: string;
}

export function resolveVerificationConfig(config: ChainConfig): ResolvedVerificationConfig {
  if (config.verification) {
    return config.verification;
  }

  if (config.blockExplorer.source === BlockExplorerSource.Blockscout) {
    return {
      backend: VerificationBackend.Blockscout,
      apiUrl: config.blockExplorer.apiUrl,
      degradedReason: undefined,
    };
  }

  return {
    backend: VerificationBackend.EtherscanV2,
    apiKey: config.blockExplorer.apiKey,
    degradedReason: undefined,
  };
}

function rpcTransport(url: string, chainId: number): Transport {
  if (url || usesManagedAccess()) {
    const transport = url
      ? http(url)({})
      : custom({
          async request(args) {
            const response = await managedFetch('rpc', {
              chainId,
              method: args.method,
              params: args.params ?? [],
            });
            if (!response.ok) throw new Error(`Seatbelt RPC unavailable (HTTP ${response.status})`);
            const body = await response.json();
            if (body.error || !Object.hasOwn(body, 'result'))
              throw new Error('Managed RPC request failed');
            return body.result;
          },
        })({});
    return custom(
      {
        async request(args) {
          try {
            // QuickNode limits eth_getLogs to 10,000 blocks. Preserve the requested range.
            if (args.method === 'eth_getLogs') {
              const [filter] = args.params as [
                { fromBlock?: string; toBlock?: string; blockHash?: string },
              ];
              if (!filter.blockHash && filter.fromBlock?.startsWith('0x')) {
                const end =
                  filter.toBlock === 'latest' || !filter.toBlock
                    ? BigInt((await transport.request({ method: 'eth_blockNumber' })) as string)
                    : filter.toBlock.startsWith('0x')
                      ? BigInt(filter.toBlock)
                      : undefined;
                const start = BigInt(filter.fromBlock);
                if (end !== undefined && end - start >= 10000n) {
                  const logs: unknown[] = [];
                  for (let from = start; from <= end; from += 10000n) {
                    const to = from + 9999n < end ? from + 9999n : end;
                    logs.push(
                      ...((await transport.request({
                        ...args,
                        params: [
                          {
                            ...filter,
                            fromBlock: `0x${from.toString(16)}`,
                            toBlock: `0x${to.toString(16)}`,
                          },
                        ],
                      })) as unknown[]),
                    );
                  }
                  return logs;
                }
              }
            }
            return await transport.request(args);
          } catch {
            throw new Error(`RPC ${args.method} failed on chain ${chainId}`);
          }
        },
      },
      { retryCount: 0 },
    );
  }
  return custom(
    {
      async request() {
        throw new Error(`RPC endpoint is not configured for chain ${chainId}`);
      },
    },
    { retryCount: 0 },
  );
}

const clients = {
  [mainnet.id]: createPublicClient({
    chain: mainnet,
    transport: rpcTransport(CHAIN_CONFIGS[mainnet.id].rpcUrl, mainnet.id),
  }),
  [arbitrum.id]: createPublicClient({
    chain: arbitrum,
    transport: rpcTransport(CHAIN_CONFIGS[arbitrum.id].rpcUrl, arbitrum.id),
  }),
  [robinhood.id]: createPublicClient({
    chain: robinhood,
    transport: rpcTransport(CHAIN_CONFIGS[robinhood.id].rpcUrl, robinhood.id),
  }),
  [optimism.id]: createPublicClient({
    chain: optimism,
    transport: rpcTransport(CHAIN_CONFIGS[optimism.id].rpcUrl, optimism.id),
  }),
  [base.id]: createPublicClient({
    chain: base,
    transport: rpcTransport(CHAIN_CONFIGS[base.id].rpcUrl, base.id),
  }),
  [unichain.id]: createPublicClient({
    chain: unichain,
    transport: rpcTransport(CHAIN_CONFIGS[unichain.id].rpcUrl, unichain.id),
  }),
  [ink.id]: createPublicClient({
    chain: ink,
    transport: rpcTransport(CHAIN_CONFIGS[ink.id].rpcUrl, ink.id),
  }),
  [soneium.id]: createPublicClient({
    chain: soneium,
    transport: rpcTransport(CHAIN_CONFIGS[soneium.id].rpcUrl, soneium.id),
  }),
  [bob.id]: createPublicClient({
    chain: bob,
    transport: rpcTransport(CHAIN_CONFIGS[bob.id].rpcUrl, bob.id),
  }),
  [bsc.id]: createPublicClient({
    chain: bsc,
    transport: rpcTransport(CHAIN_CONFIGS[bsc.id].rpcUrl, bsc.id),
  }),
  [celo.id]: createPublicClient({
    chain: celo,
    transport: rpcTransport(CHAIN_CONFIGS[celo.id].rpcUrl, celo.id),
  }),
  [polygon.id]: createPublicClient({
    chain: polygon,
    transport: rpcTransport(CHAIN_CONFIGS[polygon.id].rpcUrl, polygon.id),
  }),
  [avalanche.id]: createPublicClient({
    chain: avalanche,
    transport: rpcTransport(CHAIN_CONFIGS[avalanche.id].rpcUrl, avalanche.id),
  }),
  [monad.id]: createPublicClient({
    chain: monad,
    transport: rpcTransport(CHAIN_CONFIGS[monad.id].rpcUrl, monad.id),
  }),
  [arc.id]: createPublicClient({
    chain: arc,
    transport: rpcTransport(CHAIN_CONFIGS[arc.id].rpcUrl, arc.id),
  }),
  [tempo.id]: createPublicClient({
    chain: tempo,
    transport: rpcTransport(CHAIN_CONFIGS[tempo.id].rpcUrl, tempo.id),
  }),
  [megaeth.id]: createPublicClient({
    chain: megaeth,
    transport: rpcTransport(CHAIN_CONFIGS[megaeth.id].rpcUrl, megaeth.id),
  }),
  [worldchain.id]: createPublicClient({
    chain: worldchain,
    transport: rpcTransport(CHAIN_CONFIGS[worldchain.id].rpcUrl, worldchain.id),
  }),
  [zora.id]: createPublicClient({
    chain: zora,
    transport: rpcTransport(CHAIN_CONFIGS[zora.id].rpcUrl, zora.id),
  }),
  [xLayer.id]: createPublicClient({
    chain: xLayer,
    transport: rpcTransport(CHAIN_CONFIGS[xLayer.id].rpcUrl, xLayer.id),
  }),
} satisfies ClientRegistry;

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return Object.prototype.hasOwnProperty.call(CHAIN_BY_ID, chainId);
}

export function getClientForChain<I extends SupportedChainId>(chainId: I): ClientRegistry[I];
export function getClientForChain(chainId: number): ClientRegistry[SupportedChainId];
export function getClientForChain(chainId: number) {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`No client found for chain ID ${chainId}`);
  }

  return clients[chainId];
}

export const publicClient = clients[mainnet.id];
