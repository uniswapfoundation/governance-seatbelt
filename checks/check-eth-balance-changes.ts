import { getAddress } from 'viem';
import type { AssetChange, ProposalCheck, TenderlyContract } from '../types';
import { DEFAULT_SIMULATION_ADDRESS, getContractNameFromTenderly } from '../utils/clients/tenderly';

/**
 * Reports detected native asset transfers from the proposal
 */
export const checkEthBalanceChanges: ProposalCheck = {
  name: 'Reports detected native asset transfers from the proposal',
  async checkProposal(proposal, sim, deps) {
    if (sim.transaction.transaction_info.asset_changes == null) {
      return {
        info: [],
        warnings: ['Asset transfer enrichment is unavailable from the simulation provider.'],
        errors: [],
        skipped: { reason: 'Provider did not return asset changes' },
      };
    }
    const info: string[] = [];
    const warnings: string[] = [...(sim.assetWarnings ?? [])];
    const errors: string[] = [];

    const blockExplorerUrl = deps.chainConfig.blockExplorer.baseUrl;

    // Filter for ETH transfers
    const ethTransfers = sim.transaction.transaction_info.asset_changes.filter(
      (change) => change.token_info.standard === 'NativeCurrency',
    );

    if (ethTransfers.length === 0) {
      // Check ran successfully - no ETH transfers to report
      return {
        info: ['No native asset transfers detected in this proposal.'],
        warnings,
        errors,
      };
    }

    // Process ETH transfers
    const significantChanges: string[] = [];
    const minorChanges: string[] = [];

    // Identify key addresses in the transaction
    const governorAddress = sim.transaction.to;
    const timelockAddress = sim.contracts
      .find((c) => c.contract_name.toLowerCase().includes('timelock'))
      ?.address.toLowerCase();
    const proposalTargets = proposal.targets.map((t) => t.toLowerCase());

    // Helper function to find a contract by address
    const findContractByAddress = (address: string) => {
      return sim.contracts.find((c) => getAddress(c.address) === getAddress(address));
    };

    // Generate descriptive messages for ETH transfers
    generateTransferMessages(
      ethTransfers,
      findContractByAddress,
      governorAddress,
      timelockAddress,
      proposalTargets,
      significantChanges,
      minorChanges,
      blockExplorerUrl,
    );

    // Add a blank line after the transfer messages
    if (significantChanges.length > 0) {
      significantChanges.push('');
    }

    // Return the collected info
    if (significantChanges.length > 0) {
      info.push(...significantChanges);
    }

    if (minorChanges.length > 0) {
      info.push('Minor ETH transfers:');
      info.push(''); // Add a line break after the header
      info.push(...minorChanges);
    }

    return { info, warnings, errors };
  },
};

/**
 * Generates descriptive messages for each ETH transfer
 */
function generateTransferMessages(
  ethTransfers: AssetChange[],
  findContractByAddress: (address: string) => TenderlyContract | undefined,
  governorAddress: string,
  timelockAddress: string | undefined,
  proposalTargets: string[],
  significantChanges: string[],
  minorChanges: string[],
  blockExplorerUrl: string,
) {
  for (const transfer of ethTransfers) {
    const from = getAddress(transfer.from);
    const to = getAddress(transfer.to);
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    // Find contracts if they exist
    const fromContract = findContractByAddress(from);
    const toContract = findContractByAddress(to);

    // Format the from/to descriptions more clearly with block explorer links
    let fromName = fromContract
      ? `[${getContractNameFromTenderly(fromContract).split(' at ')[0]}](${blockExplorerUrl}/address/${from})`
      : `[EOA (${from})](${blockExplorerUrl}/address/${from})`;
    let toName = toContract
      ? `[${getContractNameFromTenderly(toContract).split(' at ')[0]}](${blockExplorerUrl}/address/${to})`
      : `[EOA (${to})](${blockExplorerUrl}/address/${to})`;

    // Annotate simulation placeholder EOA clearly
    if (getAddress(from) === getAddress(DEFAULT_SIMULATION_ADDRESS)) {
      fromName += ' (simulation placeholder)';
    }
    if (getAddress(to) === getAddress(DEFAULT_SIMULATION_ADDRESS)) {
      toName += ' (simulation placeholder)';
    }

    // Create appropriate message based on the transfer context
    let message = '';

    if (fromLower === timelockAddress && proposalTargets.includes(toLower)) {
      message = `• ${fromName} sent ${transfer.amount} ETH to ${toName} as part of the proposal execution`;
      significantChanges.push(message);
      // Add a line break after each message
      significantChanges.push('');
    } else if (fromLower === governorAddress && toLower === timelockAddress) {
      message = `• ${fromName} sent ${transfer.amount} ETH to ${toName} for proposal execution`;
      significantChanges.push(message);
      // Add a line break after each message
      significantChanges.push('');
    } else if (proposalTargets.includes(toLower)) {
      message = `• ${toName} received ${transfer.amount} ETH as part of the proposal`;
      significantChanges.push(message);
      // Add a line break after each message
      significantChanges.push('');
    } else if (Number.parseFloat(transfer.amount) >= 0.01) {
      // For other significant transfers (>= 0.01 ETH)
      message = `• ${fromName} sent ${transfer.amount} ETH to ${toName}`;
      significantChanges.push(message);
      // Add a line break after each message
      significantChanges.push('');
    } else {
      // For minor transfers
      message = `• ${transfer.amount} ETH transferred from ${fromName} to ${toName}`;
      minorChanges.push(message);
      // Add a line break after each message
      minorChanges.push('');
    }
  }
}
