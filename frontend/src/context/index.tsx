'use client';

import { wagmiConfig as config, queryClient, walletConnectEnabled } from '@/config';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import '@rainbow-me/rainbowkit/styles.css';

export default function ContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {walletConnectEnabled ? <RainbowKitProvider>{children}</RainbowKitProvider> : children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
