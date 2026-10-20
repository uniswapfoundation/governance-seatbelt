import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { type Hex, getAddress, pad, toHex } from 'viem';
import type { CallTrace, StateDiff, TenderlyPayload, TenderlySimulation } from '../../types';
import { z } from '../validation/zod';
import { getChainConfig } from './client';
import { getRpcAssetChanges } from './rpc-assets';
import { getRpcBalanceSnapshots } from './rpc-balances';

// QuickNode limits traces to 25/s. Share a 20/s queue across simulations on each endpoint.
const traceQueues = new Map<string, Promise<void>>();

export class SimulationRpcError extends Error {}

export async function simulationRpc<T>(
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  try {
    const url = getChainConfig(chainId).rpcUrl;
    for (let attempt = 0; ; attempt++) {
      if (method.startsWith('debug_trace')) {
        const slot = (traceQueues.get(url) ?? Promise.resolve()).then(() => delay(50));
        traceQueues.set(url, slot);
        await slot;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = response.ok
        ? z
            .object({
              result: z.unknown().optional(),
              error: z.object({ code: z.number() }).optional(),
            })
            .parse(await response.json())
        : undefined;
      if (!response.ok) await response.body?.cancel();
      if ((response.status === 429 || body?.error?.code === -32009) && attempt < 3) {
        const retryAfter = response.headers.get('retry-after');
        const retryMs = retryAfter
          ? /^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - Date.now()
          : 0;
        await delay(Math.min(30_000, Math.max(1000 * 2 ** attempt, retryMs || 0)));
        continue;
      }
      if (!response.ok || body?.error || body?.result === undefined)
        throw new Error('RPC request failed');
      return body.result as T;
    }
  } catch {
    // Transport errors can contain credential-bearing endpoint URLs.
    throw new SimulationRpcError(`Simulation RPC ${method} failed on chain ${chainId}`);
  }
}

export type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  index?: number | string;
  position?: Hex;
};
export type RpcTrace = {
  from: string;
  to?: string;
  input: string;
  type: string;
  value?: string;
  gasUsed: string;
  error?: string;
  revertReason?: string;
  calls?: RpcTrace[];
  logs?: RpcLog[];
};
export type RpcAccount = { code?: Hex; balance?: Hex; nonce?: number; storage?: Record<Hex, Hex> };

export async function sendRpcSimulation(payload: TenderlyPayload): Promise<TenderlySimulation> {
  const chainId = Number(payload.network_id);
  if (Number(BigInt(await simulationRpc<Hex>(chainId, 'eth_chainId', []))) !== chainId) {
    throw new Error(`Simulation RPC chain identity mismatch for ${chainId}`);
  }
  if (
    payload.contracts?.length ||
    (payload.transaction_index !== undefined && !payload.transaction_hash)
  ) {
    throw new Error('RPC replay requires a transaction hash; source overrides are unsupported');
  }
  if (
    payload.transaction_hash &&
    (Object.keys(payload.state_objects ?? {}).length || payload.block_header)
  ) {
    throw new Error(
      'Historical transaction replay cannot apply hypothetical state or block overrides',
    );
  }
  const blockNumber =
    payload.block_number ??
    Number(BigInt(await simulationRpc<Hex>(chainId, 'eth_blockNumber', [])));
  const baseBlock = toHex(blockNumber);
  const block = await simulationRpc<{
    timestamp: Hex;
    baseFeePerGas?: Hex | null;
    transactions: Hex[];
  }>(chainId, 'eth_getBlockByNumber', [baseBlock, false]);
  // Synthetic calls use the pinned block's fee, never a quote from today's chain head.
  let gasPrice = payload.gas_price;
  if (gasPrice === undefined && !payload.transaction_hash) {
    if (block.baseFeePerGas != null) {
      gasPrice = BigInt(block.baseFeePerGas).toString();
    } else {
      const transaction = block.transactions[0];
      if (!transaction)
        throw new Error('Pinned legacy block has no transaction to infer gas price');
      const mined = await simulationRpc<{ gasPrice: Hex }>(chainId, 'eth_getTransactionByHash', [
        transaction,
      ]);
      gasPrice = BigInt(mined.gasPrice).toString();
    }
  }
  const states = Object.fromEntries(
    Object.entries(payload.state_objects ?? {}).map(([address, state]) => [
      getAddress(address),
      {
        ...(state.balance !== undefined ? { balance: toHex(BigInt(state.balance)) } : {}),
        ...(state.nonce !== undefined ? { nonce: toHex(state.nonce) } : {}),
        ...(state.code !== undefined ? { code: state.code } : {}),
        ...(state.storage ? { stateDiff: state.storage } : {}),
      },
    ]),
  );
  // These clients debit the allowance before execution. Exactly funding it preserves
  // a simulated bridge caller's EVM-visible balance. OP clients skip that debit.
  const debitsGasUpfront = [1, 137, 143, 196, 42161, 42220, 43114, 4326, 4663].includes(chainId);
  const sponsorGas =
    !payload.transaction_hash &&
    (payload.fund_synthetic_sender || (debitsGasUpfront && chainId !== 1));
  // Arc traceCall refunds unused gas without debiting the allowance upfront.
  const gasAllowance = BigInt(payload.gas) * BigInt(gasPrice ?? 0);
  const gasFunding = sponsorGas && debitsGasUpfront ? gasAllowance : 0n;
  if (sponsorGas) {
    const sender = getAddress(payload.from);
    const state = states[sender] ?? {};
    const balance = BigInt(
      state.balance ?? (await simulationRpc<Hex>(chainId, 'eth_getBalance', [sender, baseBlock])),
    );
    if (balance < BigInt(payload.value ?? 0)) {
      throw new Error('Executor has insufficient balance for call value');
    }
    states[sender] = {
      ...state,
      balance: toHex(balance + gasFunding),
    };
  }
  const call = {
    from: payload.from,
    to: payload.to,
    input: payload.input,
    gas: toHex(payload.gas),
    gasPrice: toHex(BigInt(gasPrice ?? 0)),
    value: toHex(BigInt(payload.value ?? 0)),
  };
  const blockOverrides = {
    ...(payload.block_header?.number ? { number: payload.block_header.number } : {}),
    ...(payload.block_header?.timestamp ? { time: payload.block_header.timestamp } : {}),
  };
  const options = { stateOverrides: states, blockOverrides };
  const traceWith = <T>(tracerOptions: Record<string, unknown>) =>
    payload.transaction_hash
      ? simulationRpc<T>(chainId, 'debug_traceTransaction', [
          payload.transaction_hash,
          tracerOptions,
        ])
      : simulationRpc<T>(chainId, 'debug_traceCall', [
          call,
          baseBlock,
          { ...options, ...tracerOptions },
        ]);
  const trace = await traceWith<RpcTrace>({
    tracer: 'callTracer',
    tracerConfig: { withLog: true },
  });
  const diff = await traceWith<{
    pre: Record<string, RpcAccount>;
    post: Record<string, RpcAccount>;
  }>({
    tracer: 'prestateTracer',
    tracerConfig: { diffMode: true },
  });
  const accounts = await traceWith<Record<string, RpcAccount>>({ tracer: 'prestateTracer' });
  // Nitro exposes internal fee accounting as a fictional account. Its RPC forbids
  // overriding it; only EVM account state can be carried to the next call.
  if (chainId === 42161 || chainId === 4663) {
    const arbos = '0xa4b05fffffffffffffffffffffffffffffffffff';
    delete accounts[arbos];
    delete diff.pre[arbos];
    delete diff.post[arbos];
  }
  const logs: RpcLog[] = [];
  const addresses = new Set<string>([getAddress(payload.from), getAddress(payload.to)]);
  function normalizeCall(frame: RpcTrace, parentCommitted = true): CallTrace {
    const committed = parentCommitted && !frame.error;
    addresses.add(getAddress(frame.from));
    if (frame.to) addresses.add(getAddress(frame.to));
    const children = frame.calls ?? [];
    const calls: CallTrace[] = [];
    for (let i = 0; i <= children.length; i++) {
      if (committed)
        logs.push(...(frame.logs ?? []).filter((log) => Number(BigInt(log.position ?? 0)) === i));
      if (children[i]) calls.push(normalizeCall(children[i], committed));
    }
    return {
      from: frame.from,
      to: frame.to,
      input: frame.input,
      type: frame.type,
      value: frame.value,
      error_reason: frame.revertReason ?? frame.error,
      calls,
    };
  }
  const callTrace = normalizeCall(trace);
  if (logs.every((log) => log.index !== undefined))
    logs.sort((a, b) => Number(BigInt(a.index!)) - Number(BigInt(b.index!)));
  const stateDiff: StateDiff[] = [];
  const contracts: TenderlySimulation['contracts'] = [];
  const postState: NonNullable<TenderlySimulation['postState']> = {};
  const word = (value: Hex | undefined) => pad(value ?? '0x0', { size: 32 });
  for (const address of new Set([
    ...Object.keys(accounts),
    ...Object.keys(diff.pre),
    ...Object.keys(diff.post),
  ])) {
    addresses.add(getAddress(address));
    const pre = diff.pre[address];
    const post = diff.post[address];
    if (pre || post) {
      const deleted = !!pre && !post;
      postState[getAddress(address)] = {
        ...(post?.balance !== undefined
          ? { balance: BigInt(post.balance).toString() }
          : deleted
            ? { balance: '0' }
            : {}),
        ...(post?.code !== undefined ? { code: post.code } : deleted ? { code: '0x' } : {}),
        ...(post?.nonce !== undefined ? { nonce: post.nonce } : deleted ? { nonce: 0 } : {}),
        storage: {},
      };
    }
    for (const key of new Set([
      ...Object.keys(pre?.storage ?? {}),
      ...Object.keys(post?.storage ?? {}),
    ])) {
      const original = word(pre?.storage?.[key as Hex]);
      const dirty = word(post?.storage?.[key as Hex]);
      postState[getAddress(address)].storage![key] = dirty;
      stateDiff.push({ soltype: null, original, dirty, raw: [{ address, key, original, dirty }] });
    }
    const code = post?.code ?? accounts[address]?.code ?? pre?.code;
    if (code && code !== '0x') {
      contracts.push({
        address: getAddress(address),
        contract_name: '',
        deployed_bytecode: code,
      });
    }
  }
  // Remove gas refunds from sponsored execution. Arc also needs its uncharged
  // allowance removed for ordinary trace calls, so their balance includes the real fee.
  if (!payload.transaction_hash && (chainId === 5042 || (sponsorGas && debitsGasUpfront))) {
    const sender = getAddress(payload.from);
    const correction = sponsorGas
      ? gasAllowance - BigInt(trace.gasUsed) * BigInt(gasPrice ?? 0)
      : gasAllowance;
    const balance = postState[sender]?.balance ?? accounts[sender.toLowerCase()]?.balance;
    if (balance !== undefined)
      postState[sender] = {
        ...postState[sender],
        balance: (BigInt(balance) - correction).toString(),
      };
  }
  const assets = await getRpcAssetChanges(trace, logs, chainId, BigInt(blockNumber));
  const balances = await getRpcBalanceSnapshots({
    payload,
    trace,
    accounts,
    postState,
    changes: assets.changes,
    blockNumber,
    blockOverrides,
    gasFunding,
  });
  const id = `rpc-${randomUUID()}`;
  return {
    provider: 'rpc',
    postState,
    assetWarnings: [...assets.warnings, ...balances.warnings],
    assetBalances: balances.rows,
    assetBalanceHistoricalReplay: Boolean(payload.transaction_hash),
    assetBalanceUnavailableTokens: balances.unavailableTokens,
    gasSponsored: Boolean(sponsorGas),
    simulation: {
      id,
      network_id: String(chainId),
      block_number: blockNumber,
      from: payload.from,
      to: payload.to,
      input: payload.input,
      gas: payload.gas,
      gas_price: gasPrice ?? '0',
      value: payload.value ?? '0',
      status: !trace.error,
    },
    transaction: {
      block_number: blockNumber,
      from: getAddress(payload.from),
      to: getAddress(payload.to),
      value: payload.value ?? '0',
      input: payload.input,
      status: !trace.error,
      gas_used: Number(BigInt(trace.gasUsed)),
      addresses: [...addresses],
      network_id: String(chainId),
      timestamp: new Date(
        Number(BigInt(payload.block_header?.timestamp ?? block.timestamp)) * 1000,
      ),
      transaction_info: {
        call_trace: callTrace,
        logs: logs.map(({ address, topics, data }) => ({
          name: null,
          anonymous: false,
          inputs: [],
          raw: { address, topics, data },
        })),
        state_diff: stateDiff,
        asset_changes: assets.changes,
        balance_changes: null,
      },
    },
    contracts,
    generated_access_list: [],
  };
}
