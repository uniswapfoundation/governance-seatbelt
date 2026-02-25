import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSimulationResultsJson } from '../presentation/report';
import {
  appendDestinationCoverageDiagnostics,
  buildCoverageFromResults,
  buildCoverageMetadata,
  runChecksForChainWithDiagnostics,
} from '../run-checks';
import type {
  AllCheckResults,
  ChainExecutionDiagnostics,
  ProposalCheck,
  ProposalData,
  ProposalEvent,
  TenderlySimulation,
} from '../types';
import { getChainConfig } from '../utils/clients/client';

const proposal: ProposalEvent = {
  id: 198n,
  proposalId: 198n,
  proposer: '0x1234567890abcdef1234567890abcdef12345678',
  startBlock: 1n,
  endBlock: 2n,
  description: '# Issue 198\n\nResilience test proposal.',
  targets: ['0x1111111111111111111111111111111111111111'],
  values: [0n],
  signatures: ['transfer(address,uint256)'],
  calldatas: ['0x'],
};

const sim = {} as TenderlySimulation;

const deps: ProposalData = {
  governor: {},
  timelock: {},
  publicClient: {},
  chainConfig: getChainConfig(1),
  targets: [],
  touchedContracts: [],
};

describe('Issue #198 resilience behavior', () => {
  it('isolates per-check execution and applies a single retry for transient failures', async () => {
    let retrySuccessAttempts = 0;
    let retryFailureAttempts = 0;

    const checksOverride: Record<string, ProposalCheck> = {
      checkStateChanges: {
        name: 'Retry succeeds',
        async checkProposal() {
          retrySuccessAttempts += 1;
          if (retrySuccessAttempts === 1) {
            throw new Error('RPC request failed with ETIMEDOUT');
          }
          return { info: ['recovered'], warnings: [], errors: [] };
        },
      },
      checkLogs: {
        name: 'Retry fails',
        async checkProposal() {
          retryFailureAttempts += 1;
          throw new Error('Sourcify network error 503');
        },
      },
      checkProxyResolution: {
        name: 'Still runs after failure',
        async checkProposal() {
          return { info: ['continued'], warnings: [], errors: [] };
        },
      },
    };

    const chainRun = await runChecksForChainWithDiagnostics(
      proposal,
      sim,
      deps,
      1,
      undefined,
      checksOverride,
    );

    expect(chainRun.results.checkStateChanges.result.info).toEqual(['recovered']);
    expect(chainRun.results.checkLogs.result.skipped?.reason).toContain('Inconclusive');
    expect(chainRun.results.checkProxyResolution.result.info).toEqual(['continued']);

    expect(retrySuccessAttempts).toBe(2);
    expect(retryFailureAttempts).toBe(2);

    const retrySuccessDiagnostic = chainRun.diagnostics.retries.find(
      (entry) => entry.checkId === 'checkStateChanges',
    );
    expect(retrySuccessDiagnostic?.outcome).toBe('success');
    expect(retrySuccessDiagnostic?.retries).toBe(1);

    const retryFailureDiagnostic = chainRun.diagnostics.retries.find(
      (entry) => entry.checkId === 'checkLogs',
    );
    expect(retryFailureDiagnostic?.outcome).toBe('failed');
    expect(retryFailureDiagnostic?.retries).toBe(1);

    expect(chainRun.diagnostics.failedChecks.map((entry) => entry.checkId)).toContain('checkLogs');
    expect(chainRun.diagnostics.partial).toBe(true);
    expect(chainRun.diagnostics.partialReason).toContain('checkLogs');
  });

  it('marks destination chain as inconclusive/partial in structured JSON when checks are degraded', () => {
    const sourceChecks: AllCheckResults = {
      checkStateChanges: {
        name: 'State Changes',
        result: {
          info: ['ok'],
          warnings: [],
          errors: [],
        },
      },
    };

    const coverage = buildCoverageFromResults(sourceChecks, buildCoverageMetadata(), 1);

    const destinationDiagnostics: Record<number, ChainExecutionDiagnostics> = {
      42161: {
        chainId: 42161,
        attemptedChecks: ['checkStateChanges', 'checkLogs'],
        failedChecks: [
          {
            checkId: 'checkLogs',
            checkName: 'Logs',
            reason: 'Check execution failed (checkLogs): Sourcify network error 503',
            retryable: true,
            retries: 1,
          },
        ],
        retries: [
          {
            checkId: 'checkLogs',
            checkName: 'Logs',
            retries: 1,
            outcome: 'failed',
            lastError: 'Sourcify network error 503',
          },
        ],
        partial: true,
        partialReason:
          'Destination simulation succeeded but destination checks were partial: checkLogs failed.',
      },
    };

    appendDestinationCoverageDiagnostics(
      coverage,
      {},
      [
        {
          chainId: 42161,
          bridgeType: 'ArbitrumL1L2',
          status: 'success',
        },
      ],
      {
        1: {
          chainId: 1,
          attemptedChecks: ['checkStateChanges'],
          failedChecks: [],
          retries: [],
          partial: false,
        },
        ...destinationDiagnostics,
      },
    );

    const outputDir = mkdtempSync(join(tmpdir(), 'seatbelt-issue-198-'));
    const outputPath = join(outputDir, 'simulation-results.json');

    const blocks = {
      current: { number: 3n, timestamp: 3n },
      start: { number: 1n, timestamp: 1n },
      end: { number: 2n, timestamp: 2n },
    };

    writeSimulationResultsJson({
      governorType: 'bravo',
      blocks,
      proposal,
      checks: sourceChecks,
      markdownReport: '# Report',
      governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
      outputPath,
      destinationSimulations: [
        {
          chainId: 42161,
          bridgeType: 'ArbitrumL1L2',
          status: 'success',
        },
      ],
      destinationChecks: {},
      chainId: 1,
      simulationType: 'proposed',
      coverage,
    });

    const parsed = JSON.parse(readFileSync(outputPath, 'utf8'));
    const report = parsed.report.structuredReport;

    expect(report.status).toBe('inconclusive');
    expect(report.coverage.executionDiagnostics['42161'].partial).toBe(true);

    const chainReport = report.chainReports.find(
      (entry: { chainId: number }) => entry.chainId === 42161,
    );
    expect(chainReport).toBeDefined();
    expect(chainReport.status).toBe('inconclusive');
    expect(
      chainReport.checks.some(
        (entry: { checkId?: string; status: string }) =>
          entry.checkId === 'destinationCheckExecution' && entry.status === 'inconclusive',
      ),
    ).toBe(true);
  });
});
