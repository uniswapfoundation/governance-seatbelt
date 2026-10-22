export const RPC_ENV_BY_CHAIN: Record<number, string> = {
  1: 'QUICKNODE_RPC_URL',
  42161: 'ARBITRUM_RPC_URL',
  4663: 'ROBINHOOD_RPC_URL',
  10: 'OPTIMISM_RPC_URL',
  8453: 'BASE_RPC_URL',
  130: 'UNICHAIN_RPC_URL',
  57073: 'INK_RPC_URL',
  1868: 'SONEIUM_RPC_URL',
  60808: 'BOB_RPC_URL',
  56: 'BSC_RPC_URL',
  42220: 'CELO_RPC_URL',
  137: 'POLYGON_RPC_URL',
  43114: 'AVALANCHE_RPC_URL',
  143: 'MONAD_RPC_URL',
  4217: 'TEMPO_RPC_URL',
  4326: 'MEGAETH_RPC_URL',
  480: 'WORLDCHAIN_RPC_URL',
  7777777: 'ZORA_RPC_URL',
  196: 'XLAYER_RPC_URL',
  5042: 'ARC_RPC_URL',
};

export function configuredRpc(chainId: number, env = process.env): string {
  return env[RPC_ENV_BY_CHAIN[chainId]]?.trim() ?? '';
}
