import type { StorageEncodingResponse, TenderlyPayload, TenderlySimulation } from '../../types.d';
import { getClientForChain } from './client';
import { sendRpcSimulation } from './rpc-simulation';
import { encodeRpcState } from './rpc-storage';

// Keep the report contract compatible with saved simulations; execution uses RPC only.
export type StateOverridesPayload = {
  networkID: string;
  stateOverrides: Record<string, { value: Record<string, string> }>;
};

export async function getLatestBlock(chainId: number): Promise<number> {
  return Number(await getClientForChain(chainId).getBlockNumber());
}

export async function sendEncodeRequest(
  payload: StateOverridesPayload,
  blockNumber?: number,
): Promise<StorageEncodingResponse> {
  return encodeRpcState(payload, blockNumber);
}

export async function sendSimulation(payload: TenderlyPayload): Promise<TenderlySimulation> {
  return sendRpcSimulation(payload);
}
