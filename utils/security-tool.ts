import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { EtherscanExplorer } from './clients/block-explorers/etherscan';
import { usesManagedAccess } from './clients/managed-access';
import { SECURITY_TOOL_TIMEOUT_MS } from './security-constants';

const execute = promisify(execFile);
const compilerInstalls = new Map<string, Promise<void>>();

async function ensureCompiler(version: string): Promise<void> {
  if (!compilerInstalls.has(version)) {
    compilerInstalls.set(
      version,
      (async () => {
        const { stdout } = await execute('solc-select', ['versions'], {
          timeout: SECURITY_TOOL_TIMEOUT_MS,
          env: { ...process.env, SOLC_VERSION: version },
        }).catch(() => ({ stdout: '' }));
        if (!stdout.split('\n').some((line) => line.trim().split(/\s+/)[0] === version)) {
          await execute('solc-select', ['install', version], { timeout: SECURITY_TOOL_TIMEOUT_MS });
        }
      })(),
    );
  }
  await compilerInstalls.get(version);
}

/** Keep local analysis tools local; fetch their verified source through managed access. */
export async function runSecurityTool(
  command: 'slither' | 'crytic-compile',
  address: string,
  chainId: number,
) {
  const apiKey = process.env.ETHERSCAN_API_KEY ?? '';
  if (apiKey || !usesManagedAccess()) {
    return execute(command, [address, '--etherscan-apikey', apiKey], {
      timeout: SECURITY_TOOL_TIMEOUT_MS,
    });
  }
  const source = await new EtherscanExplorer('').fetchContractSource(address, chainId);
  if (!source) throw new Error('Verified Solidity source unavailable for local analysis');
  const version = source.compilerVersion.replace(/^v/, '').split('+')[0];
  await ensureCompiler(version);
  const directory = await mkdtemp(join(tmpdir(), 'seatbelt-analysis-'));
  try {
    // Crytic/Slither need source files for AST locations as well as standard JSON.
    for (const [name, { content }] of Object.entries(source.input.sources)) {
      const path = resolve(directory, name);
      if (!path.startsWith(directory + sep)) throw new Error('Unsafe verified source path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { flag: 'wx' });
    }
    const input = join(directory, '.seatbelt-input.json');
    await writeFile(
      input,
      JSON.stringify({
        ...source.input,
        settings: {
          ...source.input.settings,
          outputSelection: {
            '*': {
              '': ['ast'],
              '*': ['abi', 'metadata', 'devdoc', 'userdoc', 'evm.bytecode', 'evm.deployedBytecode'],
            },
          },
        },
      }),
      { flag: 'wx' },
    );
    return await execute(command, [input, '--compile-force-framework', 'solc-json'], {
      cwd: directory,
      timeout: SECURITY_TOOL_TIMEOUT_MS,
      env: {
        ...process.env,
        SOLC_VERSION: version,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
