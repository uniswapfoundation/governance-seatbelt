import { encodeAbiParameters } from 'viem';
import type { Address } from 'viem';
import type { SimulationConfigNew } from '../types';

const POLYGON_ZKEVM_BRIDGE: Address = '0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe';
const POLYGON_ZKEVM_COUNTER: Address = '0x3819ebfb133f0bee8b5c4645bd2656ed2838fa0c';
const POLYGON_ZKEVM_WETH: Address = '0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'; // WETH on zkEVM

const call1 = {
  target: POLYGON_ZKEVM_BRIDGE,
  value: '0',
  signature: 'bridgeMessage(uint32,address,bool,bytes)',
  calldata: encodeAbiParameters(
    [
      { name: 'destinationNetwork', type: 'uint32' },
      { name: 'destinationAddress', type: 'address' },
      { name: 'forceUpdateGlobalExitRoot', type: 'bool' },
      { name: 'metadata', type: 'bytes' },
    ],
    [
      1101, // destinationNetwork (Polygon zkEVM)
      POLYGON_ZKEVM_WETH, // destinationAddress (WETH contract)
      false, // forceUpdateGlobalExitRoot
      encodeAbiParameters(
        [
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        [
          '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', // recipient
          BigInt(1000000000000000000), // 1 WETH (18 decimals)
        ],
      ), // metadata (WETH transfer calldata)
    ],
  ),
};

const call2 = {
  target: POLYGON_ZKEVM_BRIDGE,
  value: '0',
  signature: 'bridgeMessage(uint32,address,bool,bytes)',
  calldata: encodeAbiParameters(
    [
      { name: 'destinationNetwork', type: 'uint32' },
      { name: 'destinationAddress', type: 'address' },
      { name: 'forceUpdateGlobalExitRoot', type: 'bool' },
      { name: 'metadata', type: 'bytes' },
    ],
    [
      1101, // destinationNetwork (Polygon zkEVM)
      POLYGON_ZKEVM_COUNTER, // destinationAddress (counter contract)
      false, // forceUpdateGlobalExitRoot
      '0x61bc221a', // metadata (counter() function selector)
    ],
  ),
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'PolygonZkEVMBridgeTest',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  governorType: 'bravo',
  targets: [call1.target, call2.target],
  values: [BigInt(call1.value), BigInt(call2.value)],
  signatures: [call1.signature as `0x${string}`, call2.signature as `0x${string}`],
  calldatas: [call1.calldata, call2.calldata],
  description: `# Polygon zkEVM Bridge Test

This proposal tests the Polygon zkEVM bridge integration with WETH transfer and counter contract.

## Actions

### 1. Polygon zkEVM Bridge - WETH Transfer
- **Target**: Polygon zkEVM Bridge (0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe)
- **Action**: Call bridgeMessage() function to bridge WETH to Polygon zkEVM
- **Destination**: WETH contract on Polygon zkEVM (0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9)
- **Function**: Transfer WETH via bridgeMessage(uint32,address,bool,bytes) with transfer calldata in metadata

### 2. Polygon zkEVM Bridge - Counter Contract
- **Target**: Polygon zkEVM Bridge (0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe)
- **Action**: Call bridgeMessage() function to bridge to Polygon zkEVM
- **Destination**: Counter contract on Polygon zkEVM (0x3819ebfb133f0bee8b5c4645bd2656ed2838fa0c)
- **Function**: Read counter value via counter()

This test validates cross-chain bridge messaging to Polygon zkEVM for both token transfers and contract interaction.`,
};
