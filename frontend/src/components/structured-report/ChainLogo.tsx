// Official logos stored in /public/chain-logos/
// Sources:
// - Ethereum: https://github.com/0xa3k5/web3icons
// - Optimism: https://github.com/0xa3k5/web3icons
// - Base: https://github.com/base/brand-kit (The Square)
// - Arbitrum: https://github.com/0xa3k5/web3icons

export function ChainLogo({ chainId, size = 20 }: { chainId: number; size?: number }) {
  const logoFiles: Record<number, string> = {
    1: '/chain-logos/ethereum.svg',
    10: '/chain-logos/optimism.svg',
    8453: '/chain-logos/base.svg',
    42161: '/chain-logos/arbitrum.svg',
  };

  const logoPath = logoFiles[chainId];

  if (!logoPath) {
    return (
      <div
        className="rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {chainId}
      </div>
    );
  }

  return (
    <img
      src={logoPath}
      alt={`Chain ${chainId} logo`}
      width={size}
      height={size}
      className="shrink-0"
    />
  );
}
