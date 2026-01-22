import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AllCheckResults, CoverageData, ProposalEvent, SimulationBlock } from '../../types';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, canonicalize(val)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function toContractView(parsed: unknown) {
  const parsedObj = parsed as Record<string, unknown> | null;
  const report = (parsedObj?.report as Record<string, unknown> | null) ?? null;
  const structured = (report?.structuredReport as Record<string, unknown> | null) ?? null;

  const proposalData = (parsedObj?.proposalData as Record<string, unknown> | null) ?? null;

  const structuredChecks = structured?.checks;
  const checks = Array.isArray(structuredChecks)
    ? structuredChecks.map((entry) => {
        const check = entry as Record<string, unknown> | null;
        return {
          checkId: (check?.checkId as string | null | undefined) ?? null,
          status: (check?.status as string | null | undefined) ?? null,
          warningCount: (check?.warningCount as number | null | undefined) ?? null,
          errorCount: (check?.errorCount as number | null | undefined) ?? null,
          skipReason: (check?.skipReason as string | null | undefined) ?? null,
          data: check?.data ?? null,
        };
      })
    : null;

  return canonicalize({
    proposalData,
    report: {
      status: report?.status ?? null,
      structuredReport: structured
        ? {
            status: structured.status ?? null,
            metadata: structured.metadata ?? null,
            coverage: structured.coverage ?? null,
            permissionsDiff: structured.permissionsDiff ?? null,
            crossChain: structured.crossChain ?? null,
            checks,
          }
        : null,
    },
  });
}

describe('Report JSON contract', () => {
  test('emits a stable machine contract for simulation-results.json', async () => {
    const oldEnv = { ...process.env };
    try {
      process.env.GITHUB_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      process.env.GITHUB_REPOSITORY = 'uniswapfoundation/governance-seatbelt';

      // Keep this contract test hermetic: report code currently asserts these exist at module load.
      // We set harmless placeholders so the test doesn't require CI secrets or network access.
      process.env.MAINNET_RPC_URL ??= 'http://localhost:8545';
      process.env.ARBITRUM_RPC_URL ??= 'http://localhost:8545';
      process.env.ETHERSCAN_API_KEY ??= 'test';
      process.env.RPC_URL ??= 'http://localhost:8545';
      process.env.TENDERLY_ACCESS_TOKEN ??= 'test';
      process.env.TENDERLY_USER ??= 'test';
      process.env.TENDERLY_PROJECT_SLUG ??= 'test';

      const { writeSimulationResultsJson } = await import('../../presentation/report');

      const proposal: ProposalEvent = {
        id: 123n,
        proposalId: 123n,
        proposer: '0x1234567890abcdef1234567890abcdef12345678',
        startBlock: 18000000n,
        endBlock: 18100000n,
        description: '# Test Proposal\n\nThis is a test proposal description.',
        targets: ['0xabcdef1234567890abcdef1234567890abcdef12'],
        values: [0n],
        signatures: ['transfer(address,uint256)'],
        calldatas: ['0x123456'],
      };

      const blocks = {
        current: { number: 18200000n, timestamp: 1700000000n } as SimulationBlock,
        start: { number: 18000000n, timestamp: 1699000000n } as SimulationBlock,
        end: { number: 18100000n, timestamp: 1699500000n } as SimulationBlock,
      };

      const checks: AllCheckResults = {
        'example-warning': {
          name: 'Example Warning Check',
          result: {
            errors: [],
            warnings: ['This is a warning'],
            info: ['This is info'],
          },
        },
        'example-skipped': {
          name: 'Example Skipped Check',
          result: {
            errors: [],
            warnings: [],
            info: [],
            skipped: { reason: 'not applicable' },
          },
        },
      };

      const coverage: CoverageData = {
        metadata: {
          gitCommitHash: 'deadbeef',
          gitBranch: 'marcomariscal/issue-87-doc',
          timestamp: '2026-01-22T00:00:00.000Z',
          bunVersion: '1.2.20',
          nodeVersion: 'v20.0.0',
          runnerOs: 'linux',
        },
        checks: [
          {
            checkId: 'example-warning',
            checkName: 'Example Warning Check',
            status: 'ran',
            wasInferred: false,
            chainId: 1,
          },
          {
            checkId: 'example-skipped',
            checkName: 'Example Skipped Check',
            status: 'skipped',
            skipReason: 'not applicable',
            wasInferred: false,
            chainId: 1,
          },
        ],
        summary: {
          total: 2,
          ran: 1,
          skipped: 1,
          failed: 0,
          inferredSkips: 0,
        },
      };

      const outDir = mkdtempSync(join(tmpdir(), 'seatbelt-report-contract-'));
      const outPath = join(outDir, 'simulation-results.json');

      writeSimulationResultsJson({
        governorType: 'bravo',
        blocks,
        proposal,
        checks,
        markdownReport: '# Report\n\nHello world.',
        governorAddress: '0x9876543210fedcba9876543210fedcba98765432',
        outputPath: outPath,
        chainId: 1,
        simulationType: 'proposed',
        proposalCreatedBlock: blocks.start,
        proposalExecutedBlock: undefined,
        executor: undefined,
        coverage,
      });

      const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
      const contractView = toContractView(parsed);

      const fixturePath = join(__dirname, 'fixtures', 'simulation-results.contract.json');
      const expected = JSON.parse(readFileSync(fixturePath, 'utf8'));

      expect(contractView).toEqual(expected);
    } finally {
      // Restore env (preserve object identity)
      for (const key of Object.keys(process.env)) {
        if (!(key in oldEnv)) process.env[key] = undefined;
      }

      for (const [key, value] of Object.entries(oldEnv)) {
        process.env[key] = value;
      }
    }
  });
});
