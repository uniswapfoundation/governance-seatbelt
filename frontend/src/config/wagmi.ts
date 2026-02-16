import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient } from '@tanstack/react-query';
import { http, type Chain } from 'viem';
import { createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const isProduction = process.env.NODE_ENV === 'production';

const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID
  ? Number(process.env.NEXT_PUBLIC_CHAIN_ID)
  : null;

const mainnetRpcUrl =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? 'https://eth.llamarpc.com';

const getChain = (): { chain: Chain; rpcUrl: string } => {
  if (overrideChainId && overrideChainId !== mainnet.id) {
    if (!overrideRpcUrl) {
      throw new Error('NEXT_PUBLIC_RPC_URL is required when NEXT_PUBLIC_CHAIN_ID is set');
    }

    const localChain: Chain = {
      id: overrideChainId,
      name: 'Local',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [overrideRpcUrl] },
        public: { http: [overrideRpcUrl] },
      },
      blockExplorers: {
        default: { name: 'Explorer', url: overrideRpcUrl },
      },
      testnet: true,
    };

    return { chain: localChain, rpcUrl: overrideRpcUrl };
  }

  const rpcUrl = overrideRpcUrl ?? mainnetRpcUrl;
  if (!rpcUrl) throw new Error('Mainnet RPC URL is not defined');
  return { chain: mainnet, rpcUrl };
};

const { chain, rpcUrl } = getChain();

export const queryClient = new QueryClient();

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
export const walletConnectEnabled = Boolean(projectId && projectId !== 'demo');

export const config = walletConnectEnabled
  ? getDefaultConfig({
      appName: 'Governance Seatbelt',
      projectId: projectId as string,
      chains: [chain],
      transports: {
        [chain.id]: http(rpcUrl),
      },
      ssr: true,
    })
  : createConfig({
      chains: [chain],
      transports: {
        [chain.id]: http(rpcUrl),
      },
      connectors: [injected()],
      ssr: true,
    });
