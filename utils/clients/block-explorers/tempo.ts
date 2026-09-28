import { type Abi, getAddress } from 'viem';
import { z } from '../../validation/zod';
import { VerifierLookupClient } from '../verifier-lookup';
import { CacheManager } from './cache';
import { BaseBlockExplorer, type VerificationOptions } from './index';

const tempoNotFoundResponseSchema = z
  .object({
    customCode: z.literal('contract_not_found'),
    message: z.string(),
    errorId: z.string().optional(),
  })
  .passthrough();

export class TempoExplorer extends BaseBlockExplorer {
  private lookupClient = new VerifierLookupClient({
    baseUrl: 'https://contracts.tempo.xyz',
    name: 'Tempo verifier',
    notFoundSchema: tempoNotFoundResponseSchema,
  });

  getName(): string {
    return 'Tempo';
  }

  private getCachedVerification(chainId: number, address: string): boolean | null {
    const memoryEntry = CacheManager.getVerificationEntryFromMemory(chainId, address);
    if (memoryEntry?.verificationBackend === 'tempo') {
      return memoryEntry.verified;
    }

    const fileEntry = CacheManager.getVerificationEntryFromFile(chainId, address);
    if (fileEntry?.verificationBackend === 'tempo') {
      CacheManager.setVerificationEntryInMemory(chainId, address, fileEntry);
      return fileEntry.verified;
    }

    return null;
  }

  private async lookupMetadata(address: string, chainId: number) {
    return this.lookupClient.lookup(address, chainId, { fields: ['abi', 'name'] });
  }

  private cacheMetadata(
    chainId: number,
    address: string,
    options?: { abi?: Abi | null; name?: string | null },
  ): void {
    if (options?.abi) {
      CacheManager.setAbiInMemory(chainId, address, options.abi, this.getName());
      CacheManager.setAbiInFile(chainId, address, options.abi, this.getName());
    }

    const name = options?.name?.trim();
    if (name) {
      CacheManager.setContractNameInMemory(chainId, address, name);
      CacheManager.setContractNameInFile(chainId, address, name);
    }
  }

  async fetchContractAbi(address: string, chainId: number): Promise<Abi | null> {
    const normalizedAddress = getAddress(address);
    const cachedAbi = await this.checkAbiCache(chainId, address, normalizedAddress);
    if (cachedAbi) return cachedAbi;

    const lookup = await this.lookupMetadata(normalizedAddress, chainId);
    if (lookup.status === 'ok') {
      this.cacheMetadata(chainId, address, {
        abi: lookup.data?.abi,
        name: lookup.data?.name,
      });
    }

    const abi = lookup.status === 'ok' ? lookup.data?.abi : null;
    if (!abi) return null;
    return abi;
  }

  async fetchContractName(address: string, chainId: number): Promise<string | null> {
    const normalizedAddress = getAddress(address);
    const cachedName = CacheManager.getContractNameFromMemory(chainId, normalizedAddress);
    if (cachedName) return cachedName;

    const fileCachedName = CacheManager.getContractNameFromFile(chainId, normalizedAddress);
    if (fileCachedName) {
      CacheManager.setContractNameInMemory(chainId, normalizedAddress, fileCachedName);
      return fileCachedName;
    }

    const lookup = await this.lookupMetadata(normalizedAddress, chainId);
    if (lookup.status === 'ok') {
      this.cacheMetadata(chainId, address, {
        abi: lookup.data?.abi,
        name: lookup.data?.name,
      });
    }

    const name = lookup.status === 'ok' ? lookup.data?.name?.trim() : undefined;
    if (!name) return null;
    return name;
  }

  async isContractVerified(
    address: string,
    chainId: number,
    options?: VerificationOptions,
  ): Promise<boolean> {
    const normalizedAddress = getAddress(address);
    const skipCache = options?.skipCache === true;

    if (!skipCache) {
      const cachedVerification = this.getCachedVerification(chainId, normalizedAddress);
      if (cachedVerification !== null) {
        return cachedVerification;
      }
    }

    const lookup = await this.lookupClient.lookup(normalizedAddress, chainId);
    if (lookup.status === 'error') {
      throw new Error(`Tempo verifier lookup failed for ${normalizedAddress} on chain ${chainId}`);
    }

    const isVerified =
      lookup.status === 'ok' &&
      (lookup.data?.match === 'exact_match' || lookup.data?.match === 'match');

    if (!skipCache) {
      const cacheMeta = {
        source: 'block-explorer' as const,
        verificationBackend: 'tempo' as const,
        blockExplorer: { name: this.getName(), verified: isVerified },
      };
      CacheManager.setVerificationInMemory(chainId, address, isVerified, cacheMeta);
      CacheManager.setVerificationInFile(chainId, address, isVerified, cacheMeta);
    }

    return isVerified;
  }
}
