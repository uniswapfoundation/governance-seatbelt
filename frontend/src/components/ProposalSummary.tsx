'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Proposal } from '@/hooks/use-simulation-results';
import { ArrowRightIcon, CheckCircleIcon, PlayIcon, SendIcon } from 'lucide-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import type { SimulationType } from './ProposalCard';

interface ProposalSummaryProps {
  proposal: Proposal;
  simulationType: SimulationType;
  className?: string;
}

export function ProposalSummary({ proposal, simulationType, className }: ProposalSummaryProps) {
  const { isConnected } = useAccount();
  const callCount = proposal.targets.length;

  const getTitle = () => {
    switch (simulationType) {
      case 'new':
        return 'Proposal Ready';
      case 'proposed':
        return 'Ready to Execute';
      case 'executed':
        return 'Already Executed';
    }
  };

  const getDescription = () => {
    const callText = `${callCount} contract call${callCount > 1 ? 's' : ''}`;
    const walletText = isConnected ? 'Wallet connected' : 'Connect wallet to continue';

    switch (simulationType) {
      case 'new':
        return `${callText} • ${walletText}`;
      case 'proposed':
        return `${callText} • ${walletText}`;
      case 'executed':
        return `${callText} • View execution details`;
    }
  };

  const getButtonText = () => {
    switch (simulationType) {
      case 'new':
        return 'Review & Propose';
      case 'proposed':
        return 'Review & Execute';
      case 'executed':
        return 'View Details';
    }
  };

  const getIcon = () => {
    switch (simulationType) {
      case 'new':
        return <SendIcon className="h-5 w-5 text-primary" />;
      case 'proposed':
        return <PlayIcon className="h-5 w-5 text-primary" />;
      case 'executed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    }
  };

  const getBorderStyle = () => {
    switch (simulationType) {
      case 'new':
        return 'border-primary/20 bg-primary/5';
      case 'proposed':
        return 'border-orange-500/20 bg-orange-500/5';
      case 'executed':
        return 'border-green-500/20 bg-green-500/5';
    }
  };

  return (
    <Card className={`${className || ''} border-dashed border-2 ${getBorderStyle()}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-full bg-background shrink-0">{getIcon()}</div>
            <div className="min-w-0">
              <p className="font-medium text-sm">{getTitle()}</p>
              <p className="text-xs text-muted-foreground truncate">{getDescription()}</p>
            </div>
          </div>
          <Button asChild size="sm" className="gap-2 w-full sm:w-auto shrink-0">
            <Link href="/action">
              {getButtonText()}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
