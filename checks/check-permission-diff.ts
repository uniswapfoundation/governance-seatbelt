import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  isHex,
  keccak256,
  parseAbi,
  toBytes,
  zeroAddress,
  zeroHash,
} from 'viem';
import type { PermissionsDiffItem, ProposalCheck, TenderlyContract } from '../types';
import { toExplorerAddressMarkdownLink } from '../utils/explorer-links';

function eventTopic(signature: string): `0x${string}` {
  return keccak256(toBytes(signature));
}

const OWNERSHIP_TRANSFERRED_TOPIC = eventTopic('OwnershipTransferred(address,address)');
const ROLE_GRANTED_TOPIC = eventTopic('RoleGranted(bytes32,address,address)');
const ROLE_REVOKED_TOPIC = eventTopic('RoleRevoked(bytes32,address,address)');
const NEW_ADMIN_TOPIC = eventTopic('NewAdmin(address)');
const NEW_PENDING_ADMIN_TOPIC = eventTopic('NewPendingAdmin(address)');

const OWNERSHIP_TRANSFERRED_TOPIC_LOWER = OWNERSHIP_TRANSFERRED_TOPIC.toLowerCase();
const ROLE_GRANTED_TOPIC_LOWER = ROLE_GRANTED_TOPIC.toLowerCase();
const ROLE_REVOKED_TOPIC_LOWER = ROLE_REVOKED_TOPIC.toLowerCase();
const NEW_ADMIN_TOPIC_LOWER = NEW_ADMIN_TOPIC.toLowerCase();
const NEW_PENDING_ADMIN_TOPIC_LOWER = NEW_PENDING_ADMIN_TOPIC.toLowerCase();

const OWNERSHIP_TRANSFERRED_EVENT_ABI = [
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      { indexed: true, name: 'previousOwner', type: 'address' },
      { indexed: true, name: 'newOwner', type: 'address' },
    ],
  },
] as const;

const ROLE_GRANTED_EVENT_ABI = [
  {
    type: 'event',
    name: 'RoleGranted',
    inputs: [
      { indexed: true, name: 'role', type: 'bytes32' },
      { indexed: true, name: 'account', type: 'address' },
      { indexed: true, name: 'sender', type: 'address' },
    ],
  },
] as const;

const ROLE_REVOKED_EVENT_ABI = [
  {
    type: 'event',
    name: 'RoleRevoked',
    inputs: [
      { indexed: true, name: 'role', type: 'bytes32' },
      { indexed: true, name: 'account', type: 'address' },
      { indexed: true, name: 'sender', type: 'address' },
    ],
  },
] as const;

const NEW_ADMIN_EVENT_ABI = [
  {
    type: 'event',
    name: 'NewAdmin',
    inputs: [{ indexed: true, name: 'newAdmin', type: 'address' }],
  },
] as const;

const NEW_PENDING_ADMIN_EVENT_ABI = [
  {
    type: 'event',
    name: 'NewPendingAdmin',
    inputs: [{ indexed: true, name: 'newPendingAdmin', type: 'address' }],
  },
] as const;

function toAddressLink(address: string, blockExplorerBaseUrl: string): string {
  return toExplorerAddressMarkdownLink(address, blockExplorerBaseUrl);
}

const OWNERSHIP_FUNCTION_ABI = parseAbi([
  'function setOwner(address owner)',
  'function transferOwnership(address newOwner)',
]);

const OWNERSHIP_SELECTORS = new Set(['0x13af4035', '0xf2fde38b']);

const OWNER_ARG_NAMES = new Set(['owner', '_owner', 'newowner', 'new_owner']);

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
  const roleId = typeof role === 'string' && isHex(role) ? role : zeroHash;
  return { id: roleId, name: decodeRoleName(roleId) };
}

function maybeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') return null;
  if (!isHex(value)) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function asHex(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && isHex(value) ? value : null;
}

function asHexTopicList(topics: unknown): [`0x${string}`, ...`0x${string}`[]] | null {
  if (!Array.isArray(topics) || topics.length === 0) return null;

  const parsed: `0x${string}`[] = [];
  for (const topic of topics) {
    const hexTopic = asHex(topic);
    if (!hexTopic) return null;
    parsed.push(hexTopic);
  }

  const [first, ...rest] = parsed;
  return first ? [first, ...rest] : null;
}

type TraceCallLike = {
  from?: string;
  to?: string;
  input?: string;
  function_name?: string;
  decoded_input?: Array<{ soltype?: { name?: string; type?: string }; value?: unknown }>;
  calls?: TraceCallLike[];
};

type OwnershipIntentEvidence = {
  contractAddress: `0x${string}`;
  caller: `0x${string}` | null;
  newOwner: `0x${string}`;
};

type RawAddressTransition = {
  contractAddress: `0x${string}`;
  previous?: `0x${string}`;
  next: `0x${string}`;
};

function isTraceCallLike(value: unknown): value is TraceCallLike {
  return typeof value === 'object' && value !== null;
}

function isOwnershipFunctionName(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.replace(/\s+/g, '').toLowerCase();

  return (
    normalized === 'setowner' ||
    normalized.startsWith('setowner(') ||
    normalized === 'transferownership' ||
    normalized.startsWith('transferownership(')
  );
}

function extractOwnerArgFromDecodedInput(decodedInput: unknown): `0x${string}` | null {
  if (!Array.isArray(decodedInput)) return null;

  let firstAddressArg: `0x${string}` | null = null;

  for (const input of decodedInput) {
    if (typeof input !== 'object' || input === null || !('soltype' in input)) continue;

    const soltype = input.soltype;
    if (typeof soltype !== 'object' || soltype === null) continue;
    if (typeof soltype.type !== 'string' || soltype.type.toLowerCase() !== 'address') continue;

    const parsed = 'value' in input ? maybeAddress(input.value) : null;
    if (!parsed) continue;

    if (typeof soltype.name === 'string' && OWNER_ARG_NAMES.has(soltype.name.toLowerCase())) {
      return parsed;
    }

    if (!firstAddressArg) {
      firstAddressArg = parsed;
    }
  }

  return firstAddressArg;
}

function parseOwnershipIntentFromInput(input: string | undefined): {
  newOwner: `0x${string}`;
} | null {
  if (!input || !isHex(input) || input.length < 10) return null;

  const selector = input.slice(0, 10).toLowerCase();
  if (!OWNERSHIP_SELECTORS.has(selector)) return null;

  try {
    const decoded = decodeFunctionData({ abi: OWNERSHIP_FUNCTION_ABI, data: input });
    const newOwner = maybeAddress(decoded.args[0]);
    if (!newOwner) return null;
    return { newOwner };
  } catch {
    return null;
  }
}

function extractOwnershipIntentEvidence(callTrace: unknown): OwnershipIntentEvidence[] {
  const intents: OwnershipIntentEvidence[] = [];
  const nodes: TraceCallLike[] = [];

  const walk = (node: unknown) => {
    if (!isTraceCallLike(node)) return;
    nodes.push(node);
    if (Array.isArray(node.calls)) {
      for (const child of node.calls) {
        walk(child);
      }
    }
  };

  walk(callTrace);

  for (const node of nodes) {
    const contractAddress = maybeAddress(node.to);
    if (!contractAddress) continue;

    const caller = maybeAddress(node.from);

    if (isOwnershipFunctionName(node.function_name)) {
      const newOwner = extractOwnerArgFromDecodedInput(node.decoded_input);
      if (newOwner) {
        intents.push({
          contractAddress,
          caller,
          newOwner,
        });
        continue;
      }
    }

    const parsedFromInput = parseOwnershipIntentFromInput(node.input);
    if (!parsedFromInput) continue;

    intents.push({
      contractAddress,
      caller,
      newOwner: parsedFromInput.newOwner,
    });
  }

  return intents;
}

function parseAddressFromStorageWord(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string' || !isHex(value)) return null;

  if (value.length === 42) {
    return maybeAddress(value);
  }

  if (value.length !== 66) return null;

  const raw = value.slice(2).toLowerCase();
  if (!/^0{24}[0-9a-f]{40}$/.test(raw)) return null;

  return maybeAddress(`0x${raw.slice(24)}`);
}

function isLinearStorageSlotKey(value: unknown): boolean {
  if (typeof value !== 'string' || !isHex(value)) return false;
  if (value.length !== 66) return false;

  return /^0x0{56}[0-9a-f]{8}$/.test(value.toLowerCase());
}

function extractRawAddressTransitions(stateDiffs: unknown): RawAddressTransition[] {
  if (!Array.isArray(stateDiffs)) return [];

  const transitions: RawAddressTransition[] = [];

  for (const diff of stateDiffs) {
    if (typeof diff !== 'object' || diff === null || !('raw' in diff)) continue;
    const rawEntries = diff.raw;
    if (!Array.isArray(rawEntries)) continue;

    for (const raw of rawEntries) {
      if (typeof raw !== 'object' || raw === null) continue;
      if (!('address' in raw) || !('dirty' in raw) || !('key' in raw)) continue;
      if (!isLinearStorageSlotKey(raw.key)) continue;

      const contractAddress = maybeAddress(raw.address);
      if (!contractAddress) continue;

      const next = parseAddressFromStorageWord(raw.dirty);
      if (!next) continue;

      const previous = 'original' in raw ? parseAddressFromStorageWord(raw.original) : null;
      if (previous && previous.toLowerCase() === next.toLowerCase()) continue;

      transitions.push({
        contractAddress,
        previous: previous ?? undefined,
        next,
      });
    }
  }

  return transitions;
}

function hasOwnershipDiff(
  items: PermissionsDiffItem[],
  contractAddress: `0x${string}`,
  next: `0x${string}`,
): boolean {
  return items.some((item) => {
    if (item.kind !== 'ownership_transferred') return false;
    return (
      item.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
      item.next.toLowerCase() === next.toLowerCase()
    );
  });
}

function stableKey(item: PermissionsDiffItem): string {
  const contractAddress = item.contractAddress.toLowerCase();

  switch (item.kind) {
    case 'ownership_transferred':
    case 'timelock_admin_changed':
    case 'timelock_pending_admin_changed':
      return [
        item.kind,
        contractAddress,
        item.previous?.toLowerCase() ?? '',
        item.next.toLowerCase(),
      ].join(':');
    case 'role_granted':
    case 'role_revoked':
      return [
        item.kind,
        contractAddress,
        item.role.id.toLowerCase(),
        item.account.toLowerCase(),
        item.sender.toLowerCase(),
      ].join(':');
  }
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

function formatAddressOrUnknown(address: string | undefined, blockExplorerBaseUrl: string): string {
  return address ? toAddressLink(address, blockExplorerBaseUrl) : '`unknown`';
}

function formatContractWithLinkedAddress(
  contractName: string | undefined,
  contractAddress: string,
  blockExplorerBaseUrl: string,
): string {
  const contractLink = toAddressLink(contractAddress, blockExplorerBaseUrl);

  if (!contractName) {
    return contractLink;
  }

  const nameMatch = contractName.match(/^(.+?)\s+at\s+`0x[0-9a-fA-F]{40}`$/);
  if (nameMatch) {
    return `${nameMatch[1]} at ${contractLink}`;
  }

  return `${contractName} (${contractLink})`;
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
  async checkProposal(_, sim, deps, _l2Simulations) {
    const warnings: string[] = [];
    const info: string[] = [];
    const permissionsDiff: PermissionsDiffItem[] = [];

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
    for (const log of sim.transaction.transaction_info.logs ?? []) {
      const contractAddress = maybeAddress(log.raw?.address);
      if (!contractAddress) continue;

      const topics = asHexTopicList(log.raw?.topics);
      const data = asHex(log.raw?.data);
      if (!topics || !data) continue;

      const topic0 = topics[0].toLowerCase();

      try {
        if (topic0 === OWNERSHIP_TRANSFERRED_TOPIC_LOWER) {
          const decoded = decodeEventLog({
            abi: OWNERSHIP_TRANSFERRED_EVENT_ABI,
            data,
            topics,
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
          continue;
        }

        if (topic0 === ROLE_GRANTED_TOPIC_LOWER) {
          const decoded = decodeEventLog({
            abi: ROLE_GRANTED_EVENT_ABI,
            data,
            topics,
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
          continue;
        }

        if (topic0 === ROLE_REVOKED_TOPIC_LOWER) {
          const decoded = decodeEventLog({
            abi: ROLE_REVOKED_EVENT_ABI,
            data,
            topics,
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
          continue;
        }

        if (topic0 === NEW_ADMIN_TOPIC_LOWER) {
          const decoded = decodeEventLog({
            abi: NEW_ADMIN_EVENT_ABI,
            data,
            topics,
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
          continue;
        }

        if (topic0 === NEW_PENDING_ADMIN_TOPIC_LOWER) {
          const decoded = decodeEventLog({
            abi: NEW_PENDING_ADMIN_EVENT_ABI,
            data,
            topics,
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

    // --- State-diff-based fallbacks (Tenderly decoded state changes) ---
    for (const diff of sim.transaction.transaction_info.state_diff ?? []) {
      if (!diff.soltype?.simple_type) continue;

      const contractAddress = maybeAddress(diff.raw?.[0]?.address);
      if (!contractAddress) continue;

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

    // --- Ownership fallback: correlate ownership-changing call intent with raw state diff writes ---
    const ownershipIntentEvidence = extractOwnershipIntentEvidence(
      sim.transaction.transaction_info.call_trace,
    );
    const rawAddressTransitions = extractRawAddressTransitions(
      sim.transaction.transaction_info.state_diff,
    );

    for (const intent of ownershipIntentEvidence) {
      if (!intent.caller) continue;
      const callerLower = intent.caller.toLowerCase();

      const matchedTransition = rawAddressTransitions.find((transition) => {
        if (transition.contractAddress.toLowerCase() !== intent.contractAddress.toLowerCase()) {
          return false;
        }
        if (transition.next.toLowerCase() !== intent.newOwner.toLowerCase()) return false;
        if (!transition.previous) return false;

        const previousLower = transition.previous.toLowerCase();
        if (previousLower === zeroAddress) return false;

        return previousLower === callerLower;
      });

      if (!matchedTransition) continue;
      if (hasOwnershipDiff(permissionsDiff, intent.contractAddress, intent.newOwner)) continue;

      permissionsDiff.push({
        kind: 'ownership_transferred',
        contractAddress: intent.contractAddress,
        contractName: getContractLabel(intent.contractAddress),
        previous: matchedTransition.previous,
        next: intent.newOwner,
        via: 'state_diff',
      });
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

    const blockExplorerBaseUrl = deps.chainConfig.blockExplorer.baseUrl;

    for (const item of deduped) {
      const contractWithLink = formatContractWithLinkedAddress(
        item.contractName,
        item.contractAddress,
        blockExplorerBaseUrl,
      );

      if (item.kind === 'ownership_transferred') {
        warnings.push(
          `Ownership transfer on ${contractWithLink}: ${formatAddressOrUnknown(
            item.previous,
            blockExplorerBaseUrl,
          )} → ${toAddressLink(item.next, blockExplorerBaseUrl)}`,
        );
      } else if (item.kind === 'role_granted') {
        warnings.push(
          `Role granted on ${contractWithLink}: ${item.role.name ?? item.role.id} to ${toAddressLink(
            item.account,
            blockExplorerBaseUrl,
          )} (by ${toAddressLink(item.sender, blockExplorerBaseUrl)})`,
        );
      } else if (item.kind === 'role_revoked') {
        warnings.push(
          `Role revoked on ${contractWithLink}: ${item.role.name ?? item.role.id} from ${toAddressLink(
            item.account,
            blockExplorerBaseUrl,
          )} (by ${toAddressLink(item.sender, blockExplorerBaseUrl)})`,
        );
      } else if (item.kind === 'timelock_admin_changed') {
        warnings.push(
          `Timelock admin changed on ${contractWithLink}: ${formatAddressOrUnknown(
            item.previous,
            blockExplorerBaseUrl,
          )} → ${toAddressLink(item.next, blockExplorerBaseUrl)}`,
        );
      } else if (item.kind === 'timelock_pending_admin_changed') {
        warnings.push(
          `Timelock pending admin changed on ${contractWithLink}: ${formatAddressOrUnknown(
            item.previous,
            blockExplorerBaseUrl,
          )} → ${toAddressLink(item.next, blockExplorerBaseUrl)}`,
        );
      }
    }

    return { info, warnings, errors: [], permissionsDiff: deduped };
  },
};
