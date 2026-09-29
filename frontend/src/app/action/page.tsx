'use client';

import { ProposalActionIcon } from '@/components/ProposalActionIcon';
import { ProposalCard } from '@/components/ProposalCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { DEFAULT_GOVERNOR_ADDRESS, wagmiConfig } from '@/config';
import { useHrefWithArtifact } from '@/hooks/use-artifact-navigation';
import { useSimulationResults } from '@/hooks/use-simulation-results';
import { useWriteExecuteProposal } from '@/hooks/use-write-execute-proposal';
import { useWriteProposeNew } from '@/hooks/use-write-propose-new';
import { getProposalActionUi } from '@/lib/proposal-action-ui';
import {
  formatAuthenticityBadgeLabel,
  formatAuthenticityDetails,
  getCanonicalPublishedFileUrl,
  getVisibleTrustState,
} from '@/lib/report-provenance';
import { resolveProposalAction } from '@/lib/write-actions';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CopyIcon,
  InfoIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

function ErrorFallback({ error }: { error: Error }) {
  return (
    <Alert variant="destructive" className="w-full">
      <AlertTriangleIcon className="h-4 w-4" />
      <AlertTitle>Error Loading Proposal Data</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

export default function ActionPage() {
  const { isConnected } = useAccount();

  return (
    <Suspense>
      <ActionPageContent isConnected={isConnected} />
    </Suspense>
  );
}

function ActionPageContent({ isConnected }: { isConnected: boolean }) {
  const reportHref = useHrefWithArtifact('/');

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-5xl xl:max-w-6xl space-y-6">
        <Button variant="ghost" size="sm" asChild className="gap-2">
          <Link href={reportHref}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Report
          </Link>
        </Button>

        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ActionSection isConnected={isConnected} />
        </ErrorBoundary>

        <Toaster position="bottom-right" closeButton />
      </div>
    </div>
  );
}

function ActionSection({ isConnected }: { isConnected: boolean }) {
  const reportHref = useHrefWithArtifact('/');
  const { data: simulationData, error: simulationError } = useSimulationResults();
  const {
    mutate: proposeNew,
    isPending: isProposePending,
    isPendingConfirmation: isProposeConfirming,
  } = useWriteProposeNew();
  const {
    mutate: executeProposal,
    isPending: isExecutePending,
    isPendingConfirmation: isExecuteConfirming,
  } = useWriteExecuteProposal();

  if (simulationError) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{simulationError.message}</AlertDescription>
      </Alert>
    );
  }

  if (!simulationData) {
    return (
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>No Proposal Data</AlertTitle>
        <AlertDescription>Run a simulation first to generate proposal data.</AlertDescription>
      </Alert>
    );
  }

  const { proposalData, report } = simulationData;
  const rawSimulationType = report.structuredReport?.metadata?.simulationType;
  const proposalState = report.structuredReport?.metadata?.proposalState;
  const actionResolution = resolveProposalAction(rawSimulationType, proposalState);

  if (rawSimulationType != null && actionResolution.kind === 'invalid') {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon className="h-4 w-4" />
        <AlertTitle>Invalid Report Metadata</AlertTitle>
        <AlertDescription>
          The report has an unexpected <code>simulationType</code>. Re-run the simulation to
          regenerate results.
        </AlertDescription>
      </Alert>
    );
  }

  const handleAction = () => {
    if (actionResolution.kind === 'propose') {
      proposeNew();
    } else if (actionResolution.kind === 'execute') {
      executeProposal();
    }
  };

  const isPending =
    actionResolution.kind === 'propose'
      ? isProposePending
      : actionResolution.kind === 'execute'
        ? isExecutePending
        : false;
  const isPendingConfirmation =
    actionResolution.kind === 'propose'
      ? isProposeConfirming
      : actionResolution.kind === 'execute'
        ? isExecuteConfirming
        : false;

  const checks = report.structuredReport?.checks ?? [];
  const trust = report.structuredReport?.metadata?.trust;
  const publish = report.structuredReport?.metadata?.publish;
  const passedChecks = checks.filter((c) => c.status === 'passed');
  const failedChecks = checks.filter((c) => c.status === 'failed');
  const warningChecks = checks.filter((c) => c.status === 'warning');
  const skippedChecks = checks.filter((c) => c.status === 'skipped');
  const pageCopy = getProposalActionUi(actionResolution).page;
  const visibleTrust = getVisibleTrustState(trust);
  const artifactUrl = getCanonicalPublishedFileUrl(publish, 'artifact');
  const metadataUrl = getCanonicalPublishedFileUrl(publish, 'metadata');
  const authenticityBadgeLabel = formatAuthenticityBadgeLabel(publish?.authenticity);
  const authenticityDetails = formatAuthenticityDetails(publish?.authenticity);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${pageCopy.iconContainerClassName}`}>
            <ProposalActionIcon iconName={pageCopy.iconName} className={pageCopy.iconClassName} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{pageCopy.title}</h1>
        </div>
        <p className="text-muted-foreground">{pageCopy.description}</p>
      </div>

      {(trust || publish) && (
        <Alert
          variant={
            trust?.level === 'blocked' || publish?.authenticity?.status === 'invalid'
              ? 'destructive'
              : 'default'
          }
        >
          <AlertTriangleIcon className="h-4 w-4" />
          <AlertTitle>
            {visibleTrust?.level === 'blocked'
              ? 'Blocking report concerns'
              : visibleTrust
                ? 'Report trust notes'
                : 'Report provenance'}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            {visibleTrust?.reasons.length ? (
              <p>{visibleTrust.reasons.join(' ')}</p>
            ) : authenticityDetails ? (
              <p>{authenticityDetails}</p>
            ) : null}
            <div className="flex flex-wrap gap-3 text-xs">
              {publish?.publishId && (
                <span className="font-mono">publish {publish.publishId.slice(0, 8)}…</span>
              )}
              {publish?.publishedAt && (
                <span>published {new Date(publish.publishedAt).toLocaleString()}</span>
              )}
              {authenticityBadgeLabel && <span>{authenticityBadgeLabel}</span>}
              {artifactUrl && (
                <a
                  href={artifactUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  artifact
                </a>
              )}
              {metadataUrl && (
                <a
                  href={metadataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  metadata
                </a>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {(actionResolution.kind === 'propose' || actionResolution.kind === 'execute') && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Before you sign</h2>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Compare these details with your wallet. Your transaction goes to the governor; the
                  proposal’s calls are listed below.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">Network</dt>
                  <dd>
                    {wagmiConfig.chains[0].name} (chain ID {wagmiConfig.chains[0].id})
                  </dd>
                  <dt className="text-muted-foreground">To (governor)</dt>
                  <dd className="flex items-center gap-2 min-w-0">
                    <code className="break-all select-all">{DEFAULT_GOVERNOR_ADDRESS}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label="Copy governor address"
                      title="Copy governor address"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(DEFAULT_GOVERNOR_ADDRESS);
                          toast.success('Governor address copied');
                        } catch {
                          toast.error('Could not copy. Select the address to copy it.');
                        }
                      }}
                    >
                      <CopyIcon aria-hidden="true" className="size-4" />
                    </Button>
                  </dd>
                  <dt className="text-muted-foreground">Action</dt>
                  <dd>
                    {actionResolution.kind === 'propose' ? (
                      <>
                        Create proposal (<code>propose</code>)
                      </>
                    ) : (
                      <>
                        Execute proposal{' '}
                        <code>
                          {report.structuredReport?.metadata?.proposalId ?? 'ID unavailable'}
                        </code>{' '}
                        (<code>execute</code>)
                      </>
                    )}
                  </dd>
                </dl>
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  Review the report too. These details do not verify the Ledger signing hash or
                  prove that the proposal is safe.
                </p>
              </CardContent>
            </Card>
          )}
          <ProposalCard
            proposal={proposalData}
            action={actionResolution}
            onAction={handleAction}
            isPending={isPending}
            isPendingConfirmation={isPendingConfirmation}
            isConnected={isConnected}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheckIcon className="h-4 w-4" />
                Safety Checks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Checks</span>
                <span className="font-medium">{checks.length}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Passed</span>
                <span className="font-medium text-green-600">{passedChecks.length}</span>
              </div>
              {warningChecks.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Warnings</span>
                  <span className="font-medium text-yellow-600">{warningChecks.length}</span>
                </div>
              )}
              {failedChecks.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Failed</span>
                  <span className="font-medium text-red-600">{failedChecks.length}</span>
                </div>
              )}
              {skippedChecks.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Skipped</span>
                  <span className="font-medium text-gray-500">{skippedChecks.length}</span>
                </div>
              )}
              <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                <Link href={reportHref}>View Full Report</Link>
              </Button>
            </CardContent>
          </Card>

          {(failedChecks.length > 0 || warningChecks.length > 0) && (
            <Alert variant={failedChecks.length > 0 ? 'destructive' : 'default'}>
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>
                {failedChecks.length > 0 ? 'Review Required' : 'Warnings Present'}
              </AlertTitle>
              <AlertDescription>
                {failedChecks.length > 0
                  ? `${failedChecks.length} check(s) failed. Review before proceeding.`
                  : `${warningChecks.length} warning(s) detected. Review recommended.`}
              </AlertDescription>
            </Alert>
          )}

          {proposalData.description && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-6">
                  {proposalData.description}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
