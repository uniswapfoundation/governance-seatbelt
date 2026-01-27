'use client';

import { Button } from '@/components/ui/button';
import { walletConnectEnabled } from '@/config';
import { useSimulationResults } from '@/hooks/use-simulation-results';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CheckCircleIcon, FileTextIcon, PlayIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import type { SimulationType } from './ProposalCard';

export function Navbar() {
  const pathname = usePathname();
  const { data: simulationData } = useSimulationResults();

  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const connectInjected = useCallback(() => {
    const injected = connectors.find((c) => c.id === 'injected') ?? connectors[0];
    if (!injected) return;
    connect({ connector: injected });
  }, [connect, connectors]);

  const simulationType: SimulationType =
    simulationData?.report.structuredReport?.metadata.simulationType || 'new';

  const getActionLabel = () => {
    switch (simulationType) {
      case 'new':
        return 'Propose';
      case 'proposed':
        return 'Execute';
      case 'executed':
        return 'Details';
    }
  };

  const getActionIcon = () => {
    switch (simulationType) {
      case 'new':
        return <SendIcon className="h-4 w-4" />;
      case 'proposed':
        return <PlayIcon className="h-4 w-4" />;
      case 'executed':
        return <CheckCircleIcon className="h-4 w-4" />;
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">Seatbelt</h1>
            </Link>

            <div className="hidden md:flex items-center gap-1">
              <NavLink href="/" active={pathname === '/'}>
                <FileTextIcon className="h-4 w-4" />
                Report
              </NavLink>
              <NavLink href="/action" active={pathname === '/action'}>
                {getActionIcon()}
                {getActionLabel()}
              </NavLink>
            </div>
          </div>

          <div className="flex items-center">
            {walletConnectEnabled ? (
              <ConnectButton />
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

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </Link>
  );
}
