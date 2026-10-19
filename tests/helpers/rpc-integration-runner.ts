import assert from 'node:assert/strict';
import solc from 'solc';
import { http, createPublicClient, createWalletClient, encodeFunctionData, parseEther } from 'viem';
import { mainnet } from 'viem/chains';

// Local contracts have no external explorer record; only that HTTP boundary is unavailable.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1')
    return Promise.resolve(new Response('Local fixture has no explorer record', { status: 404 }));
  return realFetch(input, init);
}) as typeof fetch;
for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) console[method] = () => {};

try {
  const { sendSimulation } = await import('../../utils/clients/tenderly-api');
  const { extractStateOverridesFromSimulation, mergeStateObjects } = await import(
    '../../utils/derived-state'
  );
  const client = createPublicClient({ chain: mainnet, transport: http(process.env.RPC_URL) });
  const wallet = createWalletClient({ chain: mainnet, transport: http(process.env.RPC_URL) });
  const [account] = await wallet.getAddresses();
  const receiver = '0x000000000000000000000000000000000000aB01';
  const nextReceiver = '0x000000000000000000000000000000000000aB02';
  const block = Number(await client.getBlockNumber({ cacheTime: 0 }));
  const payload = {
    network_id: '1' as const,
    block_number: block,
    from: account,
    to: receiver,
    input: '0x',
    gas: 1000000,
    gas_price: '0',
    value: parseEther('1').toString(),
  };
  const funded = await sendSimulation(payload);
  assert.equal(funded.transaction.status, true);
  assert.equal(
    funded.transaction.transaction_info.asset_changes?.[0].raw_amount,
    parseEther('1').toString(),
  );
  const state = extractStateOverridesFromSimulation(funded);
  assert.equal(state[receiver].balance, parseEther('1').toString());
  const spent = await sendSimulation({
    ...payload,
    from: receiver,
    to: nextReceiver,
    state_objects: state,
  });
  assert.equal(spent.transaction.status, true);
  assert.equal(spent.postState?.[nextReceiver].balance, parseEther('1').toString());
  assert.equal(await client.getBalance({ address: receiver }), 0n);

  const input = {
    language: 'Solidity',
    sources: {
      'Fixture.sol': {
        content: `pragma solidity ^0.8.30;
    contract Fixture {
      string public constant symbol = "TEST"; uint8 public constant decimals = 6;
      mapping(address => uint) public balanceOf; uint public marker;
      event Transfer(address indexed from, address indexed to, uint value);
      constructor() { balanceOf[msg.sender] = 9000000; }
      function transfer(address to, uint amount) external { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; emit Transfer(msg.sender, to, amount); }
      receive() external payable {}
      function withdraw(address to) external { payable(to).transfer(address(this).balance); }
      function clear() external { marker = 0; }
      function set(uint value) external { marker = value; }
      function fail(address to) external payable { payable(to).transfer(msg.value); marker = 99; emit Transfer(msg.sender, to, 42); revert("rollback"); }
    }`,
      },
    },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input))).contracts['Fixture.sol'].Fixture;
  const deployment = await client.waitForTransactionReceipt({
    hash: await wallet.deployContract({
      account,
      abi: compiled.abi,
      bytecode: `0x${compiled.evm.bytecode.object}`,
    }),
  });
  const address = deployment.contractAddress!;
  const tokenPayload = {
    ...payload,
    to: address,
    block_number: Number(await client.getBlockNumber({ cacheTime: 0 })),
    value: '0',
    input: encodeFunctionData({
      abi: compiled.abi,
      functionName: 'transfer',
      args: [receiver, 1250000n],
    }),
  };
  const deposit = await sendSimulation({
    ...tokenPayload,
    input: '0x',
    value: parseEther('1').toString(),
  });
  const depositState = extractStateOverridesFromSimulation(deposit);
  const storageOnly = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'set', args: [7n] }),
    state_objects: depositState,
  });
  const accumulated = mergeStateObjects(
    depositState,
    extractStateOverridesFromSimulation(storageOnly),
  );
  const withdrawal = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'withdraw', args: [receiver] }),
    state_objects: accumulated,
  });
  assert.equal(withdrawal.transaction.status, true);
  assert.equal(
    withdrawal.transaction.transaction_info.asset_changes?.[0].raw_amount,
    parseEther('1').toString(),
  );
  assert.equal(await client.getBalance({ address }), 0n);

  const token = await sendSimulation(tokenPayload);
  assert.equal(token.transaction.status, true);
  const movement = token.transaction.transaction_info.asset_changes?.find(
    (c) => c.token_info.standard === 'ERC20',
  );
  assert.equal(movement?.raw_amount, '1250000');
  assert.equal(movement?.amount, '1.25');
  assert.equal(movement?.token_info.symbol, 'TEST');

  const failed = await sendSimulation({
    ...tokenPayload,
    value: parseEther('1').toString(),
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'fail', args: [receiver] }),
  });
  assert.equal(failed.transaction.status, false);
  assert.deepEqual(failed.transaction.transaction_info.asset_changes, []);
  assert.deepEqual(failed.transaction.transaction_info.logs, []);
  assert.deepEqual(failed.transaction.transaction_info.state_diff, []);
  const set = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'set', args: [7n] }),
  });
  const cleared = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'clear' }),
    state_objects: extractStateOverridesFromSimulation(set),
  });
  assert.equal(cleared.transaction.status, true);
  assert.equal(
    cleared.transaction.transaction_info.state_diff[0].raw[0].dirty,
    `0x${'0'.repeat(64)}`,
  );
  assert.notEqual(cleared.postState?.[address]?.code, '0x');

  const hash = await wallet.writeContract({
    account,
    address,
    abi: compiled.abi,
    functionName: 'transfer',
    args: [receiver, 2000000n],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const tx = await client.getTransaction({ hash });
  const replay = await sendSimulation({
    ...tokenPayload,
    block_number: Number(receipt.blockNumber),
    transaction_hash: hash,
    input: tx.input,
    gas: Number(tx.gas),
    gas_price: (tx.gasPrice ?? 0n).toString(),
  });
  assert.equal(replay.transaction.status, true);
  assert.equal(replay.transaction.gas_used, Number(receipt.gasUsed));
  assert.deepEqual(
    replay.transaction.transaction_info.logs?.map((l) => l.raw),
    receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
  );
  assert.equal(replay.transaction.transaction_info.asset_changes?.[0].amount, '2');
  await (await import('./rpc-oz-integration')).verifyOzDraft();
  process.stdout.write(
    `${JSON.stringify({
      nativeTransfer: true,
      dependentBalance: true,
      tokenTransfer: true,
      atomicRollback: true,
      storageCleared: true,
      exactReplay: true,
      ozDraft: true,
      noBroadcastFromSimulation: true,
    })}\n`,
  );
} catch (error) {
  // viem errors can embed transport details; only the assertion summary is safe to print.
  process.stderr.write(
    error instanceof assert.AssertionError
      ? `Assertion failed: ${error.message}\n`
      : `Integration failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
  );
  process.exitCode = 1;
}
