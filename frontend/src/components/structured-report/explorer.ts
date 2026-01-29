import type { StructuredSimulationReport } from '@/hooks/use-simulation-results';

function getExplorerUrl(metadata: StructuredSimulationReport['metadata']): string {
  return metadata.blockExplorerBaseUrl || 'https://etherscan.io';
}

export function buildAddressLink(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): string {
  const baseUrl = getExplorerUrl(metadata);
  return `${baseUrl}/address/${address}`;
}

export function buildAddressLinkForExplorer(address: string, baseUrl: string): string {
  return `${baseUrl || 'https://etherscan.io'}/address/${address}`;
}

export function buildBlockLink(
  blockNumber: string,
  metadata: StructuredSimulationReport['metadata'],
): string {
  const baseUrl = getExplorerUrl(metadata);
  return `${baseUrl}/block/${blockNumber}`;
}

export function isPlaceholderAddress(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): boolean {
  if (!metadata.placeholderAddresses) return false;
  return metadata.placeholderAddresses.some(
    (placeholder) => placeholder.toLowerCase() === address.toLowerCase(),
  );
}

export function getAddressLabel(
  address: string,
  metadata: StructuredSimulationReport['metadata'],
): string | null {
  if (!metadata.addressLabels) return null;
  const normalizedAddress = address.toLowerCase();
  for (const [addr, labelInfo] of Object.entries(metadata.addressLabels)) {
    if (addr.toLowerCase() === normalizedAddress) {
      return labelInfo.label;
    }
  }
  return null;
}

export function getExecutorLabel(simulationType?: string): string {
  switch (simulationType) {
    case 'new':
      return 'Intended Executor';
    case 'proposed':
      return 'Will Execute';
    case 'executed':
      return 'Executed By';
    default:
      return 'Executor';
  }
}
