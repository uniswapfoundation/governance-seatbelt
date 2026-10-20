import {
  type Hex,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toHex,
} from 'viem';
import type {
  AssetBalanceSnapshot,
  AssetChange,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types';
import { mergeStateObjects } from '../derived-state';
import { getClientForChain } from './client';
import { type RpcAccount, type RpcTrace, simulationRpc } from './rpc-simulation';

const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
]);

/** Reads the same pinned state and overrides used for execution, never today's balances. */
export async function getRpcBalanceSnapshots({
  payload,
  trace,
  accounts,
  postState,
  changes,
  blockNumber,
  blockOverrides,
  gasAllowance,
}: {
  payload: TenderlyPayload;
  trace: RpcTrace;
  accounts: Record<string, RpcAccount>;
  postState: NonNullable<TenderlySimulation['postState']>;
  changes: AssetChange[];
  blockNumber: number;
  blockOverrides: Record<string, string>;
  gasAllowance: bigint;
}): Promise<{
  rows: AssetBalanceSnapshot[];
  warnings: string[];
  unavailableTokens: { tokenAddress: string; reason: string }[];
}> {
  const chainId = Number(payload.network_id);
  const native = getClientForChain(chainId).chain.nativeCurrency;
  const rows: AssetBalanceSnapshot[] = [];
  const warnings: string[] = [];
  const unavailableTokens: { tokenAddress: string; reason: string }[] = [];
  const sender = getAddress(payload.from);
  const holders = new Set<string>([sender, getAddress(payload.to)]);
  const candidates = new Set<string>();
  function visit(frame: RpcTrace) {
    holders.add(getAddress(frame.from));
    if (frame.to) {
      holders.add(getAddress(frame.to));
      if (frame.type === 'CALL' || frame.type === 'STATICCALL')
        candidates.add(getAddress(frame.to));
    }
    try {
      const decoded = decodeFunctionData({ abi: tokenAbi, data: frame.input as Hex });
      for (const arg of decoded.args ?? [])
        if (typeof arg === 'string') holders.add(getAddress(arg));
    } catch {
      /* Other contract methods are not token-holder evidence. */
    }
    for (const child of frame.calls ?? []) visit(child);
  }
  visit(trace);
  for (const change of changes) {
    holders.add(change.from);
    holders.add(change.to);
    if (change.token_info.contract_address)
      candidates.add(getAddress(change.token_info.contract_address));
  }
  holders.delete('0x0000000000000000000000000000000000000000');
  for (const [rawAddress, account] of Object.entries(accounts)) {
    const address = getAddress(rawAddress);
    let before = account.balance === undefined ? null : BigInt(account.balance);
    if (before !== null && address === sender) before -= gasAllowance;
    const afterValue = postState[address]?.balance;
    let after = afterValue === undefined ? before : BigInt(afterValue);
    if (address === sender && gasAllowance > 0n && chainId !== 1 && chainId !== 42220) {
      before = null;
      after = null;
      warnings.push('Artificial executor balance accounting is unavailable on this chain.');
    }
    rows.push({
      address,
      tokenAddress: null,
      symbol: native.symbol,
      decimals: native.decimals,
      before: before?.toString() ?? null,
      after: after?.toString() ?? null,
    });
  }
  // A block-level eth_call cannot establish a token's exact pre/post transaction state.
  if (payload.transaction_hash) {
    warnings.push(
      'Token balance snapshots are unavailable for historical transaction replay; Transfer events are observations, not measured token balance changes.',
    );
    return { rows, warnings, unavailableTokens };
  }
  const beforeState = payload.state_objects ?? {};
  const afterState = mergeStateObjects(beforeState, postState) ?? {};
  async function read(token: string, input: Hex, state: typeof beforeState): Promise<bigint> {
    const stateOverrides = Object.fromEntries(
      Object.entries(state).map(([address, value]) => [
        address,
        {
          ...(value.balance !== undefined ? { balance: toHex(BigInt(value.balance)) } : {}),
          ...(value.nonce !== undefined ? { nonce: toHex(value.nonce) } : {}),
          ...(value.code !== undefined ? { code: value.code } : {}),
          ...(value.storage ? { stateDiff: value.storage } : {}),
        },
      ]),
    );
    const result = await simulationRpc<{ output?: Hex; error?: string }>(
      chainId,
      'debug_traceCall',
      [
        { from: payload.from, to: token, input, gas: '0xf4240', gasPrice: '0x0' },
        toHex(blockNumber),
        { tracer: 'callTracer', stateOverrides, blockOverrides },
      ],
    );
    if (result.error || !result.output || !/^0x[0-9a-fA-F]{64}$/.test(result.output))
      throw new Error('Balance read unavailable');
    return BigInt(result.output);
  }
  for (const token of candidates) {
    const metadata = changes.find(
      (c) => c.token_info.contract_address?.toLowerCase() === token.toLowerCase(),
    )?.token_info;
    let decimals: number;
    try {
      const value = await read(
        token,
        encodeFunctionData({ abi: tokenAbi, functionName: 'decimals' }),
        afterState,
      );
      const beforeDecimals = await read(
        token,
        encodeFunctionData({ abi: tokenAbi, functionName: 'decimals' }),
        beforeState,
      );
      if (value > 255n || beforeDecimals !== value) {
        unavailableTokens.push({
          tokenAddress: token,
          reason: 'Token decimals changed or are unsupported',
        });
        warnings.push(
          `Token denomination changed or is unsupported for ${token}; balance changes are unavailable.`,
        );
        continue;
      }
      decimals = Number(value);
    } catch {
      if (metadata) {
        warnings.push(`Token balance reads unavailable for ${token}.`);
        unavailableTokens.push({ tokenAddress: token, reason: 'Token decimals could not be read' });
      }
      continue;
    }
    let symbol = metadata?.symbol ?? token;
    if (!metadata) {
      try {
        symbol = (
          await getClientForChain(chainId).readContract({
            address: token as Hex,
            abi: tokenAbi,
            functionName: 'symbol',
            blockNumber: BigInt(blockNumber),
          })
        ).slice(0, 96);
      } catch {
        /* The token address remains the identity when its symbol is unavailable. */
      }
    }
    for (const address of holders) {
      const input = encodeFunctionData({
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [address as Hex],
      });
      let before: string | null = null;
      let after: string | null = null;
      try {
        before = (await read(token, input, beforeState)).toString();
      } catch {
        /* Unknown is not zero. */
      }
      try {
        after = (await read(token, input, afterState)).toString();
      } catch {
        /* Unknown is not zero. */
      }
      rows.push({
        address,
        tokenAddress: token,
        symbol,
        decimals,
        before,
        after,
      });
      if (before !== null && after !== null) {
        const observed = changes
          .filter(
            (change) => change.token_info.contract_address?.toLowerCase() === token.toLowerCase(),
          )
          .reduce(
            (net, change) =>
              net +
              (change.to === address ? BigInt(change.raw_amount) : 0n) -
              (change.from === address ? BigInt(change.raw_amount) : 0n),
            0n,
          );
        if (BigInt(after) - BigInt(before) !== observed)
          warnings.push(
            `Measured balance change for ${address} in token ${token} differs from Transfer events.`,
          );
      }
    }
  }
  if (rows.some((row) => row.before === null || row.after === null))
    warnings.push('Some balance reads are unavailable; unknown balances are not treated as zero.');
  return { rows, warnings, unavailableTokens };
}
