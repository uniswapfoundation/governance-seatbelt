import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';

export function usesManagedAccess(): boolean {
  return !process.env.QUICKNODE_RPC_URL?.trim();
}

function relayOrigin(): string {
  const url = new URL(process.env.SEATBELT_RELAY_URL || 'https://seatbelt-relay-beta.vercel.app');
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Seatbelt relay must use HTTPS (or localhost for development).');
  return url.origin;
}

function accessFile(): string {
  const relayId = createHash('sha256').update(relayOrigin()).digest('hex').slice(0, 16);
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    'seatbelt',
    `${relayId}.json`,
  );
}

async function request(route: string, code: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${relayOrigin()}/api/v1/${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error('Seatbelt managed service could not be reached. Try again shortly.');
  }
}

async function readCode(): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      'Seatbelt needs team access. Run this command once in an interactive terminal to enter your access code.',
    );
  }
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stderr.write('Seatbelt team access code (saved for future runs): ');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.off('end', onEnd);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onEnd = () => finish(new Error('Seatbelt access cancelled.'));
    const onKey = (text: string, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && ['c', 'd'].includes(key.name ?? '')) return onEnd();
      if (key.name === 'return') return finish();
      if (key.name === 'backspace') value = value.slice(0, -1);
      else if (!key.ctrl && !key.meta && text && /^[\x21-\x7e]+$/.test(text))
        value = (value + text).slice(0, 256);
    };
    process.stdin.on('keypress', onKey);
    process.stdin.once('end', onEnd);
  });
}

let access: Promise<string> | undefined;

async function authorize(): Promise<string> {
  let code = '';
  try {
    const saved = JSON.parse(await readFile(accessFile(), 'utf8'));
    if (typeof saved?.code === 'string' && /^[\x21-\x7e]{24,256}$/.test(saved.code))
      code = saved.code;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        'Could not read saved Seatbelt access. Check your user configuration directory permissions.',
      );
    }
  }
  if (code) {
    const response = await request('access', code);
    await response.body?.cancel();
    if (response.ok) return code;
    if (response.status !== 401)
      throw new Error(`Seatbelt managed service unavailable (HTTP ${response.status}).`);
    process.stderr.write('Your saved Seatbelt access code is no longer valid.\n');
  }
  code = await readCode();
  if (!/^[\x21-\x7e]{24,256}$/.test(code))
    throw new Error('Enter the full access code supplied by your team.');
  const response = await request('access', code);
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Seatbelt access code was not accepted.'
        : `Seatbelt managed service unavailable (HTTP ${response.status}).`,
    );
  const path = accessFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ code }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  process.stderr.write('Seatbelt access saved.\n');
  return code;
}

export async function prepareManagedAccess(): Promise<void> {
  if (!usesManagedAccess()) return;
  access ??= authorize();
  await access;
}

export async function managedFetch(route: 'rpc' | 'explorer', body: unknown): Promise<Response> {
  access ??= authorize();
  const code = await access;
  const response = await request(route, code, body);
  if (response.status === 401) {
    await response.body?.cancel();
    throw new Error('Seatbelt access was revoked. Run the command again to enter a new code.');
  }
  return response;
}
