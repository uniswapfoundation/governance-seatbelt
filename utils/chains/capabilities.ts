import {
  arbitrum,
  avalanche,
  base,
  bob,
  bsc,
  celo,
  ink,
  mainnet,
  monad,
  optimism,
  polygon,
  soneium,
  tempo,
  unichain,
  worldchain,
  xLayer,
  zora,
} from 'viem/chains';
import { getCanonicalChainName } from './chain-name';
import { megaeth } from './megaeth';

type ChainCapability = {
  supportsL2Checks: boolean;
  supportsTenderlyDestinationSimulation: boolean;
  isOpStackDestination: boolean;
};

const CHAIN_CAPABILITIES: Record<number, ChainCapability> = {
  [mainnet.id]: {
    supportsL2Checks: false,
    supportsTenderlyDestinationSimulation: false,
    isOpStackDestination: false,
  },
  [optimism.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [base.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [arbitrum.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [unichain.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [ink.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [soneium.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [bob.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [bsc.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [celo.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [polygon.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [avalanche.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [monad.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [tempo.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [megaeth.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: false,
  },
  [worldchain.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [xLayer.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: true,
    isOpStackDestination: true,
  },
  [zora.id]: {
    supportsL2Checks: true,
    supportsTenderlyDestinationSimulation: false,
    isOpStackDestination: true,
  },
};

const OP_STACK_DESTINATION_CHAIN_ORDER = [
  optimism.id,
  base.id,
  unichain.id,
  xLayer.id,
  worldchain.id,
  celo.id,
  ink.id,
  soneium.id,
  bob.id,
  zora.id,
];

export function getChainName(chainId: number): string {
  return getCanonicalChainName(chainId);
}

export function supportsL2Checks(chainId: number): boolean {
  return CHAIN_CAPABILITIES[chainId]?.supportsL2Checks ?? false;
}

export function supportsTenderlyDestinationSimulation(chainId: number): boolean {
  return CHAIN_CAPABILITIES[chainId]?.supportsTenderlyDestinationSimulation ?? false;
}

export function getOpStackDestinationChainIds(): number[] {
  return OP_STACK_DESTINATION_CHAIN_ORDER.filter(
    (chainId) => CHAIN_CAPABILITIES[chainId]?.isOpStackDestination,
  );
}
