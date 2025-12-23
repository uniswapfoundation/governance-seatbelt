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
): string {
  const operations = detectOperations(proposal, checks, simulation);
  
  if (operations.length === 0) {
    return generateFallbackSummary(proposal);
  }

  // Sort by priority and combine descriptions
  const sortedOps = operations.sort((a, b) => a.priority - b.priority);
  
  // If we have multiple operations, combine them
  if (sortedOps.length === 1) {
    return sortedOps[0].description;
  } else if (sortedOps.length === 2) {
    return `${sortedOps[0].description} and ${lowercaseFirst(sortedOps[1].description)}`;
  } else {
    // For 3+ operations, use comma separation
    const lastOp = sortedOps[sortedOps.length - 1];
    const otherOps = sortedOps.slice(0, -1);
    return `${otherOps.map(op => op.description).join(', ')}, and ${lowercaseFirst(lastOp.description)}`;
  }
}

/**
 * Detect operations from proposal data and checks
 */
function detectOperations(
  proposal: ProposalEvent,
  checks: AllCheckResults,
  simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];

  // 1. Check for cross-chain operations (highest priority)
  const crossChainOps = detectCrossChainOperations(checks);
  operations.push(...crossChainOps);

  // 2. Check for proxy upgrades
  const upgradeOps = detectUpgradeOperations(checks, simulation);
  operations.push(...upgradeOps);

  // 3. Check for permission/role changes
  const permissionOps = detectPermissionOperations(checks, simulation);
  operations.push(...permissionOps);

  // 4. Check for transfers (ETH and tokens)
  const transferOps = detectTransferOperations(proposal, checks);
  operations.push(...transferOps);

  // 5. Check for parameter changes
  const paramOps = detectParameterChanges(checks, simulation);
  operations.push(...paramOps);

  return operations;
}

/**
 * Detect cross-chain operations from check results
 */
function detectCrossChainOperations(checks: AllCheckResults): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  
  // Look for cross-chain message checks
  for (const checkId in checks) {
    const { result } = checks[checkId];
    
    // Check for cross-chain indicators in info messages
    for (const info of result.info) {
      if (info.toLowerCase().includes('arbitrum') || 
          info.toLowerCase().includes('optimism') ||
          info.toLowerCase().includes('base') ||
          info.toLowerCase().includes('l2')) {
        
        // Extract chain name
        let chainName = 'Layer 2';
        if (info.toLowerCase().includes('arbitrum')) chainName = 'Arbitrum';
        else if (info.toLowerCase().includes('optimism')) chainName = 'Optimism';
        else if (info.toLowerCase().includes('base')) chainName = 'Base';
        
        operations.push({
          type: 'crossChain',
          description: `Executes cross-chain operations on ${chainName}`,
          priority: 1,
        });
        break; // Only add once per chain
      }
    }
  }
  
  return operations;
}

/**
 * Detect proxy upgrade operations
 */
function detectUpgradeOperations(
  checks: AllCheckResults,
  simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  
  // Look for upgrade-related function calls in decoded calldata
  const calldataCheck = checks['decode-calldata'];
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common upgrade function patterns
      if (info.includes('upgradeTo') || 
          info.includes('upgradeToAndCall') ||
          info.includes('setImplementation') ||
          info.includes('_setImplementation')) {
        
        // Try to extract addresses from the info string
        const addressPattern = /0x[a-fA-F0-9]{40}/g;
        const addresses = info.match(addressPattern) || [];
        
        if (addresses.length >= 2) {
          operations.push({
            type: 'upgrade',
            description: `Upgrades proxy at ${formatAddress(addresses[0])} to implementation ${formatAddress(addresses[1])}`,
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
  simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  
  const calldataCheck = checks['decode-calldata'];
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common permission function patterns
      if (info.includes('grantRole') || 
          info.includes('revokeRole') ||
          info.includes('setRole') ||
          info.includes('addMinter') ||
          info.includes('removeMinter') ||
          info.includes('transferOwnership') ||
          info.includes('setAdmin') ||
          info.includes('setOperator')) {
        
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
          description = `${action} permissions for ${formatAddress(addresses[0])}`;
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
 */
function detectTransferOperations(
  proposal: ProposalEvent,
  checks: AllCheckResults,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  const processedTransfers = new Set<string>();
  
  // Check decoded calldata for transfer operations
  const calldataCheck = checks['decode-calldata'];
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Check for transfer function calls (from decoded ABI)
      if (info.includes('transfer(') && !info.includes('transferFrom') && !info.includes('ETH')) {
        // Extract from pattern like "calls `transfer(0x..., 1000000)` on TokenName"
        const transferMatch = info.match(/transfer\(([^,]+),\s*([^)]+)\)/);
        if (transferMatch) {
          const recipient = transferMatch[1];
          const amount = transferMatch[2];
          
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
  
  // Check for ETH transfers from proposal values
  const hasEthValue = proposal.values?.some(v => BigInt(v.toString()) > 0n);
  if (hasEthValue && operations.filter(op => op.type === 'ethTransfer').length === 0) {
    // Sum up all ETH values
    const totalEth = proposal.values.reduce((sum, v) => sum + BigInt(v.toString()), 0n);
    if (totalEth > 0n) {
      const ethAmount = formatUnits(totalEth, 18);
      operations.push({
        type: 'ethTransfer',
        description: `Sends ${ethAmount} ETH`,
        priority: 4,
      });
    }
  }
  
  return operations;
}

/**
 * Detect parameter changes
 */
function detectParameterChanges(
  checks: AllCheckResults,
  simulation?: TenderlySimulation,
): DetectedOperation[] {
  const operations: DetectedOperation[] = [];
  
  const calldataCheck = checks['decode-calldata'];
  if (calldataCheck?.result.info) {
    for (const info of calldataCheck.result.info) {
      // Common parameter change patterns
      if (info.includes('setParameter') ||
          info.includes('updateParameter') ||
          info.includes('setFee') ||
          info.includes('setRate') ||
          info.includes('setThreshold') ||
          info.includes('setLimit') ||
          info.includes('setDelay') ||
          info.includes('setTimeout')) {
        
        // Extract what's being set
        let paramType = 'parameters';
        if (info.includes('Fee')) paramType = 'fee parameters';
        else if (info.includes('Rate')) paramType = 'rate parameters';
        else if (info.includes('Threshold')) paramType = 'threshold values';
        else if (info.includes('Limit')) paramType = 'limit values';
        else if (info.includes('Delay') || info.includes('Timeout')) paramType = 'timing parameters';
        
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
  const uniqueTargets = new Set(proposal.targets.map(t => {
    try {
      return getAddress(t);
    } catch {
      return t; // Use original if not a valid address
    }
  })).size;
  
  if (targetCount === 1) {
    return `Executes transaction on ${formatAddress(proposal.targets[0])}`;
  } else if (uniqueTargets === 1) {
    return `Executes ${targetCount} transactions on ${formatAddress(proposal.targets[0])}`;
  } else {
    return `Executes ${targetCount} transactions across ${uniqueTargets} contracts`;
  }
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