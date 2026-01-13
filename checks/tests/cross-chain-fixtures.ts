import type { SimulationConfigNew, SimulationResult } from '../../types';
import { handleCrossChainSimulations, simulateNew } from '../../utils/clients/tenderly';

let arbConfigPromise: Promise<SimulationConfigNew> | undefined;
let opConfigPromise: Promise<SimulationConfigNew> | undefined;

let arbSourcePromise: Promise<SimulationResult> | undefined;
let arbCrossChainPromise: Promise<SimulationResult> | undefined;

let opSourcePromise: Promise<SimulationResult> | undefined;
let opCrossChainPromise: Promise<SimulationResult> | undefined;

async function getArbConfig(): Promise<SimulationConfigNew> {
  if (!arbConfigPromise) {
    arbConfigPromise = import('../../sims/arb-distro.sim.ts').then((m) => m.config);
  }
  return arbConfigPromise;
}

async function getOptimismConfig(): Promise<SimulationConfigNew> {
  if (!opConfigPromise) {
    opConfigPromise = import('../../sims/optimism-bridge-test.sim.ts').then((m) => m.config);
  }
  return opConfigPromise;
}

export async function getArbDistroSourceResult(): Promise<SimulationResult> {
  if (!arbSourcePromise) {
    arbSourcePromise = (async () => {
      const config = await getArbConfig();
      return await simulateNew(config);
    })();
  }
  return arbSourcePromise;
}

export async function getArbDistroCrossChainResult(): Promise<SimulationResult> {
  if (!arbCrossChainPromise) {
    arbCrossChainPromise = (async () => {
      const source = await getArbDistroSourceResult();
      return await handleCrossChainSimulations(source);
    })();
  }
  return arbCrossChainPromise;
}

export async function getOptimismBridgeSourceResult(): Promise<SimulationResult> {
  if (!opSourcePromise) {
    opSourcePromise = (async () => {
      const config = await getOptimismConfig();
      return await simulateNew(config);
    })();
  }
  return opSourcePromise;
}

export async function getOptimismBridgeCrossChainResult(): Promise<SimulationResult> {
  if (!opCrossChainPromise) {
    opCrossChainPromise = (async () => {
      const source = await getOptimismBridgeSourceResult();
      return await handleCrossChainSimulations(source);
    })();
  }
  return opCrossChainPromise;
}
