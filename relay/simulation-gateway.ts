import { createHash, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { RPC_ENV_BY_CHAIN, configuredRpc } from '../utils/chains/rpc-endpoints.js';
import { readRequestBody } from './http.js';
import { runUpstashCommand } from './redis.js';

const methods = [
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_call',
  'debug_traceCall',
  'debug_traceTransaction',
] as const;
const chainId = z
  .number()
  .int()
  .positive()
  .refine((id) => Object.hasOwn(RPC_ENV_BY_CHAIN, id));
const rpcSchema = z
  .object({ chainId, method: z.enum(methods), params: z.array(z.unknown()).max(4) })
  .strict();
const explorerSchema = z
  .object({
    chainId,
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    action: z.enum(['getabi', 'getsourcecode', 'blockscout']),
  })
  .strict();

// Check every quota before spending any allowance. Redis makes this atomic across instances.
const quotaScript = `
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i * 2]) then
    return math.max(1, redis.call('TTL', key))
  end
end
for i, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ARGV[i * 2 - 1]) end
end
return 0`;

function reply(status: number, message: string, retryAfter?: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}),
      },
    },
  );
}

export function createSimulationGateway(env: Record<string, string | undefined>) {
  async function quota(chain: number, trace: boolean, explorer: boolean): Promise<number> {
    const restUrl = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    if (!restUrl || !token) throw new Error('Shared limits unavailable');
    const dailyLimit = Number(env.SEATBELT_REQUESTS_PER_DAY || 100_000);
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) throw new Error('Invalid quota');
    const limits: [string, number, number][] = [
      ['day', 86400, dailyLimit],
      ['minute', 60, 6000],
      ...(trace ? [[`trace:${chain}`, 1, 20] as [string, number, number]] : []),
      ...(explorer ? [['explorer', 1, 3] as [string, number, number]] : []),
    ];
    const result = await runUpstashCommand(restUrl, token, [
      'EVAL',
      quotaScript,
      String(limits.length),
      ...limits.map(([key]) => `seatbelt:gateway:${key}`),
      ...limits.flatMap(([, seconds, count]) => [String(seconds), String(count)]),
    ]);
    if (typeof result !== 'number' || result < 0) throw new Error('Shared limits unavailable');
    return result;
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply(405, 'Use POST');
    const hash = env.SEATBELT_ACCESS_CODE_SHA256;
    if (!hash || !/^[a-f0-9]{64}$/.test(hash))
      return reply(503, 'Managed access is not configured');
    const code = request.headers.get('authorization')?.match(/^Bearer ([\x21-\x7e]{24,256})$/)?.[1];
    if (
      !code ||
      !timingSafeEqual(createHash('sha256').update(code).digest(), Buffer.from(hash, 'hex'))
    ) {
      return reply(401, 'Access code required');
    }
    const route = new URL(request.url).pathname;
    if (route === '/api/v1/access') {
      if (
        !env.UPSTASH_REDIS_REST_URL ||
        !env.UPSTASH_REDIS_REST_TOKEN ||
        !configuredRpc(1, env) ||
        !env.ETHERSCAN_API_KEY
      ) {
        return reply(503, 'Managed access is not configured');
      }
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readRequestBody(request, 1024 * 1024));
    } catch (error) {
      return reply(
        error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
        'Invalid or oversized request',
      );
    }
    let upstream: string;
    let init: RequestInit;
    let trace = false;
    let chain: number;
    const isRpc = route === '/api/v1/rpc';
    if (isRpc) {
      const parsed = rpcSchema.safeParse(payload);
      if (!parsed.success) return reply(400, 'Unsupported RPC request');
      const { chainId, method, params } = parsed.data;
      chain = chainId;
      upstream = configuredRpc(chainId, env);
      if (!upstream) return reply(503, `Chain ${chainId} is not configured`);
      trace = method.startsWith('debug_trace');
      if (trace) {
        const index = method === 'debug_traceCall' ? 2 : 1;
        const options = z
          .object({
            tracer: z.enum(['callTracer', 'prestateTracer']),
            tracerConfig: z
              .object({ withLog: z.boolean().optional(), diffMode: z.boolean().optional() })
              .strict()
              .optional(),
            stateOverrides: z.record(z.string(), z.unknown()).optional(),
            blockOverrides: z.record(z.string(), z.unknown()).optional(),
          })
          .strict()
          .safeParse(params[index]);
        if (!options.success) return reply(400, 'Unsupported trace options');
        params[index] = { ...options.data, timeout: '20s' };
      }
      if (method === 'debug_traceCall' || method === 'eth_call') {
        const call = z
          .object({
            gas: z
              .string()
              .regex(/^0x[0-9a-fA-F]+$/)
              .optional(),
          })
          .passthrough()
          .safeParse(params[0]);
        if (!call.success || (call.data.gas && BigInt(call.data.gas) > 30_000_000n))
          return reply(400, 'Call exceeds simulation gas limit');
        params[0] = { ...call.data, gas: call.data.gas ?? '0x1c9c380' };
      }
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      };
    } else {
      const parsed = explorerSchema.safeParse(payload);
      if (!parsed.success) return reply(400, 'Unsupported explorer request');
      const { chainId, address, action } = parsed.data;
      chain = chainId;
      if (action === 'blockscout') {
        // Arc is the only configured fallback that needs a private Blockscout key.
        if (chainId !== 5042 || !env.BLOCKSCOUT_API_KEY) return reply(503, 'Explorer unavailable');
        upstream = `https://api.blockscout.com/5042/api/v2/smart-contracts/${address}`;
        init = { headers: { authorization: `Bearer ${env.BLOCKSCOUT_API_KEY}` } };
      } else {
        if (!env.ETHERSCAN_API_KEY) return reply(503, 'Explorer unavailable');
        const url = new URL('https://api.etherscan.io/v2/api');
        url.search = new URLSearchParams({
          chainid: String(chainId),
          module: 'contract',
          action,
          address,
          apikey: env.ETHERSCAN_API_KEY,
        }).toString();
        upstream = url.toString();
        init = {};
      }
    }
    try {
      const retry = await quota(chain, trace, !isRpc);
      if (retry) return reply(429, 'Seatbelt usage limit reached', retry);
    } catch {
      return reply(503, 'Shared usage limits unavailable');
    }
    try {
      const response = await fetch(upstream, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return reply(
          response.status === 429 ? 429 : 502,
          'Provider request unavailable',
          response.status === 429 ? 1 : undefined,
        );
      }
      const data = JSON.parse(await readRequestBody(response, 32 * 1024 * 1024));
      // Never forward a provider's credential-bearing transport/error messages.
      if (isRpc && data.error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: Number(data.error.code) || -32603,
              message: 'Provider rejected request',
            },
          },
          { headers: { 'cache-control': 'no-store' } },
        );
      }
      if (!isRpc && data.status === '0' && data.result !== 'Contract source code not verified') {
        return reply(502, 'Explorer lookup unavailable');
      }
      const bytes = gzipSync(JSON.stringify(data));
      if (bytes.byteLength > 4 * 1024 * 1024)
        return reply(502, 'Provider response exceeds relay limit');
      return new Response(bytes, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return reply(502, 'Provider request failed');
    }
  };
}
