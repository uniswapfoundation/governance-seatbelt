import { exec as execCallback } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import util from 'node:util';
import { getAddress } from 'viem';
import { codeBlock } from '../presentation/report';
import type { ProposalCheck } from '../types';
import { getChainConfig } from '../utils/clients/client';
import { getContractName } from '../utils/clients/tenderly';
import { ETHERSCAN_API_KEY } from '../utils/constants';
import { getImplementation } from '../utils/contracts/governor';

// Convert exec method from a callback to a promise.
const exec = util.promisify(execCallback);

// Data returned from command execution.
type ExecOutput = {
  stdout: string;
  stderr: string;
};

/**
 * Runs slither against the verified contracts and reports the outputs. Assumes slither is already installed.
 */
export const checkSlither: ProposalCheck = {
  name: 'Runs slither against the verified contracts',
  async checkProposal(_, sim, deps) {
    const info: string[] = [];
    const warnings: string[] = [];

    // Skip existing timelock and governor contracts to reduce noise. These contracts are already
    // deployed and in use, and if they are being updated, the new contract will be one of the
    // touched contracts that gets analyzed.
    // NOTE: This requires an archive node since we need to query for the governor implementation
    // at the simulation block number, since the implementation may have changed since.
    const addressesToSkip = new Set([deps.timelock.address, deps.governor.address]);
    try {
      const implementation = await getImplementation(
        deps.governor.address,
        BigInt(sim.transaction.block_number),
      );
      if (implementation) addressesToSkip.add(implementation);
    } catch (e) {
      const msg = `Could not read address of governor implementation at block \`${sim.transaction.block_number}\`. Make sure the \`RPC_URL\` is an archive node. As a result the Slither check will show warnings on the governor's implementation contract.`;
      console.warn(`WARNING: ${msg}. Details:`, e);
      warnings.push(msg);
    }

    // Return early if the only contracts touched are the timelock and governor.
    const contracts = sim.contracts.filter(
      (contract) => !addressesToSkip.has(getAddress(contract.address)),
    );
    if (contracts.length === 0) {
      return {
        info: ['No contracts to analyze: only the timelock and governor are touched'],
        warnings,
        errors: [],
      };
    }

    // Analyze each unique contract
    for (const contract of Array.from(new Set(contracts))) {
      const addr = getAddress(contract.address);
      if (addressesToSkip.has(addr)) continue;

      console.log(`[Slither] Analyzing contract ${contract.contract_name} at ${addr}`);

      // Check if this contract is on a chain that uses Blockscout instead of Etherscan
      let useBlockscout = false;
      let chainConfig = null;
      try {
        chainConfig = getChainConfig(Number.parseInt(contract.network_id));
        console.log(
          `[Slither] Chain ${contract.network_id} uses ${chainConfig.blockExplorer.source} as block explorer`,
        );
        useBlockscout = chainConfig.blockExplorer.source === 'blockscout';
      } catch (e) {
        console.log(`[Slither] Could not get chain config for chain ${contract.network_id}:`, e);
      }

      if (useBlockscout && chainConfig) {
        // Use Blockscout approach for Blockscout chains
        console.log(
          `[Slither] Chain ${contract.network_id} uses Blockscout - attempting to fetch source and run slither locally`,
        );
        const slitherOutput = await runSlitherOnBlockscoutContract(
          contract.address,
          chainConfig.blockExplorer.apiUrl,
        );
        if (!slitherOutput) {
          const msg = `Slither analysis failed for ${contract.contract_name} at ${addr} - could not fetch source from Blockscout`;
          console.log(`[Slither] ${msg}`);
          warnings.push(msg);
          continue;
        }

        console.log(`[Slither] Slither completed successfully for ${addr} (Blockscout source)`);
        console.log(`[Slither] Output length: ${slitherOutput.stderr.length} characters`);

        const contractName = await getContractName(contract);
        info.push(
          `Slither report for ${contractName} (Blockscout source)${codeBlock(slitherOutput.stderr.trim())}`,
        );
      } else {
        // Use original Etherscan approach for Etherscan chains
        console.log(`[Slither] Running slither on ${addr}...`);
        const slitherOutput = await runSlither(contract.address);
        if (!slitherOutput) {
          const msg = `Slither execution failed for \`${contract.contract_name}\` at \`${addr}\``;
          console.log(`[Slither] ${msg}`);
          warnings.push(msg);
          continue;
        }

        console.log(`[Slither] Slither completed successfully for ${addr}`);
        console.log(`[Slither] Output length: ${slitherOutput.stderr.length} characters`);

        // Append results to report info.
        // Note that slither supports a `--json` flag  we could use, but directly printing the formatted
        // results in a code block is simpler and sufficient for now.
        const contractName = await getContractName(contract);
        info.push(`Slither report for ${contractName}${codeBlock(slitherOutput.stderr.trim())}`);
      }
    }

    return { info, warnings, errors: [] };
  },
};

/**
 * Tries to run slither via python installation in the specified directory.
 * @dev If you have nix/dapptools installed, you'll need to make sure the path to your python
 * executables (find this with `which solc-select`) comes before the path to your nix executables.
 * This may require editing your $PATH variable prior to running this check. If you don't do this,
 * the nix version of solc will take precedence over the solc-select version, and slither will fail.
 */
async function runSlither(address: string): Promise<ExecOutput | null> {
  try {
    return await exec(`slither ${address} --etherscan-apikey ${ETHERSCAN_API_KEY}`);
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'stderr' in e) return e as ExecOutput;
    console.warn(`Error: Could not run slither via Python: ${JSON.stringify(e)}`);
    return null;
  }
}

/**
 * Fetches contract source code from Blockscout and runs slither against it locally.
 */
async function runSlitherOnBlockscoutContract(
  address: string,
  apiUrl: string,
): Promise<ExecOutput | null> {
  try {
    console.log(`[Slither] Fetching source code for ${address} from Blockscout...`);

    // Fetch contract data from Blockscout
    const response = await fetch(`${apiUrl}/smart-contracts/${address}`);
    if (!response.ok) {
      console.warn(`[Slither] Failed to fetch contract data from Blockscout: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.source_code) {
      console.warn(`[Slither] No source code available for ${address} on Blockscout`);
      return null;
    }

    console.log('[Slither] Source code fetched successfully, creating temporary file...');

    // Create temporary directory and file
    const tempDir = join(process.cwd(), 'crytic-export', 'blockscout-contracts');
    mkdirSync(tempDir, { recursive: true });

    const contractName = data.name || 'Contract';
    const fileName = `${contractName}.sol`;
    const filePath = join(tempDir, fileName);

    // Get compiler version
    const compilerVersion = data.compiler_version;
    console.log(`[Slither] Contract compiled with ${compilerVersion}`);

    const sourceCode = data.source_code;

    // Write source code to file
    writeFileSync(filePath, sourceCode);
    console.log(`[Slither] Source code written to ${filePath}`);

    // Switch to appropriate solc version if needed
    let originalSolcVersion = null;
    if (compilerVersion) {
      const versionMatch = compilerVersion.match(/v(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        const targetVersion = versionMatch[1];
        console.log(`[Slither] Switching to solc version ${targetVersion}...`);

        // Get current version
        const { stdout: currentVersion } = await exec('solc --version');
        const currentVersionMatch = currentVersion.match(/Version: (\d+\.\d+\.\d+)/);
        originalSolcVersion = currentVersionMatch ? currentVersionMatch[1] : '0.8.26';

        // Switch to target version
        await exec(`solc-select use ${targetVersion}`);
        console.log(`[Slither] Switched to solc ${targetVersion}`);
      }
    }

    // Run slither on the local file
    console.log('[Slither] Running slither on local file...');
    try {
      const result = await exec(`slither ${filePath}`);
      console.log('[Slither] Slither completed for local file');
      return result;
    } catch (e: unknown) {
      // Slither often returns non-zero exit codes due to warnings, but still produces output
      if (e && typeof e === 'object' && 'stderr' in e && 'stdout' in e) {
        const error = e as ExecOutput;
        // Check if there's actual output (indicating successful analysis)
        if (error.stderr?.includes('analyzed')) {
          console.log('[Slither] Slither completed with warnings for local file');
          return error;
        }
      }
      throw e; // Re-throw if it's not a recoverable error
    } finally {
      // Clean up the temporary file
      unlinkSync(filePath);

      // Restore original solc version
      if (originalSolcVersion) {
        console.log(`[Slither] Restoring solc version to ${originalSolcVersion}...`);
        await exec(`solc-select use ${originalSolcVersion}`);
      }
    }
  } catch (e: unknown) {
    console.warn(`[Slither] Error running slither on Blockscout contract: ${JSON.stringify(e)}`);
    return null;
  }
}
