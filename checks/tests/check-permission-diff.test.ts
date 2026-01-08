import { describe, expect, test } from 'bun:test';
import { getAddress, keccak256, toBytes, zeroHash } from 'viem';
import type { ProposalData, ProposalEvent, TenderlySimulation } from '../../types';
import { checkPermissionDiff } from '../check-permission-diff';

function eventTopic(signature: string): `0x${string}` {
  return keccak256(toBytes(signature));
}

function padTopic(value: string): `0x${string}` {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return `0x${hex.padStart(64, '0')}` as `0x${string}`;
}

function topicAddress(address: string): `0x${string}` {
  return padTopic(address);
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

    const sim = {
      contracts: [],
      transaction: {
        status: true,
        transaction_info: {
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
          state_diff: [
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
        },
      },
    } as unknown as TenderlySimulation;

    const deps = { chainConfig: { chainId: 1 } } as unknown as ProposalData;

    const result = await checkPermissionDiff.checkProposal(
      {} as unknown as ProposalEvent,
      sim,
      deps,
    );

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

  test('reports none when there are no permission changes', async () => {
    const sim = {
      contracts: [],
      transaction: { status: true, transaction_info: { logs: [], state_diff: [] } },
    } as unknown as TenderlySimulation;
    const deps = { chainConfig: { chainId: 1 } } as unknown as ProposalData;

    const result = await checkPermissionDiff.checkProposal(
      {} as unknown as ProposalEvent,
      sim,
      deps,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.permissionsDiff).toEqual([]);
    expect(result.info).toContain('Permission changes: none');
  });
});
