'use client';

import { ProposalActionIcon } from '@/components/ProposalActionIcon';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Proposal } from '@/hooks/use-simulation-results';
import { getProposalCardUi } from '@/lib/proposal-action-ui';
import type { ProposalActionResolution } from '@/lib/write-actions';
import { useState } from 'react';

interface ProposalCardProps {
  proposal: Proposal;
  action: ProposalActionResolution;
  onAction: () => void;
  isPending: boolean;
  isPendingConfirmation: boolean;
  isConnected: boolean;
  className?: string;
}

export function ProposalCard({
  proposal,
  action,
  onAction,
  isPending,
  isPendingConfirmation,
  isConnected,
  className,
}: ProposalCardProps) {
  const [selectedCallIndex, setSelectedCallIndex] = useState(0);
  const hasMultipleCalls = proposal.targets.length > 1;
  const currentTarget = hasMultipleCalls
    ? proposal.targets[selectedCallIndex]
    : proposal.targets[0];
  const currentValue = hasMultipleCalls
    ? proposal.values[selectedCallIndex].toString()
    : proposal.values[0].toString();
  const currentSignature = hasMultipleCalls
    ? proposal.signatures[selectedCallIndex]
    : proposal.signatures[0];
  const currentCalldata = hasMultipleCalls
    ? proposal.calldatas[selectedCallIndex]
    : proposal.calldatas[0];
  const card = getProposalCardUi(action, {
    isConnected,
    isPending,
    isPendingConfirmation,
  });

  return (
    <Card className={`w-full ${className || ''} border border-muted`}>
      <CardHeader className="px-6">
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 px-6">
        {hasMultipleCalls && (
          <div className="mb-4">
            <h3 className="font-medium text-sm mb-2">Select Call</h3>
            <div className="flex flex-wrap gap-2">
              {proposal.targets.map((_: string, index: number) => (
                <Button
                  key={`call-target-${proposal.targets[index]}-${index}`}
                  variant={selectedCallIndex === index ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCallIndex(index)}
                  className="cursor-pointer"
                >
                  Call {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <p className="font-medium break-all">{currentSignature || 'Contract call'}</p>
          <p className="text-muted-foreground">
            Target: <code className="break-all">{currentTarget}</code>
          </p>
        </div>
        <details key={selectedCallIndex} className="border-t pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Technical details</summary>
          <dl className="mt-4 space-y-3">
            <div>
              <dt className="text-muted-foreground">Value (wei)</dt>
              <dd className="font-mono break-all">{currentValue}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Calldata</dt>
              <dd className="font-mono break-all">{currentCalldata}</dd>
            </div>
          </dl>
        </details>

        {hasMultipleCalls && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing call {selectedCallIndex + 1} of {proposal.targets.length}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between items-center border-t py-4 px-6 mt-auto">
        <div className="flex items-center text-sm text-muted-foreground">
          <ProposalActionIcon iconName={card.statusIconName} className={card.statusIconClassName} />
          {card.readyText}
        </div>
        {card.showButton && (
          <Button
            onClick={onAction}
            disabled={card.isButtonDisabled}
            size="lg"
            className="ml-6 px-6 font-medium cursor-pointer gap-2"
          >
            {card.buttonIconName && (
              <ProposalActionIcon iconName={card.buttonIconName} className="h-4 w-4" />
            )}
            {card.buttonLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
