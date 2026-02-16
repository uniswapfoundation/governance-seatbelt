'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useHrefWithArtifact } from '@/hooks/use-artifact-navigation';
import type { Proposal } from '@/hooks/use-simulation-results';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayIcon,
  SendIcon,
  XCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import type { SimulationType } from './ProposalCard';

interface ProposalSummaryProps {
  proposal: Proposal;
  simulationType: SimulationType;
  proposalState?: string;
  className?: string;
}

/**
 * Maps on-chain proposal states to display configuration
 */
function getStateConfig(proposalState: string | undefined, simulationType: SimulationType) {
  // For new simulations, always show "Review & Propose"
  if (simulationType === 'new') {
    return {
      title: 'Proposal Ready',
      buttonText: 'Review & Propose',
      showButton: true,
      icon: <SendIcon className="h-5 w-5 text-primary" />,
      borderStyle: 'border-primary/20 bg-primary/5',
    };
  }

  // For executed simulations, always show "View Details"
  if (simulationType === 'executed') {
    return {
      title: 'Already Executed',
      buttonText: 'View Details',
      showButton: true,
      icon: <CheckCircleIcon className="h-5 w-5 text-green-500" />,
      borderStyle: 'border-green-500/20 bg-green-500/5',
    };
  }

  // For proposed simulations, gate based on proposalState
  switch (proposalState) {
    case 'Queued':
      return {
        title: 'Ready to Execute',
        buttonText: 'Review & Execute',
        showButton: true,
        icon: <PlayIcon className="h-5 w-5 text-primary" />,
        borderStyle: 'border-orange-500/20 bg-orange-500/5',
      };
    case 'Defeated':
      return {
        title: 'Proposal Defeated',
        buttonText: null,
        showButton: false,
        icon: <XCircleIcon className="h-5 w-5 text-red-500" />,
        borderStyle: 'border-red-500/20 bg-red-500/5',
      };
    case 'Expired':
      return {
        title: 'Proposal Expired',
        buttonText: null,
        showButton: false,
        icon: <XCircleIcon className="h-5 w-5 text-gray-500" />,
        borderStyle: 'border-gray-500/20 bg-gray-500/5',
      };
    case 'Canceled':
      return {
        title: 'Proposal Canceled',
        buttonText: null,
        showButton: false,
        icon: <XCircleIcon className="h-5 w-5 text-gray-500" />,
        borderStyle: 'border-gray-500/20 bg-gray-500/5',
      };
    case 'Active':
      return {
        title: 'Voting In Progress',
        buttonText: null,
        showButton: false,
        icon: <ClockIcon className="h-5 w-5 text-blue-500" />,
        borderStyle: 'border-blue-500/20 bg-blue-500/5',
      };
    case 'Succeeded':
      return {
        title: 'Awaiting Queue',
        buttonText: null,
        showButton: false,
        icon: <ClockIcon className="h-5 w-5 text-yellow-500" />,
        borderStyle: 'border-yellow-500/20 bg-yellow-500/5',
      };
    case 'Pending':
      return {
        title: 'Pending',
        buttonText: null,
        showButton: false,
        icon: <ClockIcon className="h-5 w-5 text-gray-500" />,
        borderStyle: 'border-gray-500/20 bg-gray-500/5',
      };
    default:
      // Fall back to current behavior when proposalState is not present
      return {
        title: 'Ready to Execute',
        buttonText: 'Review & Execute',
        showButton: true,
        icon: <PlayIcon className="h-5 w-5 text-primary" />,
        borderStyle: 'border-orange-500/20 bg-orange-500/5',
      };
  }
}

export function ProposalSummary({
  proposal,
  simulationType,
  proposalState,
  className,
}: ProposalSummaryProps) {
  const { isConnected } = useAccount();
  const actionHref = useHrefWithArtifact('/action');
  const callCount = proposal.targets.length;

  const config = getStateConfig(proposalState, simulationType);

  const getDescription = () => {
    const callText = `${callCount} contract call${callCount > 1 ? 's' : ''}`;

    if (simulationType === 'executed') {
      return `${callText} • View execution details`;
    }

    if (!config.showButton) {
      return `${callText} • ${config.title}`;
    }

    const walletText = isConnected ? 'Wallet connected' : 'Connect wallet to continue';
    return `${callText} • ${walletText}`;
  };

  return (
    <Card className={`${className || ''} border-dashed border-2 ${config.borderStyle}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-full bg-background shrink-0">{config.icon}</div>
            <div className="min-w-0">
              <p className="font-medium text-sm">{config.title}</p>
              <p className="text-xs text-muted-foreground truncate">{getDescription()}</p>
            </div>
          </div>
          {config.showButton && config.buttonText && (
            <Button asChild size="sm" className="gap-2 w-full sm:w-auto shrink-0">
              <Link href={actionHref}>
                {config.buttonText}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
