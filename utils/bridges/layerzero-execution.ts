import { type Address, type Hex, getAddress, isHex } from 'viem';
import { getClientForChain } from '../clients/client';
import type {
  CrossChainBridgeExecutionContext,
  CrossChainBridgePreparedExecution,
} from './adapter';
import { LAYER_ZERO_TRUSTED_REMOTE_LOOKUP_ABI } from './layerzero';

const ADDRESS_BYTE_LENGTH = 20;
const HEX_PREFIX_LENGTH = 2;
const ADDRESS_HEX_LENGTH = ADDRESS_BYTE_LENGTH * 2;
const ADDRESS_LENGTH = HEX_PREFIX_LENGTH + ADDRESS_HEX_LENGTH;
const TRUSTED_REMOTE_PATH_LENGTH = HEX_PREFIX_LENGTH + ADDRESS_HEX_LENGTH * 2;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function readPackedAddress(value: Hex, byteOffset: number): Address | null {
  const start = HEX_PREFIX_LENGTH + byteOffset * 2;
  const end = start + ADDRESS_HEX_LENGTH;
  if (value.length < end) return null;

  const address = `0x${value.slice(start, end)}`;
  if (!isHex(address) || address.length !== ADDRESS_LENGTH) return null;

  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

function formatTrustedRemote(value: Hex): string {
  if (value === '0x') return 'unset';

  const remote = readPackedAddress(value, 0);
  const local = value.length >= TRUSTED_REMOTE_PATH_LENGTH ? readPackedAddress(value, 20) : null;

  if (remote && local && value.length === TRUSTED_REMOTE_PATH_LENGTH) {
    return `${remote} -> ${local}`;
  }

  return value;
}

export function layerZeroTrustedRemoteMatches(
  configuredTrustedRemote: Hex,
  expectedRemoteAddress: Address,
  receiverAddress: Address,
): boolean {
  const expectedRemote = getAddress(expectedRemoteAddress);
  const expectedLocal = getAddress(receiverAddress);

  return (
    configuredTrustedRemote.length === TRUSTED_REMOTE_PATH_LENGTH &&
    readPackedAddress(configuredTrustedRemote, 0) === expectedRemote &&
    readPackedAddress(configuredTrustedRemote, 20) === expectedLocal
  );
}

export async function prepareLayerZeroExecution(
  context: CrossChainBridgeExecutionContext,
): Promise<CrossChainBridgePreparedExecution> {
  const trustedRemote = context.job.layerZeroTrustedRemote;
  if (!trustedRemote) {
    throw new Error('LayerZero destination job is missing trusted remote metadata');
  }

  const client = getClientForChain(context.job.destinationChainId);
  const receiverAddress = context.job.l2FromAddress;
  const receiverState = context.workingState?.[getAddress(receiverAddress)];
  const receiverStorageOverrideCount = Object.keys(receiverState?.storage ?? {}).length;
  if (receiverStorageOverrideCount > 0) {
    throw new Error(
      `LayerZero receiver trusted remote read is ambiguous for chain ${context.job.destinationChainId}, receiver ${receiverAddress}: destination state overrides already modify ${receiverStorageOverrideCount} receiver storage slot(s), so Seatbelt cannot validate trustedRemoteLookup(${trustedRemote.sourceRemoteChainId}) against live RPC state`,
    );
  }

  let configuredTrustedRemote: Hex;

  try {
    const result = await client.readContract({
      address: receiverAddress,
      abi: LAYER_ZERO_TRUSTED_REMOTE_LOOKUP_ABI,
      functionName: 'trustedRemoteLookup',
      args: [trustedRemote.sourceRemoteChainId],
    });

    if (typeof result !== 'string' || !isHex(result)) {
      throw new Error(`invalid trustedRemoteLookup result ${String(result)}`);
    }

    configuredTrustedRemote = result;
  } catch (error) {
    throw new Error(
      `LayerZero receiver trusted remote read failed for chain ${context.job.destinationChainId}, receiver ${receiverAddress}, source remote chain ${trustedRemote.sourceRemoteChainId}: ${getErrorMessage(error)}`,
    );
  }

  if (
    !layerZeroTrustedRemoteMatches(
      configuredTrustedRemote,
      trustedRemote.expectedRemoteAddress,
      receiverAddress,
    )
  ) {
    throw new Error(
      `LayerZero receiver trusted remote mismatch for chain ${context.job.destinationChainId}: receiver ${receiverAddress} trusts ${formatTrustedRemote(configuredTrustedRemote)} for source remote chain ${trustedRemote.sourceRemoteChainId}, expected ${trustedRemote.expectedRemoteAddress}`,
    );
  }

  return { calls: context.job.calls };
}
