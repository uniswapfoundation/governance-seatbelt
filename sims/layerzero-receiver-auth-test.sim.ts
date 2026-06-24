import { encodeAbiParameters, encodeFunctionData, getAddress } from 'viem';
import type { SimulationConfigNew } from '../types';
import {
  LAYER_ZERO_EXECUTE_ABI,
  LAYER_ZERO_LANE_SUPPORT_MATRIX,
  LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
  UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR,
  UNISWAP_OMNICHAIN_PROPOSAL_SENDER,
} from '../utils/bridges/layerzero';

const TEST_DESTINATION_TARGET = getAddress('0x00000000000000000000000000000000000000A1');
const MEGAETH_LANE = LAYER_ZERO_LANE_SUPPORT_MATRIX.megaeth;

const setupCalldata = encodeFunctionData({
  abi: LAYER_ZERO_SET_TRUSTED_REMOTE_ADDRESS_ABI,
  functionName: 'setTrustedRemoteAddress',
  args: [MEGAETH_LANE.layerZeroRemoteChainId, UNISWAP_MEGAETH_OMNICHAIN_GOVERNANCE_EXECUTOR],
});

const destinationPayload = encodeAbiParameters(
  [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bytes[]' }],
  [[TEST_DESTINATION_TARGET], [0n], ['0x12345678']],
);

const executeCalldata = encodeFunctionData({
  abi: LAYER_ZERO_EXECUTE_ABI,
  functionName: 'execute',
  args: [MEGAETH_LANE.layerZeroRemoteChainId, destinationPayload, '0x'],
});

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorType: 'bravo',
  governorAddress: getAddress('0x408ED6354d4973f66138C91495F2f2FCbd8724C3'),
  targets: [UNISWAP_OMNICHAIN_PROPOSAL_SENDER, UNISWAP_OMNICHAIN_PROPOSAL_SENDER],
  values: [0n, 0n],
  signatures: ['', ''],
  calldatas: [setupCalldata, executeCalldata],
  description: `# LayerZero receiver auth test

Minimal Uniswap-style LayerZero proposal used to verify Seatbelt checks destination receiver trusted-remote config before replaying destination calls. The setup call configures the source sender for the live source simulation; Seatbelt validates the destination receiver separately.`,
};
