import type { Address, Hex } from 'viem';
import { decodeFunctionData, getAddress } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types.d';
import type { ExtractedCrossChainMessage } from '../../types.d';
// Import the Polygon zkEVM bridge ABI
import PolygonZkEVMBridgeAbi from '../abis/PolygonZkEVMBridgeAbi.json' assert { type: 'json' };

// Polygon zkEVM bridge address
const POLYGON_ZKEVM_BRIDGE: Address = '0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe';

/**
 * Recursively searches the call trace for calls to Polygon zkEVM bridge.
 */
function findPolygonZkEVMBridgeCalls(call: CallTrace): CallTrace[] {
  let bridgeCalls: CallTrace[] = [];

  // Check if the current call is to the zkEVM bridge
  if (call?.to && call.to.toLowerCase() === POLYGON_ZKEVM_BRIDGE.toLowerCase()) {
    bridgeCalls.push(call);
  }

  // Recursively check sub-calls
  if (call?.calls && Array.isArray(call.calls) && call.calls.length > 0) {
    for (const subCall of call.calls) {
      bridgeCalls = bridgeCalls.concat(findPolygonZkEVMBridgeCalls(subCall));
    }
  }

  return bridgeCalls;
}

/**
 * Parses a source chain simulation trace to find Polygon zkEVM bridge messages
 * initiated via the Polygon zkEVM bridge contract.
 *
 * @param sourceSim The Tenderly simulation result from the source chain.
 * @returns An array of ExtractedCrossChainMessage objects.
 */
export function parsePolygonZkEVML1L2Messages(
  sourceSim: TenderlySimulation,
): ExtractedCrossChainMessage[] {
  // Map to store unique messages
  const messagesByTargetAndCalldata = new Map<string, ExtractedCrossChainMessage>();

  // Handle null or undefined transaction info gracefully
  if (!sourceSim?.transaction?.transaction_info?.call_trace) {
    return [];
  }

  // Find all calls to Polygon zkEVM bridge
  const bridgeCalls = findPolygonZkEVMBridgeCalls(
    sourceSim.transaction.transaction_info.call_trace,
  );

  for (const call of bridgeCalls) {
    if (!call || !call.input || !call.from || !call.to) continue;

    // Skip empty or invalid calldata
    if (call.input === '0x' || call.input.length < 10) {
      console.log(`[Polygon Parser] Skipping call with invalid input: ${call.input}`);
      continue;
    }

    try {
      const decodedInput = decodeFunctionData({
        abi: PolygonZkEVMBridgeAbi,
        data: call.input as Hex,
      });

      // Handle different function types based on the correct ABI
      switch (decodedInput.functionName) {
        case 'bridgeMessage': {
          // bridgeMessage(uint32 destinationNetwork, address destinationAddress, bool forceUpdateGlobalExitRoot, bytes metadata)
          const args = decodedInput.args as readonly [number, Address, boolean, Hex];
          const [_destinationNetwork, destinationAddress, _forceUpdateGlobalExitRoot, metadata] =
            args;

          const message: ExtractedCrossChainMessage = {
            bridgeType: 'PolygonZkL1L2',
            destinationChainId: '1101', // Polygon zkEVM chain ID
            l2TargetAddress: destinationAddress,
            l2InputData: metadata, // The metadata contains the actual call data
            l2Value: '0',
            l2FromAddress: getAddress(call.from),
          };

          const key = `zkEVM-${destinationAddress}-1101`;
          messagesByTargetAndCalldata.set(key, message);

          console.log(
            `[Polygon Parser] Found zkEVM bridge message to ${destinationAddress} on chain 1101`,
          );
          break;
        }

        case 'bridgeMessageWETH': {
          // bridgeMessageWETH(uint32 destinationNetwork, address destinationAddress, uint256 amountWETH, bool forceUpdateGlobalExitRoot, bytes metadata)
          const args = decodedInput.args as readonly [number, Address, bigint, boolean, Hex];
          const [
            _destinationNetwork,
            destinationAddress,
            amountWETH,
            _forceUpdateGlobalExitRoot,
            metadata,
          ] = args;

          const message: ExtractedCrossChainMessage = {
            bridgeType: 'PolygonZkL1L2',
            destinationChainId: '1101', // Polygon zkEVM chain ID
            l2TargetAddress: '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9' as Address, // WETH address
            l2InputData: metadata, // The metadata contains the actual call data
            l2Value: amountWETH.toString(),
            l2FromAddress: getAddress(call.from),
          };

          const key = `zkEVM-WETH-${destinationAddress}-1101`;
          messagesByTargetAndCalldata.set(key, message);

          console.log(
            `[Polygon Parser] Found zkEVM WETH bridge message to ${destinationAddress} on chain 1101`,
          );
          break;
        }

        case 'bridgeAsset': {
          // bridgeAsset(uint32 destinationNetwork, address destinationAddress, uint256 amount, address token, bool forceUpdateGlobalExitRoot, bytes permitData)
          const args = decodedInput.args as readonly [
            number,
            Address,
            bigint,
            Address,
            boolean,
            Hex,
          ];
          const [
            _destinationNetwork,
            destinationAddress,
            amount,
            token,
            _forceUpdateGlobalExitRoot,
            _permitData,
          ] = args;

          const message: ExtractedCrossChainMessage = {
            bridgeType: 'PolygonZkL1L2',
            destinationChainId: '1101', // Polygon zkEVM chain ID
            l2TargetAddress: token,
            l2InputData: '0x' as Hex, // Asset transfer will be handled by the bridge
            l2Value: amount.toString(),
            l2FromAddress: getAddress(call.from),
          };

          const key = `zkEVM-Asset-${token}-${destinationAddress}-1101`;
          messagesByTargetAndCalldata.set(key, message);

          console.log(
            `[Polygon Parser] Found zkEVM asset bridge message for ${token} to ${destinationAddress} on chain 1101`,
          );
          break;
        }

        default: {
          console.log(`[Polygon Parser] Skipping unknown function: ${decodedInput.functionName}`);
          continue;
        }
      }
    } catch (error) {
      console.error(
        '[Polygon Parser] Error decoding bridge call data:',
        error,
        'Call Input:',
        call.input,
      );
    }
  }

  const extractedMessages = Array.from(messagesByTargetAndCalldata.values());

  if (extractedMessages.length > 0) {
    console.log(`[Polygon Parser] Extracted ${extractedMessages.length} unique bridge messages.`);
  }

  return extractedMessages;
}
