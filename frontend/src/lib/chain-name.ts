import {
  arbitrum,
  avalanche,
  base,
  bob,
  bsc,
  celo,
  ink,
  mainnet,
  monad,
  optimism,
  polygon,
  soneium,
  tempo,
  unichain,
  worldchain,
  xLayer,
  zora,
} from 'viem/chains';

const MEGAETH_CHAIN_ID = 4326;
const MEGAETH_CHAIN_NAME = 'MegaETH';

const CANONICAL_CHAIN_NAMES: Record<number, string> = {
  [mainnet.id]: mainnet.name,
  [optimism.id]: optimism.name,
  [base.id]: base.name,
  [arbitrum.id]: arbitrum.name,
  [unichain.id]: unichain.name,
  [ink.id]: ink.name,
  [soneium.id]: soneium.name,
  [bob.id]: bob.name,
  [bsc.id]: bsc.name,
  [celo.id]: celo.name,
  [polygon.id]: polygon.name,
  [avalanche.id]: avalanche.name,
  [monad.id]: monad.name,
  [tempo.id]: tempo.name,
  [MEGAETH_CHAIN_ID]: MEGAETH_CHAIN_NAME,
  [worldchain.id]: worldchain.name,
  [xLayer.id]: xLayer.name,
  [zora.id]: zora.name,
};

const GENERIC_CHAIN_NAME = /^Chain\s+\d+$/i;

function getCanonicalChainName(chainId: number): string {
  return CANONICAL_CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

export function resolveChainName(chainId: number, providedName?: string): string {
  const cleanedProvidedName = providedName?.trim();
  if (cleanedProvidedName && !GENERIC_CHAIN_NAME.test(cleanedProvidedName)) {
    return cleanedProvidedName;
  }

  return getCanonicalChainName(chainId);
}
