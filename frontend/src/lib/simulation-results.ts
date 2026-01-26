import { z } from 'zod';

export type ZodIssueSummary = {
  path: string;
  message: string;
};

const MAX_CALLS_PER_PROPOSAL = 250;
const MAX_DESCRIPTION_CHARS = 500_000;
const MAX_REPORT_SUMMARY_CHARS = 100_000;
const MAX_REPORT_MARKDOWN_CHARS = 5_000_000;

const simulationResultSchemaBase = z
  .object({
    proposalData: z
      .object({
        id: z.string().optional(),
        targets: z.array(z.string()).max(MAX_CALLS_PER_PROPOSAL),
        values: z.array(z.string()).max(MAX_CALLS_PER_PROPOSAL),
        signatures: z.array(z.string()).max(MAX_CALLS_PER_PROPOSAL),
        calldatas: z.array(z.string()).max(MAX_CALLS_PER_PROPOSAL),
        description: z.string().max(MAX_DESCRIPTION_CHARS),
      })
      .passthrough(),
    report: z
      .object({
        status: z.string(),
        summary: z.string().max(MAX_REPORT_SUMMARY_CHARS),
        markdownReport: z.string().max(MAX_REPORT_MARKDOWN_CHARS),
        structuredReport: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

type SimulationResult = z.infer<typeof simulationResultSchemaBase>;

const simulationResultSchema = simulationResultSchemaBase.superRefine(
  (value: SimulationResult, ctx: z.RefinementCtx) => {
    const { targets, values, signatures, calldatas } = value.proposalData;
    const lengths = [
      { key: 'targets', len: targets.length },
      { key: 'values', len: values.length },
      { key: 'signatures', len: signatures.length },
      { key: 'calldatas', len: calldatas.length },
    ];

    const uniqueLengths = new Set(lengths.map((l) => l.len));
    if (uniqueLengths.size === 1) return;

    const lengthsText = lengths.map((l) => `${l.key}=${l.len}`).join(', ');
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['proposalData'],
      message: `Proposal call arrays must be the same length (${lengthsText})`,
    });
  },
);

const simulationResultsSchema = z.array(simulationResultSchema);

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function toZodIssueSummary(issues: z.ZodIssue[]): ZodIssueSummary[] {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
}

export class SimulationResultsParseError extends Error {
  issues: z.ZodIssue[];
  summary: ZodIssueSummary[];

  constructor(issues: z.ZodIssue[]) {
    super(`Invalid simulation-results.json: ${formatZodIssues(issues)}`);
    this.name = 'SimulationResultsParseError';
    this.issues = issues;
    this.summary = toZodIssueSummary(issues);
  }
}

export function parseSimulationResultsJson(value: unknown) {
  const normalized = Array.isArray(value) ? value : [value];
  const parsed = simulationResultsSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  throw new SimulationResultsParseError(parsed.error.issues);
}
