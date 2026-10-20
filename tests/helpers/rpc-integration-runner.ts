import assert from 'node:assert/strict';
import solc from 'solc';
import {
  http,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  parseEther,
} from 'viem';
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
    value: parseEther('0.9').toString(),
    state_objects: state,
  });
  assert.equal(spent.transaction.status, true);
  assert.equal(spent.postState?.[nextReceiver].balance, parseEther('0.9').toString());
  assert.equal(await client.getBalance({ address: receiver }), 0n);

  const input = {
    language: 'Solidity',
    sources: {
      'Fixture.sol': {
        content: `pragma solidity ^0.8.30;
    contract Fixture {
      string public constant symbol = "TEST";
      mapping(address => uint) public balanceOf; uint public marker; uint8 public decimals = 6;
      function setDecimals(uint8 value) external { decimals = value; }
      event Transfer(address indexed from, address indexed to, uint value);
      constructor() { balanceOf[msg.sender] = 9000000; }
      function transfer(address to, uint amount) external { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; emit Transfer(msg.sender, to, amount); }
      function transferWithFee(address to, uint amount) external { balanceOf[msg.sender] -= amount; balanceOf[to] += amount - 10; emit Transfer(msg.sender, to, amount); }
      function setBalance(address holder, uint amount) external { balanceOf[holder] = amount; }
      receive() external payable {}
      function withdraw(address to) external { payable(to).transfer(address(this).balance); }
      event Fees(uint baseFee, uint gasPrice, uint targetBalance, uint callerBalance);
      function recordFees() external { emit Fees(block.basefee, tx.gasprice, address(this).balance, msg.sender.balance); }
      function pay(address to) external { payable(to).transfer(1 ether); }
      function refundCaller() external { payable(msg.sender).transfer(1); }
      function clear() external { marker = 0; }
      function set(uint value) external { marker = value; }
      function fail(address to) external payable { payable(to).transfer(msg.value); marker = 99; emit Transfer(msg.sender, to, 42); revert("rollback"); }
    }
    contract UnreadableToken {
      uint8 public constant decimals = 6;
      function balanceOf(address) external pure returns (uint) { revert("unavailable"); }
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

  const snapshot = (sim: typeof token, holder: string, asset: string | null = address) =>
    sim.assetBalances?.find(
      (row) =>
        row.address.toLowerCase() === holder.toLowerCase() &&
        row.tokenAddress?.toLowerCase() === asset?.toLowerCase(),
    );
  assert.equal(snapshot(token, account)?.before, '9000000');
  assert.equal(snapshot(token, account)?.after, '7750000');
  assert.equal(snapshot(token, receiver)?.before, '0');
  assert.equal(snapshot(token, receiver)?.after, '1250000');
  const secondTransfer = await sendSimulation({ ...tokenPayload, state_objects: token.postState });
  assert.equal(snapshot(secondTransfer, receiver)?.before, '1250000');
  assert.equal(snapshot(secondTransfer, receiver)?.after, '2500000');
  const feeTransfer = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({
      abi: compiled.abi,
      functionName: 'transferWithFee',
      args: [receiver, 100n],
    }),
  });
  assert.equal(feeTransfer.transaction.transaction_info.asset_changes?.[0].raw_amount, '100');
  assert.equal(snapshot(feeTransfer, receiver)?.after, '90');
  assert.match(feeTransfer.assetWarnings!.join(' '), /differs from Transfer events/);
  const silent = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({
      abi: compiled.abi,
      functionName: 'setBalance',
      args: [account, 42n],
    }),
  });
  assert.deepEqual(silent.transaction.transaction_info.asset_changes, []);
  assert.equal(snapshot(silent, account)?.before, '9000000');
  assert.equal(snapshot(silent, account)?.after, '42');
  const redenominated = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'setDecimals', args: [18] }),
  });
  assert.equal(snapshot(redenominated, account), undefined);
  assert.match(redenominated.assetWarnings!.join(' '), /denomination changed/);
  const unreadableContract = JSON.parse(solc.compile(JSON.stringify(input))).contracts[
    'Fixture.sol'
  ].UnreadableToken;
  const unreadableReceipt = await client.waitForTransactionReceipt({
    hash: await wallet.deployContract({
      account,
      abi: unreadableContract.abi,
      bytecode: `0x${unreadableContract.evm.bytecode.object}`,
    }),
  });
  const unreadable = await sendSimulation({
    ...tokenPayload,
    to: unreadableReceipt.contractAddress!,
    block_number: Number(unreadableReceipt.blockNumber),
    input: encodeFunctionData({ abi: unreadableContract.abi, functionName: 'decimals' }),
  });
  const unknown = unreadable.assetBalances!.find(
    (row) => row.tokenAddress?.toLowerCase() === unreadableReceipt.contractAddress!.toLowerCase(),
  )!;
  assert.equal(unknown.before, null);
  assert.equal(unknown.after, null);
  assert.match(unreadable.assetWarnings!.join(' '), /unknown balances are not treated as zero/);
  const nativeSender = snapshot(funded, account, null)!;
  assert.equal(
    BigInt(nativeSender.before!) - BigInt(nativeSender.after!),
    parseEther('1') + BigInt(funded.transaction.gas_used!) * BigInt(funded.simulation.gas_price),
  );
  const { checkTreasuryMovement } = await import('../../checks/check-treasury-movement');
  const { checkAssetBalances } = await import('../../checks/check-asset-balances');
  const proposal = { targets: [address] } as never;
  const deps = {
    governor: { address: account },
    timelock: { address: account },
    chainConfig: { blockExplorer: { baseUrl: 'https://etherscan.io' } },
  } as never;
  const treasury = await checkTreasuryMovement.checkProposal(proposal, feeTransfer, deps);
  assert.equal((treasury.data as { totalOutgoingUsd: unknown }).totalOutgoingUsd, null);
  assert.match(treasury.warnings.join(' '), /thresholds were not evaluated/);
  assert.doesNotMatch(treasury.info.join(' '), /: \$0/);
  const report = await checkAssetBalances.checkProposal(proposal, silent, deps);
  assert.match(report.info.join(' '), /-8\.999958/);
  assert.match(report.info.join(' '), /TEST/);
  const selfTransfer = await sendSimulation({
    ...tokenPayload,
    input: encodeFunctionData({
      abi: compiled.abi,
      functionName: 'transfer',
      args: [account, 100n],
    }),
  });
  const selfReport = await checkAssetBalances.checkProposal(proposal, selfTransfer, deps);
  const balanceRows = (result: typeof selfReport) =>
    (
      result.data as {
        rows: Array<{ address: string; tokenAddress: string | null; change: string | null }>;
      }
    ).rows;
  assert.equal(
    balanceRows(selfReport).find(
      (row) =>
        row.tokenAddress?.toLowerCase() === address.toLowerCase() &&
        row.address.toLowerCase() === account.toLowerCase(),
    )?.change,
    '0',
  );
  const unavailableReport = await checkAssetBalances.checkProposal(
    proposal,
    { ...token, assetBalances: [] },
    deps,
  );
  assert.equal(
    balanceRows(unavailableReport).filter(
      (row) => row.tokenAddress?.toLowerCase() === address.toLowerCase(),
    ).length,
    2,
  );
  assert.ok(balanceRows(unavailableReport).every((row) => row.change === null));

  const failed = await sendSimulation({
    ...tokenPayload,
    value: parseEther('1').toString(),
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'fail', args: [receiver] }),
  });
  assert.equal(failed.transaction.status, false);
  assert.equal(snapshot(failed, account)?.before, snapshot(failed, account)?.after);
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
  assert.match(replay.assetWarnings!.join(' '), /unavailable for historical transaction replay/);
  assert.equal(replay.transaction.gas_used, Number(receipt.gasUsed));
  assert.deepEqual(
    replay.transaction.transaction_info.logs?.map((l) => l.raw),
    receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
  );
  assert.equal(replay.transaction.transaction_info.asset_changes?.[0].amount, '2');
  // Fee opcodes must observe the pinned block, even after the node's head fee changes.
  await client.request({
    method: 'anvil_setNextBlockBaseFeePerGas' as never,
    params: ['0x77359400'] as never,
  });
  await client.request({ method: 'evm_mine' as never });
  const feeBlock = Number(await client.getBlockNumber({ cacheTime: 0 }));
  await client.request({
    method: 'anvil_setNextBlockBaseFeePerGas' as never,
    params: ['0xb2d05e00'] as never,
  });
  await client.request({ method: 'evm_mine' as never });
  const feePayload = {
    ...tokenPayload,
    block_number: feeBlock,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'recordFees' }),
  };
  for (const gas_price of [undefined, '4000000000', '0']) {
    const result = await sendSimulation({ ...feePayload, gas_price });
    assert.equal(result.transaction.status, true);
    const log = result.transaction.transaction_info.logs![0].raw;
    const decoded = decodeEventLog({ abi: compiled.abi, ...log } as never);
    const { callerBalance: _callerBalance, ...fees } = decoded.args as Record<string, bigint>;
    assert.deepEqual(fees, {
      baseFee: 2000000000n,
      gasPrice: BigInt(gas_price ?? '2000000000'),
      targetBalance: 0n,
    });
    assert.equal(result.simulation.gas_price, gas_price ?? '2000000000');
  }
  const synthetic = '0x0000000000000000000000000000000000009876';
  await assert.rejects(
    sendSimulation({ ...feePayload, from: synthetic }),
    'Anvil requires a gas balance for a nonzero-price call',
  );
  const sponsored = await sendSimulation({
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
  });
  assert.equal(sponsored.transaction.status, true);
  assert.equal(sponsored.postState?.[synthetic]?.balance, '0');
  assert.equal(snapshot(sponsored, synthetic, null)?.before, '0');
  assert.equal(snapshot(sponsored, synthetic, null)?.after, '0');
  const sponsoredLog = sponsored.transaction.transaction_info.logs![0].raw;
  assert.equal(
    (decodeEventLog({ abi: compiled.abi, ...sponsoredLog } as never).args as Record<string, bigint>)
      .callerBalance,
    0n,
  );
  const repeated = await sendSimulation({
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
    state_objects: sponsored.postState,
  });
  assert.equal(repeated.transaction.status, true);
  assert.equal(repeated.postState?.[synthetic]?.balance, '0');
  const marked = await sendSimulation({
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'set', args: [7n] }),
  });
  const refundedStorage = await sendSimulation({
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
    state_objects: marked.postState,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'clear' }),
  });
  assert.equal(refundedStorage.transaction.status, true);
  assert.equal(refundedStorage.postState?.[synthetic]?.balance, '0');
  const incoming = await sendSimulation({
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
    state_objects: { [address]: { balance: '1' } },
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'refundCaller' }),
  });
  assert.equal(incoming.transaction.status, true);
  assert.equal(incoming.postState?.[synthetic]?.balance, '1');
  assert.equal(await client.getBalance({ address: synthetic }), 0n);
  // Gas funding cannot become message value, even on providers that skip gas debiting.
  const receiverValue = {
    ...feePayload,
    from: synthetic,
    to: receiver,
    input: '0x',
    value: '1',
    fund_synthetic_sender: true,
  };
  await assert.rejects(sendSimulation(receiverValue), /insufficient balance for call value/);
  const suppliedValue = await sendSimulation({
    ...receiverValue,
    state_objects: { [synthetic]: { balance: '1' } },
  });
  assert.equal(suppliedValue.transaction.status, true);
  assert.equal(suppliedValue.transaction.transaction_info.asset_changes?.[0].raw_amount, '1');
  assert.equal(suppliedValue.postState?.[synthetic]?.balance, '0');
  const zeroPrice = await sendSimulation({
    ...receiverValue,
    gas_price: '0',
    state_objects: { [synthetic]: { balance: '1' } },
  });
  assert.equal(zeroPrice.transaction.status, true);
  assert.equal(zeroPrice.postState?.[synthetic]?.balance, '0');
  // A gas allowance for the artificial executor cannot make an empty treasury spendable.
  const payPayload = {
    ...feePayload,
    from: synthetic,
    fund_synthetic_sender: true,
    input: encodeFunctionData({ abi: compiled.abi, functionName: 'pay', args: [receiver] }),
  };
  const emptyTreasury = await sendSimulation(payPayload);
  assert.equal(emptyTreasury.transaction.status, false);
  assert.equal(emptyTreasury.postState?.[synthetic]?.balance, '0');
  assert.deepEqual(emptyTreasury.transaction.transaction_info.asset_changes, []);
  const fundedTreasury = await sendSimulation({
    ...payPayload,
    state_objects: { [address]: { balance: parseEther('1').toString() } },
  });
  assert.equal(fundedTreasury.transaction.status, true);
  assert.equal(
    fundedTreasury.transaction.transaction_info.asset_changes?.[0].raw_amount,
    parseEther('1').toString(),
  );
  assert.equal(await client.getBalance({ address }), 0n);
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
      pinnedFees: true,
      callerFundingPreservesTreasury: true,
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
