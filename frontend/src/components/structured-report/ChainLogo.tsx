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

// Chain logos stored in /public/chain-logos/
// Existing official assets:
// - Ethereum: https://github.com/0xa3k5/web3icons
// - Optimism: https://github.com/0xa3k5/web3icons
// - Base: https://github.com/base/brand-kit (The Square)
// - Arbitrum: https://github.com/0xa3k5/web3icons
// Additional official assets:
// - Unichain: https://www.unichain.org/brand-kit
// - Ink: https://docs.inkonchain.com/work-with-ink/brand-kit
// - BOB: https://www.gobob.xyz and https://docs.gobob.xyz
// - BNB Chain: https://www.bnbchain.org/en/brand-guidelines
// - Polygon: https://polygon.technology
// - Avalanche: https://www.avax.network
// - Monad: https://www.monad.xyz and https://docs.monad.xyz/developer-essentials/network-information
// - Tempo: https://tempo.xyz
// - MegaETH: https://www.megaeth.com
// - Celo: https://celo.org/brand-kit
// - X Layer: https://static.oklink.com
// - World: https://world.org/brand#world-logo
// - Soneium: https://soneium.org/en/brand-kit/
// - Zora: provided by team brand asset

export function ChainLogo({ chainId, size = 20 }: { chainId: number; size?: number }) {
  const logoFiles: Partial<Record<number, string>> = {
    [mainnet.id]: '/chain-logos/ethereum.svg',
    [optimism.id]: '/chain-logos/optimism.svg',
    [xLayer.id]: '/chain-logos/xlayer.webp',
    [soneium.id]: '/chain-logos/soneium.webp',
    [celo.id]: '/chain-logos/celo.png',
    [worldchain.id]: '/chain-logos/worldchain.svg',
    [zora.id]: '/chain-logos/zora.svg',
    [base.id]: '/chain-logos/base.svg',
    [arbitrum.id]: '/chain-logos/arbitrum.svg',
    [unichain.id]: '/chain-logos/unichain.svg',
    [ink.id]: '/chain-logos/ink.png',
    [bob.id]: '/chain-logos/bob.svg',
    [bsc.id]: '/chain-logos/bsc.svg',
    [polygon.id]: '/chain-logos/polygon.png',
    [avalanche.id]: '/chain-logos/avalanche.svg',
    [monad.id]: '/chain-logos/monad.svg',
    [tempo.id]: '/chain-logos/tempo.svg',
    [MEGAETH_CHAIN_ID]: '/chain-logos/megaeth.svg',
  };

  const logoPath = logoFiles[chainId];

  if (!logoPath) {
    return (
      <div
        className="rounded-full bg-muted flex items-center justify-center text-muted-foreground"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        ⛓
      </div>
    );
  }

  return (
    <img
      src={logoPath}
      alt={`Chain ${chainId} logo`}
      width={size}
      height={size}
      className="shrink-0 object-contain"
    />
  );
}
