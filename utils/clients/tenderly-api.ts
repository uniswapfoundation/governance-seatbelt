import mftch from 'micro-ftch';
import type { FETCH_OPT } from 'micro-ftch';
import { getAddress } from 'viem';
import type { StorageEncodingResponse, TenderlyPayload, TenderlySimulation } from '../../types.d';
import {
  TENDERLY_BASE_URL,
  getTenderlyAccessToken,
  getTenderlyEncodeUrl,
  getTenderlySimUrl,
} from '../constants';
import { parseWithSchema, z } from '../validation/zod';

const fetchUrl = mftch;

function getTenderlyFetchOptions() {
  return {
    type: 'json' as const,
    headers: { 'X-Access-Key': getTenderlyAccessToken() },
  };
}

const DEFAULT_TENDERLY_REQUEST_TIMEOUT_MS = 15_000;
const TENDERLY_REQUEST_TIMEOUT_MS = (() => {
  const raw = process.env.TENDERLY_REQUEST_TIMEOUT_MS;
  if (!raw) return DEFAULT_TENDERLY_REQUEST_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid TENDERLY_REQUEST_TIMEOUT_MS="${raw}", using default ${DEFAULT_TENDERLY_REQUEST_TIMEOUT_MS}ms`,
    );
    return DEFAULT_TENDERLY_REQUEST_TIMEOUT_MS;
  }

  return parsed;
})();

const tenderlyBlockNumberSchema = z
  .object({
    block_number: z.number(),
  })
  .passthrough();

const tenderlyStorageEncodingSchema: z.ZodType<StorageEncodingResponse> = z
  .object({
    stateOverrides: z.record(
      z.string(),
      z.object({
        value: z.record(z.string(), z.string()),
      }),
    ),
  })
  .passthrough();

const tenderlySimulationSchema: z.ZodType<TenderlySimulation> = z
  .custom<TenderlySimulation>((value) => typeof value === 'object' && value !== null, {
    message: 'Expected object',
  })
  .superRefine((value, ctx) => {
    const candidate = value as {
      transaction?: { status?: unknown; addresses?: unknown };
      contracts?: Array<{ address?: unknown }> | unknown;
      simulation?: { id?: unknown };
    };

    if (!candidate.transaction || typeof candidate.transaction !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected object',
        path: ['transaction'],
      });
    } else {
      if (typeof candidate.transaction.status !== 'boolean') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected boolean',
          path: ['transaction', 'status'],
        });
      }
      if (
        !Array.isArray(candidate.transaction.addresses) ||
        !candidate.transaction.addresses.every((address) => typeof address === 'string')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected string[]',
          path: ['transaction', 'addresses'],
        });
      }
    }

    if (!Array.isArray(candidate.contracts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected array',
        path: ['contracts'],
      });
    } else {
      candidate.contracts.forEach((contract, index) => {
        if (!contract || typeof contract.address !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Expected string',
            path: ['contracts', index, 'address'],
          });
        }
      });
    }

    if (!candidate.simulation || typeof candidate.simulation !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected object',
        path: ['simulation'],
      });
    } else if (typeof candidate.simulation.id !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected string',
        path: ['simulation', 'id'],
      });
    }
  });

type TenderlyError = {
  statusCode?: number;
};

function makeTenderlyTimeoutError(label: string): Error {
  const error = new Error(`${label} timed out after ${TENDERLY_REQUEST_TIMEOUT_MS}ms`);
  error.name = 'TenderlyTimeoutError';
  return error;
}

function isTenderlyTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TenderlyTimeoutError';
}

async function fetchUrlWithTimeout<T>(label: string, url: string, options: Partial<FETCH_OPT>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race<T>([
      fetchUrl(url, options) as Promise<T>,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(makeTenderlyTimeoutError(label)),
          TENDERLY_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export type StateOverridesPayload = {
  networkID: string;
  stateOverrides: Record<string, { value: Record<string, string> }>;
};

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
}

export function getTenderlySaveFlags(defaultSaveIfFails: boolean): {
  save: boolean;
  saveIfFails: boolean;
} {
  const save = parseBooleanEnv(process.env.TENDERLY_SAVE_SIMULATIONS) ?? true;
  const saveIfFails = parseBooleanEnv(process.env.TENDERLY_SAVE_IF_FAILS) ?? defaultSaveIfFails;
  return { save, saveIfFails: save ? saveIfFails : false };
}

export async function getLatestBlock(chainId: number): Promise<number> {
  try {
    const url = `${TENDERLY_BASE_URL}/network/${chainId.toString()}/block-number`;
    const fetchOptions = <Partial<FETCH_OPT>>{
      method: 'GET',
      ...getTenderlyFetchOptions(),
    };
    const rawRes = await fetchUrlWithTimeout(
      `Tenderly getLatestBlock(${chainId})`,
      url,
      fetchOptions,
    );
    const res = parseWithSchema(
      tenderlyBlockNumberSchema,
      rawRes,
      'Tenderly block-number response',
    );
    return res.block_number;
  } catch (err) {
    console.log('logging getLatestBlock error');
    console.log(JSON.stringify(err, null, 2));
    throw err;
  }
}

// Tenderly's `encode-states` endpoint rejects request bodies above ~11KB with a 413. We keep each
// chunk comfortably below that cliff. Each storage key encodes to its own independent slot(s), so
// splitting the overrides across multiple requests and merging the responses is equivalent to a
// single request. Overridable via env in case the limit differs behind a proxy.
const DEFAULT_MAX_ENCODE_BODY_BYTES = 8_000;
const MAX_ENCODE_BODY_BYTES = (() => {
  const raw = process.env.TENDERLY_ENCODE_MAX_BODY_BYTES;
  if (!raw) return DEFAULT_MAX_ENCODE_BODY_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid TENDERLY_ENCODE_MAX_BODY_BYTES="${raw}", using default ${DEFAULT_MAX_ENCODE_BODY_BYTES}`,
    );
    return DEFAULT_MAX_ENCODE_BODY_BYTES;
  }
  return parsed;
})();

type EncodeEntry = { address: string; key: string; value: string };

/**
 * Split a state-overrides payload into chunks whose serialized body stays under
 * MAX_ENCODE_BODY_BYTES. Every chunk holds at least one entry, even if that entry alone exceeds the
 * budget (a single oversized value is still far below the endpoint's hard limit).
 */
function chunkStateOverrides(payload: StateOverridesPayload): StateOverridesPayload[] {
  const entries: EncodeEntry[] = [];
  for (const [address, { value }] of Object.entries(payload.stateOverrides)) {
    for (const [key, val] of Object.entries(value)) {
      entries.push({ address, key, value: val });
    }
  }

  const chunks: EncodeEntry[][] = [];
  let current: EncodeEntry[] = [];
  let currentBytes = 0;
  // Approximate per-entry serialized cost: "key":"value", plus quotes/colon/comma.
  const entrySize = (e: EncodeEntry) => e.key.length + e.value.length + 8;

  for (const entry of entries) {
    const size = entrySize(entry);
    if (current.length > 0 && currentBytes + size > MAX_ENCODE_BODY_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunkEntries) => {
    const stateOverrides: StateOverridesPayload['stateOverrides'] = {};
    for (const { address, key, value } of chunkEntries) {
      if (!stateOverrides[address]) stateOverrides[address] = { value: {} };
      stateOverrides[address].value[key] = value;
    }
    return { networkID: payload.networkID, stateOverrides };
  });
}

function mergeEncodingResponses(responses: StorageEncodingResponse[]): StorageEncodingResponse {
  const merged: StorageEncodingResponse = { stateOverrides: {} };
  for (const response of responses) {
    for (const [address, { value }] of Object.entries(response.stateOverrides)) {
      const existing = merged.stateOverrides[address];
      merged.stateOverrides[address] = {
        ...existing,
        value: { ...(existing?.value ?? {}), ...value },
      };
    }
  }
  return merged;
}

async function sendEncodeChunk(payload: StateOverridesPayload): Promise<StorageEncodingResponse> {
  const fetchOptions = <Partial<FETCH_OPT>>{
    method: 'POST',
    data: payload,
    ...getTenderlyFetchOptions(),
  };
  const rawResponse = await fetchUrlWithTimeout(
    `Tenderly sendEncodeRequest(${payload.networkID})`,
    getTenderlyEncodeUrl(),
    fetchOptions,
  );
  return parseWithSchema(
    tenderlyStorageEncodingSchema,
    rawResponse,
    'Tenderly storage encoding response',
  );
}

export async function sendEncodeRequest(
  payload: StateOverridesPayload,
): Promise<StorageEncodingResponse> {
  try {
    const chunks = chunkStateOverrides(payload);
    if (chunks.length <= 1) {
      return await sendEncodeChunk(payload);
    }
    const responses: StorageEncodingResponse[] = [];
    for (const chunk of chunks) {
      responses.push(await sendEncodeChunk(chunk));
    }
    return mergeEncodingResponses(responses);
  } catch (err) {
    console.log('logging sendEncodeRequest error');
    console.log(JSON.stringify(err, null, 2));
    console.log(JSON.stringify(payload));
    throw err;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sendSimulation(
  payload: TenderlyPayload,
  delay = 1000,
): Promise<TenderlySimulation> {
  const fetchOptions = <Partial<FETCH_OPT>>{
    method: 'POST',
    data: payload,
    ...getTenderlyFetchOptions(),
  };
  try {
    const rawSim = await fetchUrlWithTimeout(
      `Tenderly sendSimulation(${payload.network_id})`,
      getTenderlySimUrl(),
      fetchOptions,
    );
    const sim = parseWithSchema(tenderlySimulationSchema, rawSim, 'Tenderly simulate response');

    sim.transaction.addresses = sim.transaction.addresses.map(getAddress);
    for (const contract of sim.contracts) {
      contract.address = getAddress(contract.address);
    }

    return sim;
  } catch (err) {
    console.log('err in sendSimulation: ', JSON.stringify(err));
    const is429 = (err as TenderlyError)?.statusCode === 429;
    const isTimeout = isTenderlyTimeoutError(err);
    if (delay > 8000 || (!is429 && !isTimeout)) {
      console.warn('Simulation request failed with the below request payload and error');
      console.log(JSON.stringify(fetchOptions));
      throw err;
    }
    console.warn(err);
    console.warn(
      `Simulation request failed with the above error, retrying in ~${delay} milliseconds. See request payload below`,
    );
    console.log(JSON.stringify(payload));
    await sleep(delay + randomInt(0, 1000));
    return await sendSimulation(payload, delay * 2);
  }
}
