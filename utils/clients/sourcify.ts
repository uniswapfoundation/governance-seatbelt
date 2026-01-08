import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress } from 'viem';

const SOURCIFY_BASE_URL = 'https://sourcify.dev/server/v2';

type SourcifyContractResponse = {
  match: 'exact_match' | 'partial_match' | null;
  creationMatch: 'exact_match' | 'partial_match' | null;
  runtimeMatch: 'exact_match' | 'partial_match' | null;
  chainId: string;
  address: string;
};

// Cache directory path - use a gitignored location
const CACHE_DIR = join(process.cwd(), 'cache');
const SOURCIFY_VERIFICATION_CACHE_DIR = join(CACHE_DIR, 'sourcify-verification');

if (!existsSync(SOURCIFY_VERIFICATION_CACHE_DIR)) {
  mkdirSync(SOURCIFY_VERIFICATION_CACHE_DIR, { recursive: true });
}

const verificationCache: Record<string, SourcifyVerification> = {};

function cacheKey(chainId: number, address: string) {
  return `${chainId}:${getAddress(address)}`;
}

function cachePath(chainId: number, address: string) {
  return join(SOURCIFY_VERIFICATION_CACHE_DIR, `${chainId}-${getAddress(address)}.json`);
}

function readCachedVerification(chainId: number, address: string): SourcifyVerification | null {
  const path = cachePath(chainId, address);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (
      cached?.status === 'verified' &&
      (cached.match === 'exact_match' || cached.match === 'partial_match')
    ) {
      return { status: 'verified', match: cached.match };
    }
    if (cached?.status === 'unverified') return { status: 'unverified' };
    return null;
  } catch {
    return null;
  }
}

function writeCachedVerification(chainId: number, address: string, status: SourcifyVerification) {
  const path = cachePath(chainId, address);
  writeFileSync(path, JSON.stringify({ ...status, timestamp: Date.now() }));
}

export type SourcifyVerification =
  | { status: 'verified'; match: 'exact_match' | 'partial_match' }
  | { status: 'unverified' };

export async function getSourcifyVerification(
  address: string,
  chainId: number,
): Promise<SourcifyVerification> {
  const normalized = getAddress(address);
  const key = cacheKey(chainId, normalized);

  const mem = verificationCache[key];
  if (mem) return mem;

  const file = readCachedVerification(chainId, normalized);
  if (file) {
    verificationCache[key] = file;
    return file;
  }

  const res = await fetch(`${SOURCIFY_BASE_URL}/contract/${chainId}/${normalized}`);
  let match: 'exact_match' | 'partial_match' | null = null;

  try {
    const data = (await res.json()) as SourcifyContractResponse;
    match = data.match;
  } catch {
    match = null;
  }

  const status: SourcifyVerification =
    match === 'exact_match' || match === 'partial_match'
      ? { status: 'verified', match }
      : { status: 'unverified' };
  verificationCache[key] = status;
  writeCachedVerification(chainId, normalized, status);

  return status;
}

export async function isContractVerifiedOnSourcify(
  address: string,
  chainId: number,
): Promise<boolean> {
  const status = await getSourcifyVerification(address, chainId);
  return status.status === 'verified';
}
