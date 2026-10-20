import { type Address, formatUnits, getAddress, keccak256, parseAbi, stringToHex } from 'viem';
import type { AssetChange } from '../../types';
import { getClientForChain } from './client';
import type { RpcLog, RpcTrace } from './rpc-simulation';

export const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ARC_NATIVE_TRANSFER_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';

const transferTopic = keccak256(stringToHex('Transfer(address,address,uint256)'));
const tokenAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

/** Transfers are execution evidence, not a complete accounting of rebasing or custom tokens. */
export async function getRpcAssetChanges(
  trace: RpcTrace,
  logs: RpcLog[],
  chainId: number,
  blockNumber: bigint,
): Promise<{ changes: AssetChange[]; warnings: string[] }> {
  const changes: AssetChange[] = [];
  const warnings: string[] = [];
  const client = getClientForChain(chainId);
  const native = client.chain.nativeCurrency;
  const nativeToken = {
    standard: 'NativeCurrency',
    type: 'Native',
    symbol: native.symbol,
    name: native.name,
    decimals: native.decimals,
    logo: '',
    dollar_value: '',
  };
  function add(from: string, to: string, raw: bigint, token: AssetChange['token_info']) {
    changes.push({
      from: getAddress(from),
      to: getAddress(to),
      type: 'Transfer',
      raw_amount: raw.toString(),
      amount: formatUnits(raw, token.decimals),
      token_info: token,
      dollar_value: '',
    });
  }
  function visit(frame: RpcTrace) {
    if (frame.error) return;
    const value = BigInt(frame.value ?? 0);
    if (
      frame.to &&
      value > 0n &&
      ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(frame.type.toUpperCase())
    ) {
      add(frame.from, frame.to, value, nativeToken);
    }
    for (const child of frame.calls ?? []) visit(child);
  }
  visit(trace);
  const tokens = new Map<Address, AssetChange['token_info']>();
  for (const log of logs) {
    if (
      log.topics[0]?.toLowerCase() !== transferTopic ||
      log.topics.length !== 3 ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data)
    )
      continue;
    if (chainId === 5042 && log.address.toLowerCase() === ARC_NATIVE_TRANSFER_EMITTER) continue;
    if (chainId === 5042 && log.address.toLowerCase() === ARC_USDC) {
      // ERC-20 USDC transfers change the native balance and use six decimal places.
      // Ignore the duplicate system event; ordinary native calls are covered by the trace.
      add(
        `0x${log.topics[1].slice(-40)}`,
        `0x${log.topics[2].slice(-40)}`,
        BigInt(log.data) * 10n ** 12n,
        nativeToken,
      );
      continue;
    }
    const address = getAddress(log.address);
    let token = tokens.get(address);
    if (!token) {
      let symbol = `${address} (raw units)`;
      let decimals = 0;
      try {
        decimals = await client.readContract({
          address,
          abi: tokenAbi,
          functionName: 'decimals',
          blockNumber,
        });
        try {
          symbol = await client.readContract({
            address,
            abi: tokenAbi,
            functionName: 'symbol',
            blockNumber,
          });
        } catch {
          symbol = address;
        }
      } catch {
        warnings.push(`Token metadata unavailable for ${address}; amounts are raw base units.`);
      }
      token = {
        standard: 'ERC20',
        contract_address: address,
        type: 'Fungible',
        symbol: symbol.slice(0, 96),
        name: address,
        decimals,
        logo: '',
        dollar_value: '',
      };
      tokens.set(address, token);
    }
    add(`0x${log.topics[1].slice(-40)}`, `0x${log.topics[2].slice(-40)}`, BigInt(log.data), token);
  }
  return { changes, warnings };
}
