import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, zeroHash } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { BlockExplorerFactory } from '../../utils/clients/block-explorers/factory';
import { BlockExplorerSource, VerificationBackend } from '../../utils/clients/client';
import { checkPermissionDiff } from '../check-permission-diff';
import { createMockSimulation } from './test-utils';

function eventTopic(signature: string): `0x${string}` {
  return keccak256(toBytes(signature));
}

function padTopic(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return `0x${hex.padStart(64, '0')}`;
}

function topicAddress(address: string): string {
  return padTopic(address);
}

function createDeps(
  chainId: number,
  blockExplorerBaseUrl: string,
  verification?: ProposalData['chainConfig']['verification'],
): ProposalData {
  return {
    governor: {},
    timelock: {},
    publicClient: {},
    chainConfig: {
      chainId,
      rpcUrl: 'https://example.invalid',
      blockExplorer: {
        baseUrl: blockExplorerBaseUrl,
        apiUrl: `${blockExplorerBaseUrl}/api`,
        source: BlockExplorerSource.Etherscan,
      },
      verification,
    },
    targets: [],
    touchedContracts: [],
  };
}

function createProposalEvent(): ProposalEvent {
  return {
    id: 1n,
    proposalId: 1n,
    proposer: '0x0000000000000000000000000000000000000001',
    startBlock: 1n,
    endBlock: 2n,
    description: 'test proposal',
    targets: [],
    values: [],
    signatures: [],
    calldatas: [],
  };
}

type SimulationLog = NonNullable<
  TenderlySimulation['transaction']['transaction_info']['logs']
>[number];

type SimulationStateDiffInput = {
  soltype: {
    name: string;
    type: string;
    storage_location: string;
    components: null;
    offset: number;
    index: string;
    indexed: boolean;
    simple_type: { type: string };
  } | null;
  original: string | Record<string, string>;
  dirty: string | Record<string, string>;
  raw: Array<{ address: string; key: string; original: string; dirty: string }>;
};

function createSimulation({
  logs = [],
  stateDiff = [],
  callTrace,
}: {
  logs?: SimulationLog[];
  stateDiff?: SimulationStateDiffInput[];
  callTrace?: TenderlySimulation['transaction']['transaction_info']['call_trace'];
}): TenderlySimulation {
  const simulation = createMockSimulation([]);
  Object.assign(simulation.transaction.transaction_info, {
    logs,
    state_diff: stateDiff,
  });

  if (callTrace) {
    simulation.transaction.transaction_info.call_trace = callTrace;
  }

  return simulation;
}

describe('checkPermissionDiff', () => {
  test('detects ownership, roles, and timelock admin changes and emits structured diff', async () => {
    const ownershipTopic0 = eventTopic('OwnershipTransferred(address,address)');
    const roleGrantedTopic0 = eventTopic('RoleGranted(bytes32,address,address)');
    const newAdminTopic0 = eventTopic('NewAdmin(address)');

    const contractOwnable = '0x1111111111111111111111111111111111111111';
    const prevOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const nextOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const contractAccess = '0x2222222222222222222222222222222222222222';
    const proposerRole = keccak256(toBytes('PROPOSER_ROLE'));
    const roleAccount = '0xcccccccccccccccccccccccccccccccccccccccc';
    const roleSender = '0xdddddddddddddddddddddddddddddddddddddddd';

    const contractTimelock = '0x3333333333333333333333333333333333333333';
    const prevAdmin = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const nextAdmin = '0xffffffffffffffffffffffffffffffffffffffff';

    const sim = createSimulation({
      logs: [
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contractOwnable,
            topics: [ownershipTopic0, topicAddress(prevOwner), topicAddress(nextOwner)],
            data: '0x',
          },
        },
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contractAccess,
            topics: [
              roleGrantedTopic0,
              padTopic(proposerRole),
              topicAddress(roleAccount),
              topicAddress(roleSender),
            ],
            data: '0x',
          },
        },
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contractTimelock,
            topics: [newAdminTopic0, topicAddress(nextAdmin)],
            data: '0x',
          },
        },
      ],
      stateDiff: [
        {
          soltype: {
            name: 'admin',
            type: 'address',
            storage_location: 'storage',
            components: null,
            offset: 0,
            index: '0',
            indexed: false,
            simple_type: { type: 'address' },
          },
          original: prevAdmin,
          dirty: nextAdmin,
          raw: [
            { address: contractTimelock, key: zeroHash, original: prevAdmin, dirty: nextAdmin },
          ],
        },
      ],
    });

    const deps = createDeps(1, 'https://etherscan.io');

    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.errors).toHaveLength(0);
    expect(result.permissionsDiff?.length).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);

    const ownership = result.permissionsDiff?.find((d) => d.kind === 'ownership_transferred');
    expect(ownership).toMatchObject({
      previous: getAddress(prevOwner),
      next: getAddress(nextOwner),
      via: 'event',
    });

    const role = result.permissionsDiff?.find((d) => d.kind === 'role_granted');
    expect(role).toMatchObject({
      role: { name: 'PROPOSER_ROLE' },
      account: getAddress(roleAccount),
      sender: getAddress(roleSender),
    });

    const admin = result.permissionsDiff?.find((d) => d.kind === 'timelock_admin_changed');
    expect(admin).toMatchObject({
      previous: getAddress(prevAdmin),
      next: getAddress(nextAdmin),
      via: 'event+state_diff',
    });
  });

  test('deduplicates ownership transfers detected from both event logs and state diffs', async () => {
    const ownershipTopic0 = eventTopic('OwnershipTransferred(address,address)');
    const contractOwnable = '0x1111111111111111111111111111111111111111';
    const prevOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const nextOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const sim = createSimulation({
      logs: [
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contractOwnable,
            topics: [ownershipTopic0, topicAddress(prevOwner), topicAddress(nextOwner)],
            data: '0x',
          },
        },
      ],
      stateDiff: [
        {
          soltype: {
            name: 'owner',
            type: 'address',
            storage_location: 'storage',
            components: null,
            offset: 0,
            index: '0',
            indexed: false,
            simple_type: { type: 'address' },
          },
          original: prevOwner,
          dirty: nextOwner,
          raw: [{ address: contractOwnable, key: zeroHash, original: prevOwner, dirty: nextOwner }],
        },
      ],
    });

    const result = await checkPermissionDiff.checkProposal(
      createProposalEvent(),
      sim,
      createDeps(1, 'https://etherscan.io'),
    );

    expect(result.permissionsDiff).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.permissionsDiff?.[0]).toMatchObject({
      kind: 'ownership_transferred',
      contractAddress: getAddress(contractOwnable),
      previous: getAddress(prevOwner),
      next: getAddress(nextOwner),
    });
  });

  test('detects ownership transfer via decoded-call + raw state diff fallback for non-canonical cases', async () => {
    const ownerChangedTopic0 = eventTopic('OwnerChanged(address,address)');
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const previousOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const newOwner = '0x2222222222222222222222222222222222222222';

    const setOwnerCalldata = encodeFunctionData({
      abi: parseAbi(['function setOwner(address owner)']),
      functionName: 'setOwner',
      args: [newOwner],
    });

    const sim = createSimulation({
      logs: [
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contract,
            topics: [ownerChangedTopic0, topicAddress(previousOwner), topicAddress(newOwner)],
            data: '0x',
          },
        },
      ],
      callTrace: {
        from: previousOwner,
        to: '0x4200000000000000000000000000000000000007',
        input: '0x12345678',
        calls: [
          {
            from: previousOwner,
            to: contract,
            input: setOwnerCalldata,
          },
        ],
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000003',
              original: topicAddress(previousOwner),
              dirty: topicAddress(newOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    const ownership = result.permissionsDiff?.find((d) => d.kind === 'ownership_transferred');
    expect(ownership).toMatchObject({
      contractAddress: getAddress(contract),
      previous: getAddress(previousOwner),
      next: getAddress(newOwner),
      via: 'state_diff',
    });
    expect(result.warnings.join('\n')).toContain('Ownership transfer on Unknown Contract');
  });

  test('uses explorer contract names for permission diffs when Tenderly omits metadata', async () => {
    const ownershipTopic0 = eventTopic('OwnershipTransferred(address,address)');
    const contract = '0x4444444444444444444444444444444444444444';
    const prevOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const nextOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const sim = createSimulation({
      logs: [
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contract,
            topics: [ownershipTopic0, topicAddress(prevOwner), topicAddress(nextOwner)],
            data: '0x',
          },
        },
      ],
    });

    const originalFetchContractName = BlockExplorerFactory.fetchContractName;
    BlockExplorerFactory.fetchContractName = async (address, chainId) => {
      if (chainId === 4326 && getAddress(address) === getAddress(contract)) {
        return 'UniswapV2Factory';
      }
      return null;
    };

    try {
      const result = await checkPermissionDiff.checkProposal(
        createProposalEvent(),
        sim,
        createDeps(4326, 'https://mega.etherscan.io', {
          backend: VerificationBackend.EtherscanV2,
        }),
      );

      expect(result.permissionsDiff?.[0].contractName).toBe(
        `UniswapV2Factory at \`${getAddress(contract)}\``,
      );
      expect(result.warnings.join('\n')).toContain('Ownership transfer on UniswapV2Factory');
    } finally {
      BlockExplorerFactory.fetchContractName = originalFetchContractName;
    }
  });

  test('does not emit ownership fallback when state diff does not confirm decoded call owner', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const previousOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const intendedOwner = '0x2222222222222222222222222222222222222222';
    const actualChangedOwner = '0x3333333333333333333333333333333333333333';

    const setOwnerCalldata = encodeFunctionData({
      abi: parseAbi(['function setOwner(address owner)']),
      functionName: 'setOwner',
      args: [intendedOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: previousOwner,
        to: contract,
        input: setOwnerCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000003',
              original: topicAddress(previousOwner),
              dirty: topicAddress(actualChangedOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });

  test('does not infer ownership transfer from setOwner intent alone', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const currentOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const intendedOwner = '0x2222222222222222222222222222222222222222';

    const setOwnerCalldata = encodeFunctionData({
      abi: parseAbi(['function setOwner(address owner)']),
      functionName: 'setOwner',
      args: [intendedOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: currentOwner,
        to: contract,
        input: setOwnerCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000001',
              original: topicAddress('0x0000000000000000000000000000000000000000'),
              dirty: topicAddress(intendedOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });

  test('does not infer ownership transfer from transferOwnership intent alone', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const currentOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const pendingOwner = '0x2222222222222222222222222222222222222222';

    const transferOwnershipCalldata = encodeFunctionData({
      abi: parseAbi(['function transferOwnership(address newOwner)']),
      functionName: 'transferOwnership',
      args: [pendingOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: currentOwner,
        to: contract,
        input: transferOwnershipCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000001',
              original: topicAddress('0x0000000000000000000000000000000000000000'),
              dirty: topicAddress(pendingOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });

  test('does not infer ownership transfer from hashed-storage slot transitions', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const currentOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const newOwner = '0x2222222222222222222222222222222222222222';

    const transferOwnershipCalldata = encodeFunctionData({
      abi: parseAbi(['function transferOwnership(address newOwner)']),
      functionName: 'transferOwnership',
      args: [newOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: currentOwner,
        to: contract,
        input: transferOwnershipCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              original: topicAddress(currentOwner),
              dirty: topicAddress(newOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });

  test('infers ownership transfer from transferOwnership when previous owner matches caller', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const currentOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const newOwner = '0x2222222222222222222222222222222222222222';

    const transferOwnershipCalldata = encodeFunctionData({
      abi: parseAbi(['function transferOwnership(address newOwner)']),
      functionName: 'transferOwnership',
      args: [newOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: currentOwner,
        to: contract,
        input: transferOwnershipCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000001',
              original: topicAddress(currentOwner),
              dirty: topicAddress(newOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    const ownership = result.permissionsDiff?.find((d) => d.kind === 'ownership_transferred');
    expect(ownership).toMatchObject({
      contractAddress: getAddress(contract),
      previous: getAddress(currentOwner),
      next: getAddress(newOwner),
      via: 'state_diff',
    });
  });

  test('infers transferOwnership when owner-slot transition appears after pending-owner write', async () => {
    const contract = '0x4b2ab38dbf28d31d467aa8993f6c2585981d6804';
    const currentOwner = '0x2bad8182c09f50c8318d769245bea52c32be46cd';
    const newOwner = '0x2222222222222222222222222222222222222222';

    const transferOwnershipCalldata = encodeFunctionData({
      abi: parseAbi(['function transferOwnership(address newOwner)']),
      functionName: 'transferOwnership',
      args: [newOwner],
    });

    const sim = createSimulation({
      logs: [],
      callTrace: {
        from: currentOwner,
        to: contract,
        input: transferOwnershipCalldata,
      },
      stateDiff: [
        {
          soltype: null,
          original: {},
          dirty: {},
          raw: [
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000001',
              original: topicAddress('0x0000000000000000000000000000000000000000'),
              dirty: topicAddress(newOwner),
            },
            {
              address: contract,
              key: '0x0000000000000000000000000000000000000000000000000000000000000002',
              original: topicAddress(currentOwner),
              dirty: topicAddress(newOwner),
            },
          ],
        },
      ],
    });

    const deps = createDeps(196, 'https://www.oklink.com/xlayer');
    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    const ownership = result.permissionsDiff?.find((d) => d.kind === 'ownership_transferred');
    expect(ownership).toMatchObject({
      contractAddress: getAddress(contract),
      previous: getAddress(currentOwner),
      next: getAddress(newOwner),
      via: 'state_diff',
    });
  });

  test('reports none when there are no permission changes', async () => {
    const sim = createSimulation({ logs: [], stateDiff: [] });
    const deps = createDeps(1, 'https://etherscan.io');

    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });

  test('renders cross-chain permission warnings with destination explorer links', async () => {
    const ownershipTopic0 = eventTopic('OwnershipTransferred(address,address)');

    const contractOwnable = '0x4444444444444444444444444444444444444444';
    const prevOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const nextOwner = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const contractTimelock = '0x5555555555555555555555555555555555555555';
    const prevAdmin = '0xcccccccccccccccccccccccccccccccccccccccc';
    const nextAdmin = '0xdddddddddddddddddddddddddddddddddddddddd';

    const sim = createSimulation({
      logs: [
        {
          name: null,
          anonymous: false,
          inputs: [],
          raw: {
            address: contractOwnable,
            topics: [ownershipTopic0, topicAddress(prevOwner), topicAddress(nextOwner)],
            data: '0x',
          },
        },
      ],
      stateDiff: [
        {
          soltype: {
            name: 'admin',
            type: 'address',
            storage_location: 'storage',
            components: null,
            offset: 0,
            index: '0',
            indexed: false,
            simple_type: { type: 'address' },
          },
          original: prevAdmin,
          dirty: nextAdmin,
          raw: [
            { address: contractTimelock, key: zeroHash, original: prevAdmin, dirty: nextAdmin },
          ],
        },
      ],
    });

    const blockExplorerBaseUrl = 'https://worldscan.org';
    const deps = createDeps(480, blockExplorerBaseUrl);

    const result = await checkPermissionDiff.checkProposal(createProposalEvent(), sim, deps);

    const ownershipWarning = result.warnings.find((warning) =>
      warning.startsWith('Ownership transfer on'),
    );
    expect(ownershipWarning).toContain(
      `[${getAddress(contractOwnable)}](${blockExplorerBaseUrl}/address/${getAddress(contractOwnable)})`,
    );
    expect(ownershipWarning).toContain(
      `[${getAddress(prevOwner)}](${blockExplorerBaseUrl}/address/${getAddress(prevOwner)})`,
    );
    expect(ownershipWarning).toContain(
      `[${getAddress(nextOwner)}](${blockExplorerBaseUrl}/address/${getAddress(nextOwner)})`,
    );

    const adminWarning = result.warnings.find((warning) =>
      warning.startsWith('Timelock admin changed on'),
    );
    expect(adminWarning).toContain(
      `[${getAddress(contractTimelock)}](${blockExplorerBaseUrl}/address/${getAddress(contractTimelock)})`,
    );
    expect(adminWarning).toContain(
      `[${getAddress(prevAdmin)}](${blockExplorerBaseUrl}/address/${getAddress(prevAdmin)})`,
    );
    expect(adminWarning).toContain(
      `[${getAddress(nextAdmin)}](${blockExplorerBaseUrl}/address/${getAddress(nextAdmin)})`,
    );
  });
});
