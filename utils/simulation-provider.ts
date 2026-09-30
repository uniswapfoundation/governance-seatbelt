export function getSimulationProvider(): 'tenderly' | 'rpc' {
  const provider = process.env.SIMULATION_PROVIDER ?? 'tenderly';
  if (provider !== 'tenderly' && provider !== 'rpc') {
    throw new Error('SIMULATION_PROVIDER must be tenderly or rpc');
  }
  return provider;
}
