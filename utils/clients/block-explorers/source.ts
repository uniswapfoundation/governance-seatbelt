import { z } from '../../validation/zod';

export const soliditySourceSchema = z.object({
  compilerVersion: z.string().regex(/^v?\d+\.\d+\.\d+\+commit\.[a-f0-9]{8}$/),
  contractName: z.string().min(1),
  fileName: z.string().optional(),
  input: z.object({
    language: z.literal('Solidity'),
    sources: z.record(z.string(), z.object({ content: z.string() })),
    settings: z.record(z.string(), z.unknown()),
  }),
});
export type SoliditySource = z.infer<typeof soliditySourceSchema>;
