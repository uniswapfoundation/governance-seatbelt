import type { Abi } from 'viem';
import { getAddress } from 'viem';
import { SchemaValidationError, parseWithSchema, z } from '../validation/zod';

export function isAbi(value: unknown): value is Abi {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        typeof (item as { type?: unknown }).type === 'string',
    )
  );
}

export const verifierLookupResponseSchema = z
  .object({
    match: z.string().nullable(),
    creationMatch: z.string().nullable().optional(),
    runtimeMatch: z.string().nullable().optional(),
    verifiedAt: z.string().optional(),
    chainId: z.union([z.string(), z.number()]),
    address: z.string(),
    abi: z.custom<Abi>(isAbi, { message: 'Invalid ABI payload' }).nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

interface VerifierLookupClientOptions {
  baseUrl: string;
  name: string;
  notFoundSchema?: z.ZodType<unknown>;
}

interface VerifierLookupOptions {
  fields?: string[];
}

export interface VerifierLookupResponse {
  match: string | null;
  creationMatch?: string | null;
  runtimeMatch?: string | null;
  verifiedAt?: string;
  chainId: string | number;
  address: string;
  abi?: Abi | null;
  name?: string | null;
}

type LookupStatus = 'ok' | 'not_found' | 'error';

export interface VerifierLookupResult {
  data: VerifierLookupResponse | null;
  status: LookupStatus;
}

function getCacheKey(address: string, chainId: number, fields?: string[]): string {
  const sortedFields = [...(fields ?? [])].sort().join(',');
  return `${chainId}:${getAddress(address)}:${sortedFields}`;
}

function normalizeLookupBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function buildLookupUrl(
  baseUrl: string,
  chainId: number,
  address: string,
  fields?: string[],
): string {
  const url = new URL(`${normalizeLookupBaseUrl(baseUrl)}/contract/${chainId}/${address}`);

  if (fields && fields.length > 0) {
    url.searchParams.set('fields', [...fields].sort().join(','));
  }

  return url.toString();
}

export class VerifierLookupClient {
  private static readonly MAX_CACHE_ENTRIES = 500;
  private static readonly TIMEOUT_MS = 10000;

  private cache = new Map<string, VerifierLookupResponse>();
  private readonly baseUrl: string;
  private readonly name: string;
  private readonly notFoundSchema?: z.ZodType<unknown>;

  constructor(options: VerifierLookupClientOptions) {
    this.baseUrl = `${normalizeLookupBaseUrl(options.baseUrl)}/v2`;
    this.name = options.name;
    this.notFoundSchema = options.notFoundSchema;
  }

  async lookup(
    address: string,
    chainId: number,
    options?: VerifierLookupOptions,
  ): Promise<VerifierLookupResult> {
    const checksummedAddress = getAddress(address);
    const fields = options?.fields;
    const cacheKey = getCacheKey(checksummedAddress, chainId, fields);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { status: 'ok', data: cached };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), VerifierLookupClient.TIMEOUT_MS);

      const response = await fetch(
        buildLookupUrl(this.baseUrl, chainId, checksummedAddress, fields),
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (response.status === 404) {
        const rawData = await response.json();
        if (this.notFoundSchema) {
          parseWithSchema(
            this.notFoundSchema,
            rawData,
            `${this.name} contract lookup not found response`,
          );
        } else {
          parseWithSchema(
            verifierLookupResponseSchema,
            rawData,
            `${this.name} contract lookup response`,
          );
        }

        return { status: 'not_found', data: null };
      }

      if (!response.ok) {
        console.warn(
          `${this.name} API returned status ${response.status} for ${checksummedAddress}`,
        );
        return { status: 'error', data: null };
      }

      const rawData = await response.json();
      const data = parseWithSchema(
        verifierLookupResponseSchema,
        rawData,
        `${this.name} contract lookup response`,
      ) as VerifierLookupResponse;
      this.setCachedResult(cacheKey, data);
      return { status: 'ok', data };
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`${this.name} API timeout for ${address} on chain ${chainId}`);
      } else {
        console.warn(`${this.name} API error for ${address} on chain ${chainId}:`, error);
      }

      return { status: 'error', data: null };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private setCachedResult(cacheKey: string, data: VerifierLookupResponse): void {
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    }
    this.cache.set(cacheKey, data);

    if (this.cache.size <= VerifierLookupClient.MAX_CACHE_ENTRIES) {
      return;
    }

    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
