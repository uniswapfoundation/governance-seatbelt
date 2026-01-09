import { getAddress } from 'viem';

export type SourcifyMatch = 'exact_match' | 'match' | 'no_match' | 'error';

const SOURCIFY_TIMEOUT_MS = 8_000;

interface SourcifyV2ContractResponse {
  match?: string;
  creationMatch?: string;
  runtimeMatch?: string;
}

export async function getSourcifyMatch(address: string, chainId: number): Promise<SourcifyMatch> {
  const normalizedAddress = getAddress(address);
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${normalizedAddress}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCIFY_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (response.status === 404) {
      return 'no_match';
    }

    if (!response.ok) {
      return 'error';
    }

    const data = (await response.json()) as SourcifyV2ContractResponse;
    const match = data.match ?? data.runtimeMatch ?? data.creationMatch;

    if (match === 'exact_match') return 'exact_match';
    if (match === 'no_match') return 'no_match';
    if (typeof match === 'string') return 'match';
    return 'error';
  } catch {
    return 'error';
  }
}
