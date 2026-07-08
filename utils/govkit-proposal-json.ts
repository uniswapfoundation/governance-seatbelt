import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';
import { parseWithSchema, z } from './validation/zod';

const MAX_GOVKIT_JSON_BYTES = 1_000_000;
const MAX_GOVKIT_PROPOSAL_ACTIONS = 500;

const addressSchema = z.string().transform((value, ctx) => {
  try {
    return getAddress(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must be a 20-byte 0x-prefixed address',
    });
    return z.NEVER;
  }
});

const calldataSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'must be 0x-prefixed even-length hex');

const valueSchema = z.unknown().transform((value, ctx): bigint => {
  if (typeof value === 'string') {
    if (/^(0|[1-9]\d*)$/.test(value)) return BigInt(value);

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must be a non-negative decimal integer string',
    });
    return z.NEVER;
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a non-negative integer',
      });
      return z.NEVER;
    }

    if (!Number.isSafeInteger(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a decimal string because large JSON numbers lose precision',
      });
      return z.NEVER;
    }

    return BigInt(value);
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'must be a decimal string or safe JSON number',
  });
  return z.NEVER;
});

const govKitProposalJsonSchema = z
  .object({
    type: z.literal('new'),
    daoName: z.string().min(1, 'is required'),
    description: z.string(),
    governorAddress: addressSchema,
    governorType: z.enum(['bravo', 'oz']),
    targets: z.array(addressSchema).max(MAX_GOVKIT_PROPOSAL_ACTIONS),
    values: z.array(valueSchema),
    signatures: z.array(z.string()),
    calldatas: z.array(calldataSchema),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    const lengths = [
      { name: 'targets', size: proposal.targets.length },
      { name: 'values', size: proposal.values.length },
      { name: 'signatures', size: proposal.signatures.length },
      { name: 'calldatas', size: proposal.calldatas.length },
    ];

    const uniqueLengths = new Set(lengths.map((entry) => entry.size));
    if (uniqueLengths.size === 1) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: `call arrays must have matching lengths (${lengths
        .map((entry) => `${entry.name}=${entry.size}`)
        .join(', ')})`,
    });
  });

export function parseGovKitProposalJson(value: unknown): SimulationConfigNew {
  const parsed = parseWithSchema(govKitProposalJsonSchema, value, 'GovKit proposal JSON');

  return {
    type: parsed.type,
    daoName: parsed.daoName,
    description: parsed.description,
    governorAddress: parsed.governorAddress as Address,
    governorType: parsed.governorType,
    targets: parsed.targets as Address[],
    values: parsed.values,
    signatures: parsed.signatures,
    calldatas: parsed.calldatas as `0x${string}`[],
  };
}

export function readGovKitProposalJson(path: string): SimulationConfigNew {
  const raw = readFileSync(path);
  if (raw.byteLength > MAX_GOVKIT_JSON_BYTES) {
    throw new Error(`GovKit proposal JSON exceeds ${MAX_GOVKIT_JSON_BYTES} byte limit: ${path}`);
  }

  return parseGovKitProposalJson(JSON.parse(raw.toString('utf8')));
}
