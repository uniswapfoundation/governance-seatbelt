import { randomUUID } from 'node:crypto';
import { type Hex, getAddress, pad, toHex } from 'viem';
import type { CallTrace, StateDiff, TenderlyPayload, TenderlySimulation } from '../../types';
import { z } from '../validation/zod';
import { BlockExplorerFactory } from './block-explorers/factory';
import { getChainConfig } from './client';

export async function simulationRpc<T>(
  chainId: number,
  method: string,
  params: unknown[],
): Promise<T> {
  try {
    const response = await fetch(getChainConfig(chainId).rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = z
      .object({ result: z.unknown().optional(), error: z.object({ code: z.number() }).optional() })
      .parse(await response.json());
    if (body.error) throw new Error(`JSON-RPC ${body.error.code}`);
    if (body.result === undefined) throw new Error('Missing result');
    return body.result as T;
  } catch {
    // Transport errors can contain credential-bearing endpoint URLs.
    throw new Error(`Simulation RPC ${method} failed on chain ${chainId}`);
  }
}

type RpcLog = {
  address: string;
  topics: string[];
  data: string;
  index?: number | string;
  position?: Hex;
};
type RpcTrace = {
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
type RpcAccount = { code?: Hex; balance?: Hex; nonce?: number; storage?: Record<Hex, Hex> };

export async function sendRpcSimulation(payload: TenderlyPayload): Promise<TenderlySimulation> {
  const chainId = Number(payload.network_id);
  if (Number(BigInt(await simulationRpc<Hex>(chainId, 'eth_chainId', []))) !== chainId) {
    throw new Error(`Simulation RPC chain identity mismatch for ${chainId}`);
  }
  if (payload.transaction_index !== undefined || payload.contracts?.length) {
    throw new Error('RPC simulation does not support transaction-index replay or source overrides');
  }
  const blockNumber =
    payload.block_number ??
    Number(BigInt(await simulationRpc<Hex>(chainId, 'eth_blockNumber', [])));
  const baseBlock = toHex(blockNumber);
  const block = await simulationRpc<{ timestamp: Hex }>(chainId, 'eth_getBlockByNumber', [
    baseBlock,
    false,
  ]);
  const states = Object.fromEntries(
    Object.entries(payload.state_objects ?? {}).map(([address, state]) => [
      getAddress(address),
      {
        ...(state.balance !== undefined ? { balance: toHex(BigInt(state.balance)) } : {}),
        ...(state.code !== undefined ? { code: state.code } : {}),
        ...(state.storage ? { stateDiff: state.storage } : {}),
      },
    ]),
  );
  const call = {
    from: payload.from,
    to: payload.to,
    input: payload.input,
    gas: toHex(payload.gas),
    gasPrice: '0x0',
    value: toHex(BigInt(payload.value ?? 0)),
  };
  const blockOverrides = {
    baseFeePerGas: '0x0',
    ...(payload.block_header?.number ? { number: payload.block_header.number } : {}),
    ...(payload.block_header?.timestamp ? { time: payload.block_header.timestamp } : {}),
  };
  const options = { stateOverrides: states, blockOverrides };
  const trace = await simulationRpc<RpcTrace>(chainId, 'debug_traceCall', [
    call,
    baseBlock,
    { ...options, tracer: 'callTracer', tracerConfig: { withLog: true } },
  ]);
  const diff = await simulationRpc<{
    pre: Record<string, RpcAccount>;
    post: Record<string, RpcAccount>;
  }>(chainId, 'debug_traceCall', [
    call,
    baseBlock,
    { ...options, tracer: 'prestateTracer', tracerConfig: { diffMode: true } },
  ]);
  const accounts = await simulationRpc<Record<string, RpcAccount>>(chainId, 'debug_traceCall', [
    call,
    baseBlock,
    { ...options, tracer: 'prestateTracer' },
  ]);
  const logs: RpcLog[] = [];
  const addresses = new Set<string>([getAddress(payload.from), getAddress(payload.to)]);
  function normalizeCall(frame: RpcTrace): CallTrace {
    addresses.add(getAddress(frame.from));
    if (frame.to) addresses.add(getAddress(frame.to));
    const children = frame.calls ?? [];
    const calls: CallTrace[] = [];
    for (let i = 0; i <= children.length; i++) {
      logs.push(...(frame.logs ?? []).filter((log) => Number(BigInt(log.position ?? 0)) === i));
      if (children[i]) calls.push(normalizeCall(children[i]));
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
  const word = (value: Hex | undefined) => pad(value ?? '0x0', { size: 32 });
  for (const address of new Set([
    ...Object.keys(accounts),
    ...Object.keys(diff.pre),
    ...Object.keys(diff.post),
  ])) {
    addresses.add(getAddress(address));
    const pre = diff.pre[address];
    const post = diff.post[address];
    for (const key of new Set([
      ...Object.keys(pre?.storage ?? {}),
      ...Object.keys(post?.storage ?? {}),
    ])) {
      const original = word(pre?.storage?.[key as Hex]);
      const dirty = word(post?.storage?.[key as Hex]);
      stateDiff.push({ soltype: null, original, dirty, raw: [{ address, key, original, dirty }] });
    }
    const code = accounts[address]?.code ?? pre?.code ?? post?.code;
    if (code && code !== '0x') {
      contracts.push({
        address: getAddress(address),
        contract_name: (await BlockExplorerFactory.fetchContractName(address, chainId)) ?? '',
        deployed_bytecode: code,
      });
    }
  }
  const id = `rpc-${randomUUID()}`;
  return {
    provider: 'rpc',
    simulation: {
      id,
      network_id: String(chainId),
      block_number: blockNumber,
      from: payload.from,
      to: payload.to,
      input: payload.input,
      gas: payload.gas,
      gas_price: '0',
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
        asset_changes: null,
        balance_changes: null,
      },
    },
    contracts,
    generated_access_list: [],
  };
}
