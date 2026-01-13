import { decodeEventLog, getAddress, isHex, keccak256, toBytes, zeroAddress, zeroHash } from 'viem';
import type { PermissionsDiffItem, ProposalCheck, TenderlyContract } from '../types';

function eventTopic(signature: string): `0x${string}` {
  return keccak256(toBytes(signature));
}

const OWNERSHIP_TRANSFERRED_TOPIC = eventTopic('OwnershipTransferred(address,address)');
const ROLE_GRANTED_TOPIC = eventTopic('RoleGranted(bytes32,address,address)');
const ROLE_REVOKED_TOPIC = eventTopic('RoleRevoked(bytes32,address,address)');
const NEW_ADMIN_TOPIC = eventTopic('NewAdmin(address)');
const NEW_PENDING_ADMIN_TOPIC = eventTopic('NewPendingAdmin(address)');

const KNOWN_ROLE_NAMES: Array<{ name: string; id: `0x${string}` }> = [
  { name: 'DEFAULT_ADMIN_ROLE', id: zeroHash },
  { name: 'PROPOSER_ROLE', id: keccak256(toBytes('PROPOSER_ROLE')) },
  { name: 'EXECUTOR_ROLE', id: keccak256(toBytes('EXECUTOR_ROLE')) },
  { name: 'CANCELLER_ROLE', id: keccak256(toBytes('CANCELLER_ROLE')) },
];

function decodeRoleName(roleId: string): string | null {
  const normalized = roleId.toLowerCase();
  const match = KNOWN_ROLE_NAMES.find((r) => r.id.toLowerCase() === normalized);
  return match?.name ?? null;
}

function toRole(role: unknown): { id: `0x${string}`; name: string | null } {
  const roleId = typeof role === 'string' && isHex(role) ? (role as `0x${string}`) : zeroHash;
  return { id: roleId, name: decodeRoleName(roleId) };
}

function maybeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') return null;
  if (!isHex(value)) return null;
  try {
    return getAddress(value) as `0x${string}`;
  } catch {
    return null;
  }
}

function stableKey(item: PermissionsDiffItem): string {
  return JSON.stringify(item, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function getContractNameFromSimulation(contract: TenderlyContract | undefined): string {
  if (!contract) return 'Unknown Contract';

  const contractAddress = getAddress(contract.address);

  if (contract.token_data?.name) {
    const tokenName = contract.token_data.name;
    const symbol = contract.token_data.symbol || tokenName;
    return `${tokenName} (${symbol}) at \`${contractAddress}\``;
  }

  const contractName = contract.contract_name || 'Unknown Contract';
  return `${contractName} at \`${contractAddress}\``;
}

function mergeTimelockAdminChanges(items: PermissionsDiffItem[]): PermissionsDiffItem[] {
  const merged: PermissionsDiffItem[] = [];
  const index = new Map<string, number>();

  for (const item of items) {
    if (item.kind !== 'timelock_admin_changed' && item.kind !== 'timelock_pending_admin_changed') {
      merged.push(item);
      continue;
    }

    const key = `${item.kind}:${item.contractAddress.toLowerCase()}`;
    const existingIndex = index.get(key);

    if (existingIndex === undefined) {
      index.set(key, merged.length);
      merged.push(item);
      continue;
    }

    const existing = merged[existingIndex];
    if (
      existing.kind === 'timelock_admin_changed' ||
      existing.kind === 'timelock_pending_admin_changed'
    ) {
      merged[existingIndex] = {
        ...existing,
        previous: existing.previous ?? item.previous,
        next: existing.next ?? item.next,
        via: existing.via === item.via ? existing.via : 'event+state_diff',
      };
    }
  }

  return merged;
}

export const checkPermissionDiff: ProposalCheck = {
  name: 'Detects permission changes (ownership, roles, timelock admin)',
  async checkProposal(_, sim, deps, l2Simulations) {
    const warnings: string[] = [];
    const info: string[] = [];
    const permissionsDiff: PermissionsDiffItem[] = [];

    const simulations =
      l2Simulations && deps.chainConfig?.chainId !== 1
        ? l2Simulations.filter((s) => s.sim).map((s) => s.sim!)
        : [sim];

    const contractNameByAddress = new Map<string, string>();
    const getContractLabel = (address: string) => {
      const key = address.toLowerCase();
      const existing = contractNameByAddress.get(key);
      if (existing) return existing;
      const contract = sim.contracts.find((c) => c.address?.toLowerCase() === key);
      const label = getContractNameFromSimulation(contract);
      contractNameByAddress.set(key, label);
      return label;
    };

    // --- Event-based detection (works for both OZ and Bravo style contracts) ---
    for (const currentSim of simulations) {
      const logs = currentSim.transaction.transaction_info.logs ?? [];
      for (const log of logs) {
        const rawAddress = log.raw?.address;
        if (!rawAddress) continue;

        let contractAddress: `0x${string}`;
        try {
          contractAddress = getAddress(rawAddress) as `0x${string}`;
        } catch {
          continue;
        }

        const topic0 = (log.raw.topics?.[0] ?? '').toLowerCase();
        if (!topic0) continue;

        try {
          if (topic0 === OWNERSHIP_TRANSFERRED_TOPIC.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: [
                {
                  type: 'event',
                  name: 'OwnershipTransferred',
                  inputs: [
                    { indexed: true, name: 'previousOwner', type: 'address' },
                    { indexed: true, name: 'newOwner', type: 'address' },
                  ],
                },
              ],
              data: log.raw.data as `0x${string}`,
              topics: log.raw.topics as unknown as [] | [`0x${string}`, ...`0x${string}`[]],
            });

            const previousOwner = maybeAddress(decoded.args.previousOwner);
            const newOwner = maybeAddress(decoded.args.newOwner);
            if (!previousOwner || !newOwner) continue;

            permissionsDiff.push({
              kind: 'ownership_transferred',
              contractAddress,
              contractName: getContractLabel(contractAddress),
              previous: previousOwner,
              next: newOwner,
              via: 'event',
            });
          } else if (topic0 === ROLE_GRANTED_TOPIC.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: [
                {
                  type: 'event',
                  name: 'RoleGranted',
                  inputs: [
                    { indexed: true, name: 'role', type: 'bytes32' },
                    { indexed: true, name: 'account', type: 'address' },
                    { indexed: true, name: 'sender', type: 'address' },
                  ],
                },
              ],
              data: log.raw.data as `0x${string}`,
              topics: log.raw.topics as unknown as [] | [`0x${string}`, ...`0x${string}`[]],
            });

            const role = toRole(decoded.args.role);
            const account = maybeAddress(decoded.args.account);
            const sender = maybeAddress(decoded.args.sender);
            if (!account || !sender) continue;

            permissionsDiff.push({
              kind: 'role_granted',
              contractAddress,
              contractName: getContractLabel(contractAddress),
              role,
              account,
              sender,
            });
          } else if (topic0 === ROLE_REVOKED_TOPIC.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: [
                {
                  type: 'event',
                  name: 'RoleRevoked',
                  inputs: [
                    { indexed: true, name: 'role', type: 'bytes32' },
                    { indexed: true, name: 'account', type: 'address' },
                    { indexed: true, name: 'sender', type: 'address' },
                  ],
                },
              ],
              data: log.raw.data as `0x${string}`,
              topics: log.raw.topics as unknown as [] | [`0x${string}`, ...`0x${string}`[]],
            });

            const role = toRole(decoded.args.role);
            const account = maybeAddress(decoded.args.account);
            const sender = maybeAddress(decoded.args.sender);
            if (!account || !sender) continue;

            permissionsDiff.push({
              kind: 'role_revoked',
              contractAddress,
              contractName: getContractLabel(contractAddress),
              role,
              account,
              sender,
            });
          } else if (topic0 === NEW_ADMIN_TOPIC.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: [
                {
                  type: 'event',
                  name: 'NewAdmin',
                  inputs: [{ indexed: true, name: 'newAdmin', type: 'address' }],
                },
              ],
              data: log.raw.data as `0x${string}`,
              topics: log.raw.topics as unknown as [] | [`0x${string}`, ...`0x${string}`[]],
            });

            const next = maybeAddress(decoded.args.newAdmin);
            if (!next) continue;

            permissionsDiff.push({
              kind: 'timelock_admin_changed',
              contractAddress,
              contractName: getContractLabel(contractAddress),
              previous: undefined,
              next,
              via: 'event',
            });
          } else if (topic0 === NEW_PENDING_ADMIN_TOPIC.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: [
                {
                  type: 'event',
                  name: 'NewPendingAdmin',
                  inputs: [{ indexed: true, name: 'newPendingAdmin', type: 'address' }],
                },
              ],
              data: log.raw.data as `0x${string}`,
              topics: log.raw.topics as unknown as [] | [`0x${string}`, ...`0x${string}`[]],
            });

            const next = maybeAddress(decoded.args.newPendingAdmin);
            if (!next) continue;

            permissionsDiff.push({
              kind: 'timelock_pending_admin_changed',
              contractAddress,
              contractName: getContractLabel(contractAddress),
              previous: undefined,
              next,
              via: 'event',
            });
          }
        } catch {
          // Ignore decode failures; we'll rely on other signals where possible.
        }
      }
    }

    // --- State-diff-based fallbacks (Tenderly decoded state changes) ---
    for (const diff of sim.transaction.transaction_info.state_diff ?? []) {
      if (!diff.soltype?.simple_type) continue;

      const rawAddress = diff.raw?.[0]?.address;
      if (!rawAddress) continue;

      let contractAddress: `0x${string}`;
      try {
        contractAddress = getAddress(rawAddress) as `0x${string}`;
      } catch {
        continue;
      }

      const name = diff.soltype.name;
      const original = typeof diff.original === 'string' ? diff.original : null;
      const dirty = typeof diff.dirty === 'string' ? diff.dirty : null;
      if (!original || !dirty || original === dirty) continue;

      const prev = maybeAddress(original);
      const next = maybeAddress(dirty);
      if (!next) continue;

      if (name === 'owner' || name === '_owner') {
        permissionsDiff.push({
          kind: 'ownership_transferred',
          contractAddress,
          contractName: getContractLabel(contractAddress),
          previous: prev ?? zeroAddress,
          next,
          via: 'state_diff',
        });
      }

      if (name === 'admin') {
        permissionsDiff.push({
          kind: 'timelock_admin_changed',
          contractAddress,
          contractName: getContractLabel(contractAddress),
          previous: prev ?? undefined,
          next,
          via: 'state_diff',
        });
      }

      if (name === 'pendingAdmin') {
        permissionsDiff.push({
          kind: 'timelock_pending_admin_changed',
          contractAddress,
          contractName: getContractLabel(contractAddress),
          previous: prev ?? undefined,
          next,
          via: 'state_diff',
        });
      }
    }

    const merged = mergeTimelockAdminChanges(permissionsDiff);
    const deduped: PermissionsDiffItem[] = [];
    const seen = new Set<string>();
    for (const item of merged) {
      const key = stableKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    if (deduped.length === 0) {
      info.push('Permission changes: none');
      return { info, warnings, errors: [], permissionsDiff: [] };
    }

    for (const item of deduped) {
      if (item.kind === 'ownership_transferred') {
        warnings.push(
          `Ownership transfer on ${item.contractName ?? `\`${item.contractAddress}\``}: ${
            item.previous ? `\`${item.previous}\`` : '`unknown`'
          } → \`${item.next}\``,
        );
      } else if (item.kind === 'role_granted') {
        warnings.push(
          `Role granted on ${item.contractName ?? `\`${item.contractAddress}\``}: ${
            item.role.name ?? item.role.id
          } to \`${item.account}\` (by \`${item.sender}\`)`,
        );
      } else if (item.kind === 'role_revoked') {
        warnings.push(
          `Role revoked on ${item.contractName ?? `\`${item.contractAddress}\``}: ${
            item.role.name ?? item.role.id
          } from \`${item.account}\` (by \`${item.sender}\`)`,
        );
      } else if (item.kind === 'timelock_admin_changed') {
        warnings.push(
          `Timelock admin changed on ${item.contractName ?? `\`${item.contractAddress}\``}: ${
            item.previous ? `\`${item.previous}\`` : '`unknown`'
          } → \`${item.next}\``,
        );
      } else if (item.kind === 'timelock_pending_admin_changed') {
        warnings.push(
          `Timelock pending admin changed on ${item.contractName ?? `\`${item.contractAddress}\``}: ${
            item.previous ? `\`${item.previous}\`` : '`unknown`'
          } → \`${item.next}\``,
        );
      }
    }

    return { info, warnings, errors: [], permissionsDiff: deduped };
  },
};
