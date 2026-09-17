import { encodeFunctionData, parseAbi } from 'viem';
import type { SimulationConfigNew } from '../types';
import { WORMHOLE_SEND_MESSAGE_ABI } from '../utils/bridges/wormhole';
import { WORMHOLE_LANE_SUPPORT_MATRIX } from '../utils/bridges/wormhole-support';

const lane = WORMHOLE_LANE_SUPPORT_MATRIX.arc;
const targets = [
  lane.validationTargets.v2Factory,
  lane.validationTargets.v3Factory!,
  lane.validationTargets.v4PoolManager!,
];
// Exercise each authority-gated setter without changing the existing authority.
const datas = ['setFeeToSetter', 'setOwner', 'transferOwnership'].map((name) =>
  encodeFunctionData({
    abi: parseAbi([`function ${name}(address)`]),
    functionName: name,
    args: [lane.l2FromAddress],
  }),
);

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorType: 'bravo',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
  targets: [lane.senderTargets[0]],
  values: [0n],
  signatures: [''],
  calldatas: [
    encodeFunctionData({
      abi: WORMHOLE_SEND_MESSAGE_ABI,
      functionName: 'sendMessage',
      args: [targets, [0n, 0n, 0n], datas, lane.l2FromAddress, lane.wormholeChainId],
    }),
  ],
  description:
    '# Arc governance integration spike\n\nSimulation only: exercise V2, V3 and V4 authority-gated setters through the Arc Wormhole receiver, retaining the existing authority. Wormhole verification is stubbed by Seatbelt; this does not validate bridge delivery.',
};
