'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  SimulationCheck,
  SimulationStateChange,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  HelpCircleIcon,
  InfoIcon,
  SkipForwardIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  TreasuryMovementCheck,
  isTreasuryMovementCheckDataV1,
  parseTreasuryMovementDetails,
  treasuryMovementDataToViewModel,
} from '../TreasuryMovementCheck';
import { ContractVerificationList } from './ContractVerificationList';
import { FormattedCheckDetails } from './FormattedCheckDetails';
import { ProxyResolutionDetails } from './ProxyResolutionDetails';
import { StateChanges } from './StateChanges';

export function ExpandableCheckItem({
  check,
  stateChanges,
  metadata,
}: {
  check: SimulationCheck;
  stateChanges?: SimulationStateChange[];
  metadata?: StructuredSimulationReport['metadata'];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (check.status) {
      case 'warning':
        return <AlertTriangleIcon className="h-5 w-5 text-yellow-500" />;
      case 'failed':
        return <AlertTriangleIcon className="h-5 w-5 text-red-500" />;
      case 'skipped':
        return <SkipForwardIcon className="h-5 w-5 text-gray-400" />;
      case 'inconclusive':
        return <HelpCircleIcon className="h-5 w-5 text-gray-500" />;
      case 'passed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      default: {
        const _exhaustive: never = check.status;
        throw new Error(`Unhandled check status: ${_exhaustive}`);
      }
    }
  };

  const getStatusBadge = () => {
    switch (check.status) {
      case 'warning': {
        const hasWarningMessages = check.warnings && check.warnings.length > 0;
        const warningBadge = (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            Warning
          </Badge>
        );

        if (!hasWarningMessages) return warningBadge;

        return (
          <Tooltip>
            <TooltipTrigger asChild>{warningBadge}</TooltipTrigger>
            <TooltipContent
              side="left"
              className="max-w-xs bg-yellow-50 text-yellow-900 border-yellow-200"
            >
              <ul className="list-disc list-inside space-y-1 text-xs">
                {check.warnings!.map((warning, idx) => (
                  <li key={`tooltip-warning-${idx}`}>{warning}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      }
      case 'failed': {
        const hasErrorMessages = check.errors && check.errors.length > 0;
        const failedBadge = <Badge variant="destructive">Failed</Badge>;

        if (!hasErrorMessages) return failedBadge;

        return (
          <Tooltip>
            <TooltipTrigger asChild>{failedBadge}</TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs bg-red-50 text-red-900 border-red-200">
              <ul className="list-disc list-inside space-y-1 text-xs">
                {check.errors!.map((error, idx) => (
                  <li key={`tooltip-error-${idx}`}>{error}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      }
      case 'skipped':
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">
            Skipped
          </Badge>
        );
      case 'inconclusive':
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-300">
            Inconclusive
          </Badge>
        );
      case 'passed':
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
            Passed
          </Badge>
        );
      default: {
        const _exhaustive: never = check.status;
        throw new Error(`Unhandled check status: ${_exhaustive}`);
      }
    }
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const title = check.title.toLowerCase();
  const isStateChangesCheck = title.includes('state changes');
  const isVerificationCheck =
    title.includes('verified on sourcify') || title.includes('verified on block explorer');
  const isProxyResolutionCheck = title.includes('proxy implementation');
  const isTreasuryMovementCheck = title.includes('treasury movement');

  const treasuryData = useMemo(() => {
    if (!isTreasuryMovementCheck) return null;

    const warnings = check.warnings ?? [];

    if (isTreasuryMovementCheckDataV1(check.data)) {
      return treasuryMovementDataToViewModel(check.data, warnings);
    }

    if (!check.details) return null;
    return parseTreasuryMovementDetails(check.details);
  }, [isTreasuryMovementCheck, check.data, check.details, check.warnings]);

  const getStatusStyles = () => {
    switch (check.status) {
      case 'failed':
        return {
          border: 'border-l-4 border-l-red-500 border-t border-r border-b border-red-200',
          bg: 'bg-red-50/50',
          hoverBg: 'hover:bg-red-50',
        };
      case 'warning':
        return {
          border: 'border-l-4 border-l-yellow-500 border-t border-r border-b border-yellow-200',
          bg: 'bg-yellow-50/50',
          hoverBg: 'hover:bg-yellow-50',
        };
      case 'skipped':
        return {
          border: 'border-l-4 border-l-gray-300 border-t border-r border-b border-gray-200',
          bg: 'bg-gray-50/30',
          hoverBg: 'hover:bg-gray-50',
        };
      case 'inconclusive':
        return {
          border: 'border-l-4 border-l-slate-400 border-t border-r border-b border-slate-200',
          bg: 'bg-slate-50/30',
          hoverBg: 'hover:bg-slate-50',
        };
      case 'passed':
        return {
          border: 'border-l-4 border-l-green-500 border-t border-r border-b border-muted',
          bg: '',
          hoverBg: 'hover:bg-muted/50',
        };
      default: {
        const _exhaustive: never = check.status;
        throw new Error(`Unhandled check status: ${_exhaustive}`);
      }
    }
  };

  const statusStyles = getStatusStyles();

  return (
    <div className={`rounded-md overflow-hidden ${statusStyles.border} ${statusStyles.bg}`}>
      <button
        type="button"
        className={`w-full p-3 sm:p-4 text-left ${statusStyles.hoverBg} transition-colors cursor-pointer flex justify-between items-start gap-2`}
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
          <span className="shrink-0 mt-0.5">{getStatusIcon()}</span>
          <h4 className="font-medium text-sm sm:text-base leading-snug">{check.title}</h4>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:block">{getStatusBadge()}</span>
          {(check.details || check.skipReason || isTreasuryMovementCheck) &&
            (isExpanded ? (
              <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
            ))}
        </div>
      </button>

      {isExpanded && (check.details || check.skipReason || isTreasuryMovementCheck) && (
        <div className="px-3 pb-4 sm:px-4 sm:pb-4 sm:pl-12 text-sm border-t border-muted/50 bg-background/50">
          {check.status === 'warning' &&
            check.warnings &&
            check.warnings.length > 0 &&
            check.warnings.some((w) => !w.includes('0x') && w.length < 200) && (
              <div className="mt-4 mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <div className="flex items-start gap-2">
                  <AlertTriangleIcon className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                  <div className="text-yellow-800 text-sm">
                    <span className="font-medium">Why this check has warnings:</span>
                    <ul className="mt-1 list-disc list-inside space-y-1">
                      {check.warnings
                        .filter((w) => !w.includes('0x') && w.length < 200)
                        .map((w, i) => (
                          <li key={`reason-${i}`}>{w}</li>
                        ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

          {check.status === 'failed' && check.errors && check.errors.length > 0 && (
            <div className="mt-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-red-800 text-sm">
                  <span className="font-medium">Why this check failed:</span>
                  <ul className="mt-1 list-disc list-inside space-y-1">
                    {check.errors.map((e, i) => (
                      <li key={`error-${i}`}>{e}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {check.status === 'skipped' && check.skipReason ? (
            <div className="mt-4">
              <p className="text-muted-foreground italic">{check.skipReason}</p>
            </div>
          ) : isStateChangesCheck ? (
            <div className="mt-4">
              {stateChanges && stateChanges.length > 0 ? (
                <StateChanges stateChanges={stateChanges} />
              ) : (
                <div className="flex items-center justify-center p-6 text-muted-foreground">
                  <InfoIcon className="h-4 w-4 mr-2" />
                  <span>No state changes available</span>
                </div>
              )}
            </div>
          ) : isVerificationCheck && check.details ? (
            <div className="mt-4">
              <ContractVerificationList details={check.details} />
            </div>
          ) : isProxyResolutionCheck && check.details ? (
            <div className="mt-4">
              <ProxyResolutionDetails details={check.details} />
            </div>
          ) : isTreasuryMovementCheck && treasuryData ? (
            <div className="mt-4">
              <TreasuryMovementCheck {...treasuryData} />
            </div>
          ) : (
            <div className="mt-4 whitespace-pre-wrap">
              <FormattedCheckDetails
                check={check}
                stateChanges={stateChanges}
                metadata={metadata}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
