import { z } from 'zod';

export type ZodIssueSummary = {
  path: string;
  message: string;
};

const simulationResultSchema = z
  .object({
    proposalData: z
      .object({
        id: z.string().optional(),
        targets: z.array(z.string()),
        values: z.array(z.string()),
        signatures: z.array(z.string()),
        calldatas: z.array(z.string()),
        description: z.string(),
      })
      .passthrough(),
    report: z
      .object({
        status: z.string(),
        summary: z.string(),
        markdownReport: z.string(),
        structuredReport: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

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
