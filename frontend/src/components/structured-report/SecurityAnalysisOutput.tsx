'use client';

import { Badge } from '@/components/ui/badge';
import { ChevronDownIcon, ChevronRightIcon, ShieldCheckIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

interface ParsedSecurityFinding {
  severity: 'high' | 'medium' | 'low' | 'info' | 'optimization';
  title: string;
  description: string;
  location?: string;
}

interface ParsedSecurityOutput {
  summary: {
    contractsAnalyzed: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
  };
  findings: ParsedSecurityFinding[];
  rawOutput: string;
}

function parseSecurityOutput(details: string): ParsedSecurityOutput {
  const findings: ParsedSecurityFinding[] = [];
  const lines = details.split('\n');

  const contractMatches = details.match(/Compiler warnings for/g);
  const contractsAnalyzed = contractMatches?.length || 0;

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let infoCount = 0;

  const highPattern = /Impact: High|severity: High/gi;
  const mediumPattern = /Impact: Medium|severity: Medium/gi;
  const lowPattern = /Impact: Low|severity: Low/gi;

  highCount = (details.match(highPattern) || []).length;
  mediumCount = (details.match(mediumPattern) || []).length;
  lowCount = (details.match(lowPattern) || []).length;

  const infoLines = lines.filter(
    (line) =>
      line.includes('INFO:') &&
      !line.includes('CryticCompile') &&
      !line.includes('Slither:') &&
      !line.includes('Detectors:'),
  );
  infoCount = infoLines.length;

  return {
    summary: {
      contractsAnalyzed,
      highCount,
      mediumCount,
      lowCount,
      infoCount,
    },
    findings,
    rawOutput: details,
  };
}

export function SecurityAnalysisOutput({
  details,
  checkTitle,
}: {
  details: string;
  checkTitle: string;
}) {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const parsed = useMemo(() => parseSecurityOutput(details), [details]);

  const isSlither = checkTitle.toLowerCase().includes('slither');
  const isSolc = checkTitle.toLowerCase().includes('solc');
  const toolName = isSlither ? 'Slither' : isSolc ? 'Solc' : 'Security Analysis';

  const { summary } = parsed;
  const hasFindings = summary.highCount + summary.mediumCount + summary.lowCount > 0;

  return (
    <div className="space-y-4">
      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{toolName} Analysis</span>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">
              {summary.contractsAnalyzed} contract{summary.contractsAnalyzed !== 1 ? 's' : ''}{' '}
              analyzed
            </span>
            {!hasFindings && (
              <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                No issues found
              </Badge>
            )}
            {summary.highCount > 0 && <Badge variant="destructive">{summary.highCount} High</Badge>}
            {summary.mediumCount > 0 && (
              <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
                {summary.mediumCount} Medium
              </Badge>
            )}
            {summary.lowCount > 0 && (
              <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                {summary.lowCount} Low
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowRawOutput(!showRawOutput)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRawOutput ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
          <span>{showRawOutput ? 'Hide' : 'View'} raw output</span>
        </button>
        {showRawOutput && (
          <div className="mt-3 max-h-96 overflow-auto rounded-md bg-muted/50 p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
              {parsed.rawOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
