import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { createRelayFetchHandler } from '../relay/server';

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('managed access remembers the terminal code, simulates through real RPC, and enforces shared quotas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seatbelt-access-'));
  const redisPort = await freePort();
  const rpcPort = await freePort();
  const redisProcess = Bun.spawn(
    ['redis-server', '--port', String(redisPort), '--save', '', '--appendonly', 'no'],
    { stdout: 'ignore', stderr: 'ignore', cwd: directory },
  );
  const node = Bun.spawn(
    ['anvil', '--silent', '--no-request-size-limit', '--port', String(rpcPort), '--chain-id', '1'],
    {
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  const redis = {
    async send(command: string, args: string[]) {
      const child = Bun.spawn(['redis-cli', '-p', String(redisPort), '--json', command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [output, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (status !== 0) throw new Error(error);
      return JSON.parse(output);
    },
  };
  const upstream = `http://127.0.0.1:${rpcPort}`;
  let upstreamRequests = 0;
  let storageAvailable = true;
  // Upstash and QuickNode's external HTTP boundaries point to real local Redis and Anvil.
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/redis') {
        if (!storageAvailable) return Response.json({ error: 'unavailable' }, { status: 503 });
        const [command, ...args] = await request.json();
        return Response.json({ result: await redis.send(command, args) });
      }
      upstreamRequests++;
      return fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await request.text(),
      });
    },
  });
  const code = `local-fixture-${'access'.repeat(5)}`;
  const env = {
    QUICKNODE_RPC_URL: `${provider.url}rpc`,
    ETHERSCAN_API_KEY: 'local-fixture',
    UPSTASH_REDIS_REST_URL: `${provider.url}redis`,
    UPSTASH_REDIS_REST_TOKEN: 'local-fixture',
    SEATBELT_ACCESS_CODE_SHA256: createHash('sha256').update(code).digest('hex'),
    SEATBELT_REQUESTS_PER_DAY: '1000',
  };
  const first = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: createRelayFetchHandler({ env }),
  });
  let secondProcess: Subprocess<'ignore', 'ignore', 'pipe'> | undefined;
  const post = (server: { url: URL }, body: unknown, access = code) =>
    fetch(`${server.url}api/v1/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const query = { chainId: 1, method: 'eth_chainId', params: [] };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await redis.send('PING', []);
        await fetch(upstream);
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    expect((await post(first, query, 'wrong')).status).toBe(401);
    expect(
      (await post(first, { ...query, method: 'eth_sendRawTransaction', params: ['0x'] })).status,
    ).toBe(400);
    expect(
      (
        await post(first, {
          ...query,
          method: 'debug_traceCall',
          params: [{}, 'latest', { tracer: '({step(){}})' }],
        })
      ).status,
    ).toBe(400);
    expect((await post(first, { ...query, chainId: 7777777 })).status).toBe(503);
    expect((await post(first, { ...query, extra: 'x'.repeat(1024 * 1024) })).status).toBe(413);
    expect(upstreamRequests).toBe(0);
    expect(await (await post(first, query)).json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: '0x1',
    });

    const control = join(directory, 'terminal.json');
    await writeFile(
      control,
      JSON.stringify({
        code,
        command: [process.execPath, '--no-env-file', resolve('tests/helpers/managed-client.ts')],
      }),
      { mode: 0o600 },
    );
    const run = async () => {
      const child = Bun.spawn(['python3', resolve('tests/helpers/access-terminal.py'), control], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          XDG_CONFIG_HOME: join(directory, 'config'),
          SEATBELT_RELAY_URL: first.url.origin,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ stderr, exitCode }).toEqual({ stderr: '', exitCode: 0 });
      expect(stdout).not.toContain(code);
      return JSON.parse(stdout);
    };
    const initial = await run();
    expect(initial.exitCode).toBe(0);
    expect(initial.prompts).toBe(1);
    expect(initial.output).toContain('Managed simulation passed; chain balance unchanged.');
    const repeated = await run();
    expect(repeated.exitCode).toBe(0);
    expect(repeated.prompts).toBe(0);
    expect(repeated.output).toContain('Managed simulation passed; chain balance unchanged.');
    const [saved] = await readdir(join(directory, 'config', 'seatbelt'));
    expect((await stat(join(directory, 'config', 'seatbelt', saved))).mode & 0o777).toBe(0o600);

    // Exercise the deployed Node adapter as well as the local Bun server.
    const bundle = await Bun.build({
      entrypoints: [resolve('tests/helpers/managed-node-relay.ts')],
      target: 'node',
      format: 'esm',
    });
    expect(bundle.success).toBe(true);
    const entry = join(directory, 'relay.mjs');
    await writeFile(entry, await bundle.outputs[0].text());
    const secondPort = await freePort();
    const second = { url: new URL(`http://127.0.0.1:${secondPort}/`) };
    secondProcess = Bun.spawn(['node', entry], {
      env: {
        PATH: process.env.PATH,
        ...env,
        PORT: String(secondPort),
        SEATBELT_REQUESTS_PER_DAY: '5',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(`${second.url}api/v1/health`);
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
    // A real oversized RPC result must survive the Node adapter's gzip transport intact.
    const largeCode = `0x${'5a'.repeat(3 * 1024 * 1024)}`;
    await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'anvil_setCode',
        params: ['0x0000000000000000000000000000000000008001', largeCode],
      }),
    });
    await redis.send('FLUSHDB', []);
    const largeResponse = await post(second, {
      chainId: 1,
      method: 'eth_getCode',
      params: ['0x0000000000000000000000000000000000008001', 'latest'],
    });
    expect(largeResponse.headers.get('content-encoding')).toBe('gzip');
    expect((await largeResponse.json()).result).toBe(largeCode);

    // Real Redis is shared by independent production handlers; quota exhaustion never hits RPC.
    await redis.send('FLUSHDB', []);
    env.SEATBELT_REQUESTS_PER_DAY = '5';
    const before = upstreamRequests;
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) => post(i % 2 ? first : second, query)),
    );
    expect(responses.filter((response) => response.status === 200).length).toBe(5);
    expect(responses.filter((response) => response.status === 429).length).toBe(7);
    expect(upstreamRequests - before).toBe(5);
    expect(
      Number(responses.find((response) => response.status === 429)?.headers.get('retry-after')),
    ).toBeGreaterThan(86000);
    storageAvailable = false;
    expect((await post(first, query)).status).toBe(503);
    expect(upstreamRequests - before).toBe(5);
    env.SEATBELT_ACCESS_CODE_SHA256 = createHash('sha256').update('rotated').digest('hex');
    expect((await post(first, query)).status).toBe(401);
  } finally {
    first.stop(true);
    secondProcess?.kill();
    provider.stop(true);
    node.kill();
    redisProcess.kill();
    await Promise.all([node.exited, redisProcess.exited, secondProcess?.exited]);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
