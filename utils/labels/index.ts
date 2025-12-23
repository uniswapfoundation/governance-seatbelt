import { type PublicClient, getAddress } from 'viem';
import type { AddressLabel, TenderlyContract } from '../../types';
import commonLabels from './common.json';

/**
 * Label configuration loaded from JSON files
 */
type LabelConfig = Record<string, { label: string; type?: string }>;

/**
 * Load DAO-specific labels if they exist
 */
async function loadDaoLabels(daoName: string): Promise<LabelConfig> {
  try {
    // Dynamic import of DAO-specific labels from utils/labels/<daoName>.json
    const normalizedName = daoName.toLowerCase().replace(/\s+/g, '-');
    const labels = await import(`./${normalizedName}.json`);
    return labels.default || labels;
  } catch {
    // No DAO-specific labels found, that's fine
    return {};
  }
}

/**
 * Resolve ENS name for an address
 */
async function resolveEnsName(address: string, client: PublicClient): Promise<string | null> {
  try {
    const ensName = await client.getEnsName({
      address: getAddress(address),
    });
    return ensName;
  } catch {
    return null;
  }
}

/**
 * Get contract name from Tenderly data
 */
function getTenderlyLabel(contract: TenderlyContract | undefined): string | null {
  if (!contract) return null;

  // Prefer token name + symbol for tokens
  if (contract.token_data?.name && contract.token_data?.symbol) {
    return `${contract.token_data.name} (${contract.token_data.symbol})`;
  }

  // Fall back to contract name
  if (contract.contract_name) {
    return contract.contract_name;
  }

  return null;
}

/**
 * Resolve labels for a set of addresses
 *
 * Priority:
 * 1. Custom labels from JSON configs (highest priority)
 * 2. ENS names
 * 3. Tenderly contract names
 *
 * @param addresses - List of addresses to resolve labels for
 * @param daoName - DAO name for loading DAO-specific labels
 * @param client - Viem public client for ENS resolution
 * @param contracts - Tenderly contracts for fallback names
 * @returns Map of address to label info
 */
export async function resolveLabelsForAddresses(
  addresses: string[],
  daoName: string,
  client: PublicClient,
  contracts: TenderlyContract[] = [],
): Promise<Record<string, AddressLabel>> {
  const labels: Record<string, AddressLabel> = {};

  // Load label configs
  const daoLabels = await loadDaoLabels(daoName);
  const allCustomLabels: LabelConfig = {
    ...(commonLabels as LabelConfig),
    ...daoLabels, // DAO labels override common labels
  };

  // Create a map for quick contract lookup
  const contractMap = new Map<string, TenderlyContract>();
  for (const contract of contracts) {
    try {
      contractMap.set(getAddress(contract.address), contract);
    } catch {
      // Invalid address, skip
    }
  }

  // Resolve labels for each unique address
  const uniqueAddresses = [...new Set(addresses)];

  await Promise.all(
    uniqueAddresses.map(async (address) => {
      let checksumAddress: string;
      try {
        checksumAddress = getAddress(address);
      } catch {
        // Invalid address, skip
        return;
      }

      // 1. Check custom labels first
      const customLabel = allCustomLabels[checksumAddress];
      if (customLabel) {
        labels[checksumAddress] = {
          label: customLabel.label,
          type: customLabel.type as AddressLabel['type'],
          source: 'custom',
        };
        return;
      }

      // 2. Try ENS resolution
      const ensName = await resolveEnsName(checksumAddress, client);
      if (ensName) {
        labels[checksumAddress] = {
          label: ensName,
          source: 'ens',
        };
        return;
      }

      // 3. Fall back to Tenderly contract name
      const contract = contractMap.get(checksumAddress);
      const tenderlyLabel = getTenderlyLabel(contract);
      if (tenderlyLabel) {
        labels[checksumAddress] = {
          label: tenderlyLabel,
          type: contract?.token_data ? 'token' : 'contract',
          source: 'tenderly',
        };
      }
    }),
  );

  return labels;
}

/**
 * Format an address with its label for display
 * Format: "Label (0x1234...5678)" or just "0x1234...5678" if no label
 */
export function formatAddressWithLabel(
  address: string,
  labels: Record<string, AddressLabel>,
): string {
  let checksumAddress: string;
  try {
    checksumAddress = getAddress(address);
  } catch {
    return address;
  }

  const label = labels[checksumAddress];
  const abbreviated = `${checksumAddress.slice(0, 6)}...${checksumAddress.slice(-4)}`;

  if (label) {
    return `${label.label} (${abbreviated})`;
  }

  return abbreviated;
}

/**
 * Extract all addresses from check results, state changes, and events
 */
export function extractAddressesFromReport(
  checks: Array<{ info: string[]; warnings: string[]; errors: string[] }>,
  stateChanges: Array<{ contractAddress?: string }>,
  events: Array<{ contractAddress?: string }>,
  metadata: { proposer?: string; executor?: string; governorAddress?: string },
): string[] {
  const addresses: string[] = [];

  // Add metadata addresses
  if (metadata.proposer) addresses.push(metadata.proposer);
  if (metadata.executor) addresses.push(metadata.executor);
  if (metadata.governorAddress) addresses.push(metadata.governorAddress);

  // Extract addresses from state changes
  for (const change of stateChanges) {
    if (change.contractAddress) {
      addresses.push(change.contractAddress);
    }
  }

  // Extract addresses from events
  for (const event of events) {
    if (event.contractAddress) {
      addresses.push(event.contractAddress);
    }
  }

  // Extract addresses from check messages (look for 0x addresses)
  const addressRegex = /0x[a-fA-F0-9]{40}/g;
  for (const check of checks) {
    for (const messages of [check.info, check.warnings, check.errors]) {
      for (const msg of messages) {
        const matches = msg.match(addressRegex);
        if (matches) {
          addresses.push(...matches);
        }
      }
    }
  }

  return addresses;
}
