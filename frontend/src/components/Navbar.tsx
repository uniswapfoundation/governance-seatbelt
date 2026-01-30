'use client';

import { Button } from '@/components/ui/button';
import { useSimulationResults } from '@/hooks/use-simulation-results';
import { parseSimulationType } from '@/lib/write-actions';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CheckCircleIcon, FileTextIcon, PlayIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { SimulationType } from './ProposalCard';

function NavbarConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        if (!connected) {
          return (
            <Button type="button" size="sm" className="cursor-pointer" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          );
        }

        if (chain.unsupported) {
          return (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="cursor-pointer"
              onClick={openChainModal}
            >
              Wrong network
            </Button>
          );
        }

        return (
          <div className="flex items-center gap-2" aria-label="Wallet">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={openChainModal}
              aria-label={`Network: ${chain.name}`}
            >
              {chain.name}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={openAccountModal}
            >
              <span
                className="inline-block size-2 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              {account.displayName}
              {account.displayBalance ? ` (${account.displayBalance})` : ''}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const { data: simulationData } = useSimulationResults();

  const rawSimulationType = simulationData?.report.structuredReport?.metadata?.simulationType;
  const simulationType: SimulationType =
    rawSimulationType == null ? 'new' : (parseSimulationType(rawSimulationType) ?? 'new');

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
            <NavbarConnect />
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
