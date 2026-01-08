import type { Address, Hex, PublicClient } from 'viem';
import { getAddress, zeroAddress } from 'viem';

export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

export const EIP1967_BEACON_SLOT =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' as const;

function parseAddressFromSlot(value: Hex | null | undefined): Address | null {
  if (!value || value === '0x') return null;
  const raw = value.slice(2).padStart(64, '0');
  const addrHex = `0x${raw.slice(24)}`;
  const addr = getAddress(addrHex);
  return addr === zeroAddress ? null : addr;
}

export type ProxyDetection =
  | { kind: 'none' }
  | { kind: 'eip1967'; proxy: Address; implementation: Address | null }
  | { kind: 'beacon'; proxy: Address; beacon: Address; implementation: Address | null };

async function readBeaconImplementation(
  beacon: Address,
  publicClient: PublicClient,
  blockNumber: bigint,
): Promise<Address | null> {
  const abi = ['function implementation() external view returns (address)'] as const;
  try {
    const impl = (await publicClient.readContract({
      address: beacon,
      abi,
      functionName: 'implementation',
      blockNumber,
    })) as Address;
    const addr = getAddress(impl);
    return addr === zeroAddress ? null : addr;
  } catch {
    return null;
  }
}

export async function detectProxy(
  address: Address,
  publicClient: PublicClient,
  blockNumber: bigint,
): Promise<ProxyDetection> {
  // Beacon proxies
  const beaconRaw = await publicClient.getStorageAt({
    address,
    slot: EIP1967_BEACON_SLOT,
    blockNumber,
  });
  const beacon = parseAddressFromSlot(beaconRaw);
  if (beacon) {
    const implementation = await readBeaconImplementation(beacon, publicClient, blockNumber);
    return { kind: 'beacon', proxy: address, beacon, implementation };
  }

  // EIP-1967 implementation slot (transparent/upgradeable proxies)
  const implRaw = await publicClient.getStorageAt({
    address,
    slot: EIP1967_IMPLEMENTATION_SLOT,
    blockNumber,
  });
  const implementation = parseAddressFromSlot(implRaw);
  if (implementation) {
    return { kind: 'eip1967', proxy: address, implementation };
  }

  return { kind: 'none' };
}
