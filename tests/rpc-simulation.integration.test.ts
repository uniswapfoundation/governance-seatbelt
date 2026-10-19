import { expect, test } from 'bun:test';
import net from 'node:net';

// A separate process keeps chain configuration independent of other suites' module fixtures.
test('RPC-only execution preserves transfers, linked state, rollback, and historical replay', async () => {
  const anvil = Bun.which('anvil');
  if (!anvil) throw new Error('Anvil is required for RPC integration verification');
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const url = `http://${'127.0.0.1'}:${port}`;
  const node = Bun.spawn([anvil, '--silent', '--port', String(port), '--chain-id', '1'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(url);
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    const run = Bun.spawn([process.execPath, 'tests/helpers/rpc-integration-runner.ts'], {
      env: {
        ...process.env,
        RPC_URL: url,
        MAINNET_RPC_URL: url,
        QUICKNODE_RPC_URL: url,
        ETHERSCAN_API_KEY: 'local-fixture',
        ZORA_RPC_URL: '',
        TENDERLY_ACCESS_TOKEN: '',
        TENDERLY_USER: '',
        TENDERLY_PROJECT_SLUG: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      run.exited,
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      nativeTransfer: true,
      dependentBalance: true,
      tokenTransfer: true,
      atomicRollback: true,
      storageCleared: true,
      exactReplay: true,
      ozDraft: true,
      noBroadcastFromSimulation: true,
    });
  } finally {
    node.kill();
    await node.exited;
  }
}, 120000);
