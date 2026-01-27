'use client';

import { Button } from '@/components/ui/button';
import { walletConnectEnabled } from '@/config';
import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

const RainbowKitConnectButton = dynamic(
  () => import('@rainbow-me/rainbowkit').then((mod) => mod.ConnectButton),
  { ssr: false },
);

export function Navbar() {
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const connectInjected = useCallback(() => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (!injected) return;
    connect({ connector: injected });
  }, [connect, connectors]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center">
            <h1 className="text-xl font-semibold">Seatbelt</h1>
          </div>
          <div className="flex items-center">
            {walletConnectEnabled ? (
              <RainbowKitConnectButton />
            ) : isConnected ? (
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground font-mono">
                  {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connected'}
                </div>
                <Button variant="outline" size="sm" onClick={() => disconnect()}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={connectInjected}
                disabled={isPending || connectors.length === 0}
              >
                {connectors.length === 0
                  ? 'No wallet'
                  : isPending
                    ? 'Connecting…'
                    : 'Connect Wallet'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
