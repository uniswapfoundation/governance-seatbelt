import { getAddress } from 'viem';

export type SourcifyMatch = 'exact_match' | 'match' | 'no_match' | 'error';

interface SourcifyV2ContractResponse {
  match?: string;
  creationMatch?: string;
  runtimeMatch?: string;
}

export async function getSourcifyMatch(address: string, chainId: number): Promise<SourcifyMatch> {
  const normalizedAddress = getAddress(address);
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${normalizedAddress}`;

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });

    if (response.status === 404) {
      return 'no_match';
    }

    if (!response.ok) {
      return 'error';
    }

    const data = (await response.json()) as SourcifyV2ContractResponse;
    const match = data.match ?? data.runtimeMatch ?? data.creationMatch;

    if (match === 'exact_match') return 'exact_match';
    if (match === 'match') return 'match';
    return 'error';
  } catch {
    return 'error';
  }
}
