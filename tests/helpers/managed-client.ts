import assert from 'node:assert/strict';
import { publicClient } from '../../utils/clients/client';
import { prepareManagedAccess } from '../../utils/clients/managed-access';
import { sendRpcSimulation } from '../../utils/clients/rpc-simulation';

await prepareManagedAccess();
const recipient = '0x0000000000000000000000000000000000008000';
const block = await publicClient.getBlockNumber();
const result = await sendRpcSimulation({
  network_id: '1',
  block_number: Number(block),
  from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  to: recipient,
  input: '0x',
  gas: 300_000,
  value: '1000000000000000000',
});
assert.equal(result.transaction.status, true);
assert.equal(result.postState?.[recipient].balance, '1000000000000000000');
assert.equal(await publicClient.getBalance({ address: recipient }), 0n);
console.log('Managed simulation passed; chain balance unchanged.');
