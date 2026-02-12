import { z } from 'zod';

export const PUBLISH_SCHEMA_VERSION = 1;

const publishStatusSchema = z.enum(['success', 'warning', 'error', 'inconclusive']);
const simulationTypeSchema = z.enum(['new', 'proposed', 'executed']);

const hexAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 20-byte 0x-prefixed address');
const decimalStringSchema = z.string().regex(/^\d+$/, 'must be a base-10 integer string');
const decimalOrUnknownSchema = z.union([decimalStringSchema, z.literal('unknown')]);

const proposalDataSchema = z
  .object({
    id: z.string().min(1, 'is required'),
    targets: z.array(z.string()),
    values: z.array(z.string()),
    signatures: z.array(z.string()),
    calldatas: z.array(z.string()),
    description: z.string(),
  })
  .passthrough()
  .superRefine((proposalData, ctx) => {
    const lengths = [
      { name: 'targets', size: proposalData.targets.length },
      { name: 'values', size: proposalData.values.length },
      { name: 'signatures', size: proposalData.signatures.length },
      { name: 'calldatas', size: proposalData.calldatas.length },
    ];

    const uniqueLengths = new Set(lengths.map((entry) => entry.size));
    if (uniqueLengths.size === 1) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: `call arrays must have matching lengths (${lengths
        .map((entry) => `${entry.name}=${entry.size}`)
        .join(', ')})`,
    });
  });

const publishMetadataSchema = z
  .object({
    schemaVersion: z.literal(PUBLISH_SCHEMA_VERSION),
    simulationType: simulationTypeSchema,
    proposalId: z.string().min(1, 'is required'),
    governorAddress: hexAddressSchema,
    chainId: z.number().int().positive('must be a positive chain id'),
    simulationBlockNumber: decimalStringSchema,
    simulationTimestamp: decimalStringSchema,
    proposalCreatedAtBlockNumber: decimalOrUnknownSchema,
    proposalCreatedAtTimestamp: decimalOrUnknownSchema,
    proposalExecutedAtBlockNumber: decimalStringSchema.optional(),
    proposalExecutedAtTimestamp: decimalStringSchema.optional(),
  })
  .passthrough()
  .superRefine((metadata, ctx) => {
    if (metadata.simulationType !== 'executed') {
      return;
    }

    if (!metadata.proposalExecutedAtBlockNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalExecutedAtBlockNumber'],
        message: 'is required when metadata.simulationType is "executed"',
      });
    }

    if (!metadata.proposalExecutedAtTimestamp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposalExecutedAtTimestamp'],
        message: 'is required when metadata.simulationType is "executed"',
      });
    }
  });

const structuredReportSchema = z
  .object({
    status: publishStatusSchema,
    summary: z.string(),
    checks: z.array(z.unknown()),
    events: z.array(z.unknown()),
    stateChanges: z.array(z.unknown()),
    metadata: publishMetadataSchema,
  })
  .passthrough();

const simulationResultSchema = z
  .object({
    proposalData: proposalDataSchema,
    report: z
      .object({
        status: publishStatusSchema,
        summary: z.string(),
        markdownReport: z.string(),
        structuredReport: structuredReportSchema,
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((result, ctx) => {
    if (result.report.status === result.report.structuredReport.status) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['report', 'structuredReport', 'status'],
      message: 'must match report.status',
    });
  });

export type PublishableSimulationResult = z.infer<typeof simulationResultSchema>;

export type PublishArtifactIssue = {
  path: string;
  message: string;
};

export class PublishArtifactValidationError extends Error {
  issues: PublishArtifactIssue[];

  constructor(issues: PublishArtifactIssue[]) {
    super(
      `Invalid publish artifact:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'PublishArtifactValidationError';
    this.issues = issues;
  }
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return 'root';
  }

  return path
    .map((segment) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }

      if (typeof segment === 'symbol') {
        return segment.toString();
      }

      return segment;
    })
    .join('.');
}

function toArtifactIssues(error: z.ZodError): PublishArtifactIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

function normalizeArtifactResults(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

export function validatePublishArtifact(value: unknown): PublishableSimulationResult {
  const normalized = normalizeArtifactResults(value);

  if (normalized.length !== 1) {
    throw new PublishArtifactValidationError([
      {
        path: 'root',
        message: `publish expects exactly one simulation result entry (received ${normalized.length})`,
      },
    ]);
  }

  const candidate = normalized[0];
  const parsed = simulationResultSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  throw new PublishArtifactValidationError(toArtifactIssues(parsed.error));
}
