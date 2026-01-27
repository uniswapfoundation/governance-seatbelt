import { formatUnits, getAddress } from 'viem';
import type { AllCheckResults, ProposalEvent, TenderlySimulation } from '../types';

/**
 * Operation types that can be detected in proposals
 */
export type OperationType =
  | 'transfer'
  | 'ethTransfer'
  | 'permission'
  | 'upgrade'
  | 'crossChain'
  | 'deployment'
  | 'parameterChange'
  | 'unknown';

/**
 * Detected operation with its details
 */
export interface DetectedOperation {
  type: OperationType;
  description: string;
  priority: number; // Lower number = higher priority for display
}

/**
 * Generate a plain-language summary of what a proposal does
 * Uses deterministic templates based on detected operations
 */
export function generateProposalSummary(
  proposal: ProposalEvent,
  checks: AllCheckResults,
  simulation?: TenderlySimulation,
  l2Checks?: Record<number, AllCheckResults>,
): string {
  const operations = detectOperations(proposal, checks, simulation, l2Checks);

  if (operations.length === 0) {
    return generateFallbackSummary(proposal);
  }

  // Sort by priority and combine descriptions
  const sortedOps = operations.sort((a, b) => a.priority - b.priority);

  // If we have multiple operations, combine them
  if (sortedOps.length === 1) {
    return sortedOps[0].description;
  }
  if (sortedOps.length === 2) {
    return `${sortedOps[0].description} and ${lowercaseFirst(sortedOps[1].description)}`;
  }
  // For 3+ operations, use comma separation
  const lastOp = sortedOps[sortedOps.length - 1];
  const otherOps = sortedOps.slice(0, -1);
  return `${otherOps.map((op) => op.description).join(', ')}, and ${lowercaseFirst(lastOp.description)}`;
}

/**
 * Detect operations from proposal data and checks
 */
function detectOperations(
  proposal: ProposalEvent,
  checks: AllCheckResults,
  simulation?: TenderlySimulation,
  l2Checks?: Record<number, AllCheckResults>,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];

  // 1. Check for cross-chain operations (highest priority)
  const crossChainOps = detectCrossChainOperations(checks, l2Checks, proposal);
  const hasCrossChain = crossChainOps.length > 0;
  operations.push(...crossChainOps);

  // 2. Check for proxy upgrades
  const upgradeOps = detectUpgradeOperations(checks, simulation);
  operations.push(...upgradeOps);

  // 3. Check for permission/role changes
  const permissionOps = detectPermissionOperations(checks, simulation);
  operations.push(...permissionOps);

  // 4. Check for transfers (ETH and tokens)
  // Skip ETH value transfers when we have cross-chain ops (ETH is for L2 gas)
  const transferOps = detectTransferOperations(proposal, checks, hasCrossChain);
  operations.push(...transferOps);

  // 5. Check for parameter changes
  const paramOps = detectParameterChanges(checks, simulation);
  operations.push(...paramOps);

  return operations;
}

// Chain ID to name mapping for cross-chain summaries
const CHAIN_NAMES: Record<number, string> = {
  42161: 'Arbitrum',
  10: 'Optimism',
  8453: 'Base',
  1301: 'Unichain',
  57073: 'Ink',
  1868: 'Soneium',
  60808: 'BOB',
};

function formatHumanList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatEthForGasSuffix(ethForGas?: bigint): string {
  return ethForGas && ethForGas > 0n ? ` (with ${formatUnits(ethForGas, 18)} ETH for L2 gas)` : '';
}

/**
 * Detect cross-chain operations from check results
 */
function detectCrossChainOperations(
  checks: AllCheckResults,
  l2Checks?: Record<number, AllCheckResults>,
  proposal?: ProposalEvent,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  const detectedChains = new Set<string>();

  // Calculate total ETH from proposal values (used for L2 gas)
  const totalEthForGas = proposal?.values?.reduce((sum, v) => sum + BigInt(v.toString()), 0n) || 0n;

  // Look for cross-chain message checks in decoded calldata
  const calldataCheck = checks.checkDecodeCalldata;
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Detect Arbitrum bridge calls
      if (
        info.includes('createRetryableTicket') ||
        info.includes('sendL2Message') ||
        info.includes('outboundTransfer')
      ) {
        if (!detectedChains.has('Arbitrum')) {
          detectedChains.add('Arbitrum');
          const description = buildCrossChainDescription(
            'Arbitrum',
            42161,
            l2Checks,
            totalEthForGas,
          );
          operations.push({
            type: 'crossChain',
            description,
            priority: 1,
          });
        }
      }

      // Detect Optimism/OP Stack bridge calls
      if (
        info.includes('sendMessage') &&
        (info.toLowerCase().includes('crossdomainmessenger') ||
          info.toLowerCase().includes('l1crossdomain'))
      ) {
        if (!detectedChains.has('Optimism')) {
          detectedChains.add('Optimism');
          const opStackChainIds = findOpStackChainIds(l2Checks);
          const description =
            opStackChainIds.length > 1
              ? `Sends via OP Stack bridge to ${formatHumanList(
                  opStackChainIds.map((chainId) => CHAIN_NAMES[chainId] || `chainId ${chainId}`),
                )}${formatEthForGasSuffix(totalEthForGas)}`
              : (() => {
                  const opStackChainId = opStackChainIds[0];
                  const chainName = opStackChainId
                    ? CHAIN_NAMES[opStackChainId] || 'L2'
                    : 'Optimism';
                  return buildCrossChainDescription(
                    chainName,
                    opStackChainId,
                    l2Checks,
                    totalEthForGas,
                  );
                })();
          operations.push({
            type: 'crossChain',
            description,
            priority: 1,
          });
        }
      }

      // Detect generic bridge patterns (be more specific to avoid false positives)
      if (
        info.includes('bridgeTo') ||
        info.includes('depositFor') ||
        info.includes('xDomainMessageSender')
      ) {
        if (!detectedChains.has('generic')) {
          detectedChains.add('generic');
          operations.push({
            type: 'crossChain',
            description: 'Executes cross-chain bridge operation',
            priority: 1,
          });
        }
      }
    }
  }

  return operations;
}

/**
 * Find the OP Stack chain ID from L2 checks (for sendMessage calls that could go to multiple chains)
 */
function findOpStackChainIds(l2Checks?: Record<number, AllCheckResults>): number[] {
  if (!l2Checks) return [];

  // OP Stack chains in order of priority
  const opStackChains = [10, 8453, 1301, 57073, 1868, 60808];
  return opStackChains.filter((chainId) => Boolean(l2Checks[chainId]));
}

/**
 * Build a descriptive cross-chain summary using L2 check data
 */
function buildCrossChainDescription(
  chainName: string,
  chainId: number | undefined,
  l2Checks?: Record<number, AllCheckResults>,
  ethForGas?: bigint,
): string {
  // Format ETH amount if provided
  const ethSuffix =
    ethForGas && ethForGas > 0n ? ` (with ${formatUnits(ethForGas, 18)} ETH for L2 gas)` : '';

  // If no L2 checks available, return basic description
  if (!l2Checks || !chainId || !l2Checks[chainId]) {
    return `Sends via ${chainName} bridge${ethSuffix}`;
  }

  // Extract L2 operations from decoded calldata
  const l2Operations = extractL2Operations(l2Checks[chainId]);

  if (l2Operations.length === 0) {
    return `Sends via ${chainName} bridge${ethSuffix}`;
  }

  // Build description based on detected L2 operations
  if (l2Operations.length === 1) {
    return `${l2Operations[0]} on ${chainName}${ethSuffix}`;
  }

  // Group similar operations
  const transferOps = l2Operations.filter((op) => op.toLowerCase().includes('transfer'));
  const otherOps = l2Operations.filter((op) => !op.toLowerCase().includes('transfer'));

  if (transferOps.length > 1 && otherOps.length === 0) {
    // Multiple transfers of the same type
    const tokenMatch = transferOps[0].match(/Transfers?\s+(\w+)/i);
    const token = tokenMatch ? tokenMatch[1] : 'tokens';
    return `Transfers ${token} on ${chainName} to ${transferOps.length} recipients${ethSuffix}`;
  }

  if (l2Operations.length <= 3) {
    return `${l2Operations.slice(0, -1).join(', ')} and ${lowercaseFirst(l2Operations[l2Operations.length - 1])} on ${chainName}${ethSuffix}`;
  }

  return `Executes ${l2Operations.length} operations on ${chainName}${ethSuffix}`;
}

/**
 * Extract operation descriptions from L2 check results
 */
function extractL2Operations(l2Check: AllCheckResults): string[] {
  const operations: string[] = [];
  const processedTokens = new Set<string>();

  const calldataCheck = l2Check.checkDecodeCalldata;
  if (!calldataCheck?.result.info) return operations;

  for (const info of calldataCheck.result.info) {
    // Detect token transfers (formatted style)
    if (info.includes('transfers') && !info.includes('ETH')) {
      const tokenMatch = info.match(/transfers?\s+([\d,\.]+)\s+(\w+)\s+to/i);
      if (tokenMatch) {
        let tokenSymbol = tokenMatch[2];

        // If token symbol is null/undefined, try to extract from contract name
        // Pattern: "on ContractName (symbol) at 0x..."
        if (tokenSymbol === 'null' || tokenSymbol === 'undefined') {
          const contractNameMatch = info.match(/on\s+([^(]+)\s*\((\w+)\)/i);
          if (contractNameMatch) {
            // Use the symbol in parentheses (e.g., "arb" from "Arbitrum (arb)")
            tokenSymbol = contractNameMatch[2].toUpperCase();
          } else {
            // Fallback to generic "tokens"
            tokenSymbol = 'tokens';
          }
        }

        if (!processedTokens.has(tokenSymbol)) {
          processedTokens.add(tokenSymbol);
          operations.push(`Transfers ${tokenSymbol}`);
        }
      }
    }

    // Detect ETH transfers
    if (info.includes('ETH') && info.includes('transfer')) {
      if (!processedTokens.has('ETH')) {
        processedTokens.add('ETH');
        const ethMatch = info.match(/transfers?\s+([\d,\.]+)\s+ETH/i);
        if (ethMatch) {
          operations.push(`Sends ${ethMatch[1]} ETH`);
        } else {
          operations.push('Sends ETH');
        }
      }
    }

    // Detect permission changes
    if (info.includes('grantRole') || info.includes('revokeRole')) {
      if (info.includes('grant')) {
        operations.push('Grants permissions');
      } else {
        operations.push('Revokes permissions');
      }
    }

    // Detect upgrades
    if (info.includes('upgradeTo') || info.includes('upgradeToAndCall')) {
      operations.push('Upgrades proxy');
    }
  }

  return operations;
}

/**
 * Detect proxy upgrade operations
 */
function detectUpgradeOperations(
  checks: AllCheckResults,
  _simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];

  // Look for upgrade-related function calls in decoded calldata
  const calldataCheck = checks.checkDecodeCalldata;
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common upgrade function patterns
      if (
        info.includes('upgradeTo') ||
        info.includes('upgradeToAndCall') ||
        info.includes('setImplementation') ||
        info.includes('_setImplementation')
      ) {
        // Try to extract addresses from the info string
        const addressPattern = /0x[a-fA-F0-9]{40}/g;
        const addresses = info.match(addressPattern) || [];

        if (addresses.length >= 2) {
          operations.push({
            type: 'upgrade',
            description: `Upgrades proxy at ${formatAddress(addresses[0] as string)} to implementation ${formatAddress(addresses[1] as string)}`,
            priority: 2,
          });
        } else {
          operations.push({
            type: 'upgrade',
            description: 'Upgrades proxy contract implementation',
            priority: 2,
          });
        }
      }
    }
  }

  return operations;
}

/**
 * Detect permission and role changes
 */
function detectPermissionOperations(
  checks: AllCheckResults,
  _simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];

  const calldataCheck = checks.checkDecodeCalldata;
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common permission function patterns
      if (
        info.includes('grantRole') ||
        info.includes('revokeRole') ||
        info.includes('setRole') ||
        info.includes('addMinter') ||
        info.includes('removeMinter') ||
        info.includes('transferOwnership') ||
        info.includes('setAdmin') ||
        info.includes('setOperator')
      ) {
        // Determine action type
        let action = 'Updates';
        if (info.includes('grant') || info.includes('add')) action = 'Grants';
        else if (info.includes('revoke') || info.includes('remove')) action = 'Revokes';
        else if (info.includes('transfer')) action = 'Transfers';

        // Try to extract role name and address
        const addressPattern = /0x[a-fA-F0-9]{40}/g;
        const addresses = info.match(addressPattern) || [];

        let description = `${action} permissions`;
        if (addresses.length > 0) {
          description = `${action} permissions for ${formatAddress(addresses[0] as string)}`;
        }

        operations.push({
          type: 'permission',
          description,
          priority: 3,
        });
      }
    }
  }

  return operations;
}

/**
 * Detect transfer operations (ETH and tokens)
 * @param skipEthValue - If true, skip detecting ETH transfers from proposal values (used for cross-chain ops where ETH is for L2 gas)
 */
function detectTransferOperations(
  proposal: ProposalEvent,
  checks: AllCheckResults,
  skipEthValue = false,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  const processedTransfers = new Set<string>();

  // Check decoded calldata for transfer operations
  const calldataCheck = checks.checkDecodeCalldata;
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Check for transfer function calls (from decoded ABI)
      if (info.includes('transfer(') && !info.includes('transferFrom') && !info.includes('ETH')) {
        // Extract from pattern like "calls `transfer(0x..., 1000000)` on TokenName"
        const transferMatch = info.match(/transfer\(([^,]+),\s*([^)]+)\)/);
        if (transferMatch) {
          const recipient = transferMatch[1];
          const _amount = transferMatch[2];

          // Try to extract token name
          const tokenMatch = info.match(/on\s+([^(]+)\s*\(/);
          const token = tokenMatch ? tokenMatch[1].trim() : 'tokens';

          operations.push({
            type: 'transfer',
            description: `Transfers ${token} to ${formatAddress(recipient)}`,
            priority: 4,
          });
        }
      }
      // Token transfers (formatted style)
      else if (info.includes('transfers') && !info.includes('ETH')) {
        // Extract amount and token from patterns like "transfers 1000000 USDC to"
        const tokenMatch = info.match(/transfers?\s+([\d,\.]+)\s+(\w+)\s+to/i);
        if (tokenMatch) {
          const amount = tokenMatch[1];
          const token = tokenMatch[2];
          const transferKey = `${amount}-${token}`;

          if (!processedTransfers.has(transferKey)) {
            processedTransfers.add(transferKey);

            // Extract recipient address
            // Extract recipient address - handle both full and abbreviated addresses
            const addressPattern = /to\s+`?(0x[a-fA-F0-9]+(?:\.{3}[a-fA-F0-9]+)?)`?/i;
            const addressMatch = info.match(addressPattern);
            const recipient = addressMatch ? formatAddress(addressMatch[1]) : 'recipients';

            operations.push({
              type: 'transfer',
              description: `Transfers ${amount} ${token} to ${recipient}`,
              priority: 4,
            });
          }
        }
      }

      // ETH transfers
      if (info.includes('ETH')) {
        const ethMatch = info.match(/transfers?\s+([\d,\.]+)\s+ETH/i);
        if (ethMatch) {
          const amount = ethMatch[1];
          const transferKey = `${amount}-ETH`;

          if (!processedTransfers.has(transferKey)) {
            processedTransfers.add(transferKey);

            // Extract recipient address - handle both full and abbreviated addresses
            const addressPattern = /to\s+`?(0x[a-fA-F0-9]+(?:\.{3}[a-fA-F0-9]+)?)`?/i;
            const addressMatch = info.match(addressPattern);
            const recipient = addressMatch ? formatAddress(addressMatch[1]) : 'recipient';

            operations.push({
              type: 'ethTransfer',
              description: `Sends ${amount} ETH to ${recipient}`,
              priority: 4,
            });
          }
        }
      }
    }
  }

  // Check for ETH transfers from proposal values (skip if ETH is for L2 gas in cross-chain ops)
  if (!skipEthValue) {
    const hasEthValue = proposal.values?.some((v) => BigInt(v.toString()) > 0n);
    if (hasEthValue && operations.filter((op) => op.type === 'ethTransfer').length === 0) {
      // Find targets that receive ETH
      const ethRecipients: { target: string; amount: bigint }[] = [];
      for (let i = 0; i < proposal.values.length; i++) {
        const value = BigInt(proposal.values[i].toString());
        if (value > 0n && proposal.targets[i]) {
          ethRecipients.push({ target: proposal.targets[i], amount: value });
        }
      }

      if (ethRecipients.length === 1) {
        // Single recipient - show the address
        const ethAmount = formatUnits(ethRecipients[0].amount, 18);
        const shortAddr = formatAddress(ethRecipients[0].target);
        operations.push({
          type: 'ethTransfer',
          description: `Sends ${ethAmount} ETH to ${shortAddr}`,
          priority: 4,
        });
      } else if (ethRecipients.length > 1) {
        // Multiple recipients - sum up and mention count
        const totalEth = ethRecipients.reduce((sum, r) => sum + r.amount, 0n);
        const ethAmount = formatUnits(totalEth, 18);
        operations.push({
          type: 'ethTransfer',
          description: `Sends ${ethAmount} ETH to ${ethRecipients.length} recipients`,
          priority: 4,
        });
      }
    }
  }

  return operations;
}

/**
 * Detect parameter changes
 */
function detectParameterChanges(
  checks: AllCheckResults,
  _simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];

  const calldataCheck = checks.checkDecodeCalldata;
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common parameter change patterns
      if (
        info.includes('setParameter') ||
        info.includes('updateParameter') ||
        info.includes('setFee') ||
        info.includes('setRate') ||
        info.includes('setThreshold') ||
        info.includes('setLimit') ||
        info.includes('setDelay') ||
        info.includes('setTimeout')
      ) {
        // Extract what's being set
        let paramType = 'parameters';
        if (info.includes('Fee')) paramType = 'fee parameters';
        else if (info.includes('Rate')) paramType = 'rate parameters';
        else if (info.includes('Threshold')) paramType = 'threshold values';
        else if (info.includes('Limit')) paramType = 'limit values';
        else if (info.includes('Delay') || info.includes('Timeout'))
          paramType = 'timing parameters';

        operations.push({
          type: 'parameterChange',
          description: `Updates ${paramType}`,
          priority: 5,
        });
        break; // Only add once for parameter changes
      }
    }
  }

  return operations;
}

/**
 * Generate a fallback summary when no specific operations are detected
 */
function generateFallbackSummary(proposal: ProposalEvent): string {
  const targetCount = proposal.targets.length;
  // Try to get valid addresses, fallback to original if invalid
  const uniqueTargets = new Set(
    proposal.targets.map((t) => {
      try {
        return getAddress(t);
      } catch {
        return t; // Use original if not a valid address
      }
    }),
  ).size;

  if (targetCount === 1) {
    return `Executes transaction on ${formatAddress(proposal.targets[0])}`;
  }
  if (uniqueTargets === 1) {
    return `Executes ${targetCount} transactions on ${formatAddress(proposal.targets[0])}`;
  }
  return `Executes ${targetCount} transactions across ${uniqueTargets} contracts`;
}

/**
 * Format an address for display (show first 6 and last 4 chars)
 */
function formatAddress(address: string): string {
  // If already abbreviated (contains ...), return as-is
  if (address.includes('...')) {
    return address;
  }

  try {
    const checksummed = getAddress(address);
    return `${checksummed.slice(0, 6)}...${checksummed.slice(-4)}`;
  } catch {
    // If not a valid address, return as-is
    return address;
  }
}

/**
 * Convert first letter to lowercase
 */
function lowercaseFirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
