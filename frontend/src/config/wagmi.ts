import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient } from '@tanstack/react-query';
import { http } from 'viem';
import { createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const isProduction = process.env.NODE_ENV === 'production';

const mainnetRpcUrl =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ??
  (isProduction ? undefined : 'https://eth.llamarpc.com');
if (!mainnetRpcUrl) throw new Error('Mainnet RPC URL is not defined');

export const queryClient = new QueryClient();

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
export const walletConnectEnabled = Boolean(projectId && projectId !== 'demo');

export const config = walletConnectEnabled
  ? getDefaultConfig({
      appName: 'Governance Seatbelt',
      projectId: projectId as string,
      chains: [mainnet],
      transports: {
        [mainnet.id]: http(mainnetRpcUrl),
      },
      ssr: true,
    })
  : createConfig({
      chains: [mainnet],
      transports: {
        [mainnet.id]: http(mainnetRpcUrl),
      },
      connectors: [injected()],
      ssr: true,
    });
