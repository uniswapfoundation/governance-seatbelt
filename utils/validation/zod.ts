import { z } from 'zod';

export type ZodIssueSummary = {
  path: string;
  message: string;
};

export class SchemaValidationError extends Error {
  issues: z.ZodIssue[];
  context: string;

  constructor(context: string, issues: z.ZodIssue[]) {
    const summary = formatZodIssues(issues);
    super(`[schema] ${context} invalid: ${summary}`);
    this.name = 'SchemaValidationError';
    this.issues = issues;
    this.context = context;
  }
}

export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function toZodIssueSummary(issues: z.ZodIssue[]): ZodIssueSummary[] {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
}

export function parseWithSchema<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new SchemaValidationError(context, parsed.error.issues);
}

export { z };
