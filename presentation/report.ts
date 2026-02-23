import { execSync } from 'node:child_process';
import { existsSync, promises as fsp, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mdToPdf } from 'md-to-pdf';
import type { Link, Root } from 'mdast';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkToc from 'remark-toc';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Visitor } from 'unist-util-visit';
import { type Abi, getAddress, toFunctionSelector } from 'viem';
import type {
  AllCheckResults,
  CoverageData,
  GenerateReportsParams,
  GovernorType,
  PermissionsDiffItem,
  ProposalEvent,
  SimulationBlock,
  SimulationBlocks,
  SimulationCalldata,
  SimulationCheck,
  SimulationEvent,
  SimulationResult,
  SimulationStateChange,
  StructuredSimulationReport,
  TenderlySimulation,
  WriteSimulationResultsJsonParams,
} from '../types';
import { BlockExplorerFactory } from '../utils/clients/block-explorers/factory';
import { getChainConfig, publicClient } from '../utils/clients/client';
import { DEFAULT_SIMULATION_ADDRESS, getContractName } from '../utils/clients/tenderly';
import { formatProposalId } from '../utils/contracts/governor';
import { extractAddressesFromReport, resolveLabelsForAddresses } from '../utils/labels';
import { generateProposalSummary } from '../utils/proposal-summary';

// --- Chain name utility ---

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  42161: 'Arbitrum One',
  10: 'Optimism',
  8453: 'Base',
  1301: 'Unichain',
  57073: 'Ink',
  1868: 'Soneium',
  60808: 'BOB',
};

function getChainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}

// --- Cross-chain decoding helpers ---

type AbiParameterLike = {
  type: string;
  components?: readonly AbiParameterLike[];
};

function formatAbiParameterType(param: {
  type: string;
  components?: readonly AbiParameterLike[];
}): string {
  const type = param.type;
  if (!type.startsWith('tuple')) return type;

  const arraySuffix = type.slice('tuple'.length); // "", "[]", "[2]", etc.
  const components = param.components ?? [];
  const inner = components.map((component) => formatAbiParameterType(component)).join(',');
  return `(${inner})${arraySuffix}`;
}

function formatAbiFunctionSignature(fn: {
  name: string;
  inputs?: ReadonlyArray<{ type: string; components?: readonly AbiParameterLike[] }>;
}): string {
  const inputs = fn.inputs ?? [];
  const formattedInputs = inputs.map((input) => formatAbiParameterType(input)).join(',');
  return `${fn.name}(${formattedInputs})`;
}

const KNOWN_FUNCTION_SELECTORS: Record<string, string> = {
  // ERC-20
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  // ERC20Votes / governance tokens
  '0x5c19a95c': 'delegate(address)',
  // WETH9-style
  '0xd0e30db0': 'deposit()',
  '0x2e1a7d4d': 'withdraw(uint256)',
};

const CONTRACT_ABI_CACHE = new Map<string, Abi | null>();
const CONTRACT_ABI_PROMISE_CACHE = new Map<string, Promise<Abi | null>>();

function getContractAbiCacheKey(target: string, chainId: number): string {
  return `${chainId}:${target.toLowerCase()}`;
}

async function fetchContractAbiCached(target: string, chainId: number): Promise<Abi | null> {
  const cacheKey = getContractAbiCacheKey(target, chainId);

  if (CONTRACT_ABI_CACHE.has(cacheKey)) return CONTRACT_ABI_CACHE.get(cacheKey) ?? null;

  const existingPromise = CONTRACT_ABI_PROMISE_CACHE.get(cacheKey);
  if (existingPromise) return await existingPromise;

  const promise = (async () => {
    try {
      return await BlockExplorerFactory.fetchContractAbi(target, chainId);
    } catch {
      return null;
    }
  })();

  CONTRACT_ABI_PROMISE_CACHE.set(cacheKey, promise);

  const abi = await promise;
  CONTRACT_ABI_PROMISE_CACHE.delete(cacheKey);
  CONTRACT_ABI_CACHE.set(cacheKey, abi);
  return abi;
}

async function decodeContractCall(
  target: string,
  calldata: string,
  chainId: number,
): Promise<{ selector: string; signature?: string } | null> {
  if (!calldata || calldata.length < 10) return null;

  const selector = calldata.slice(0, 10).toLowerCase();
  const knownSignature = KNOWN_FUNCTION_SELECTORS[selector];
  if (knownSignature) return { selector, signature: knownSignature };

  const abi = await fetchContractAbiCached(target, chainId);
  if (!abi) return { selector };

  let signature: string | undefined;
  for (const item of abi) {
    if (item.type !== 'function') continue;
    try {
      if (toFunctionSelector(item) === selector) {
        signature = formatAbiFunctionSignature(item);
        break;
      }
    } catch {
      // Ignore malformed ABI entries.
    }
  }

  return { selector, signature };
}

function getSimulationContractLabel(
  simulation: TenderlySimulation | undefined,
  address: string | undefined,
): string | undefined {
  if (!simulation || !address) return undefined;

  try {
    const match = simulation.contracts.find((c) => getAddress(c.address) === getAddress(address));

    if (!match) return undefined;

    if (match.token_data?.name && match.token_data?.symbol) {
      return `${match.token_data.name} (${match.token_data.symbol})`;
    }

    if (match.contract_name) return match.contract_name;
  } catch {
    // Ignore bad addresses.
  }

  return undefined;
}

async function buildCrossChainPreview(
  destinationSimulations: NonNullable<SimulationResult['destinationSimulations']>,
  destinationChecks?: Record<number, AllCheckResults>,
): Promise<StructuredSimulationReport['crossChain']> {
  const messages = await Promise.all(
    destinationSimulations.map(async (dest) => {
      const chainId = dest.chainId;

      let blockExplorerBaseUrl = 'https://etherscan.io';
      try {
        blockExplorerBaseUrl = getChainConfig(chainId).blockExplorer.baseUrl;
      } catch {
        // Ignore unknown chain configs.
      }

      const l2TargetAddress = dest.l2Params?.l2TargetAddress;
      const l2InputData = dest.l2Params?.l2InputData;

      const call =
        l2TargetAddress && l2InputData
          ? await decodeContractCall(l2TargetAddress, l2InputData, chainId)
          : undefined;

      return {
        chainId,
        chainName: getChainName(chainId),
        blockExplorerBaseUrl,
        bridgeType: dest.bridgeType,
        status: dest.status,
        error: dest.error,
        l2FromAddress: dest.l2Params?.l2FromAddress,
        l2TargetAddress,
        l2Value: dest.l2Params?.l2Value,
        l2InputData,
        targetLabel: getSimulationContractLabel(dest.sim, l2TargetAddress),
        call: call
          ? { selector: call.selector as `0x${string}`, signature: call.signature }
          : undefined,
      };
    }),
  );

  const chains =
    destinationChecks && Object.keys(destinationChecks).length > 0
      ? Object.entries(destinationChecks)
          .map(([chainIdStr, checks]) => {
            const chainId = Number(chainIdStr);

            let blockExplorerBaseUrl = 'https://etherscan.io';
            try {
              blockExplorerBaseUrl = getChainConfig(chainId).blockExplorer.baseUrl;
            } catch {
              // Ignore unknown chain configs.
            }

            return {
              chainId,
              chainName: getChainName(chainId),
              blockExplorerBaseUrl,
              status: getStatusForChecks(checks),
              checks: formatChecksForStructuredReport(checks, chainId),
            };
          })
          .sort((a, b) => a.chainId - b.chainId)
      : undefined;

  return { messages, destinationChains: chains };
}

// --- Repository and Tenderly utilities ---

/**
 * Get repository information from CI environment or git
 */
function getRepoInfo(): { repoCommit?: string; repoUrl?: string } {
  try {
    // Prefer CI environment variables
    if (process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY) {
      return {
        repoCommit: process.env.GITHUB_SHA,
        repoUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}`,
      };
    }

    // Fallback to git commands for local development
    const commit = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    const remoteUrl = execSync('git config --get remote.origin.url', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    // Convert git SSH URL to HTTPS if needed
    const httpsUrl = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '');

    return {
      repoCommit: commit,
      repoUrl: httpsUrl,
    };
  } catch {
    // Git not available or not in a git repository
    return {};
  }
}

/**
 * Get Tenderly simulation URL if available
 */
function getTenderlyUrl(simulationId?: string): string | undefined {
  if (!simulationId || !process.env.TENDERLY_USER || !process.env.TENDERLY_PROJECT_SLUG) {
    return undefined;
  }

  return `https://dashboard.tenderly.co/${process.env.TENDERLY_USER}/${process.env.TENDERLY_PROJECT_SLUG}/simulator/${simulationId}`;
}

// --- Markdown helpers ---

export function bullet(text: string, level = 0) {
  return `${' '.repeat(level * 4)}- ${text}`;
}

export function bold(text: string) {
  return `**${text}**`;
}

export function codeBlock(text: string) {
  // Line break, three backticks, line break, the text, line break, three backticks, line break
  return `\n\`\`\`\n${text}\n\`\`\`\n`;
}

/**
 * Block quotes a string in markdown
 * @param str string to block quote
 */
export function blockQuote(str: string) {
  return str
    .split('\n')
    .map((s) => `> ${s}`)
    .join('\n');
}

/**
 * Turns a plaintext address into a link to etherscan page of that address
 * @param address to be linked
 * @param baseUrl the base URL for the etherscan link
 */
export function toAddressLink(address: string, baseUrl = 'https://etherscan.io'): string {
  return `[${address}](${baseUrl}/address/${address})`;
}

// -- Report formatters ---

function toMessageList(header: string, text: string[]): string {
  return text.length > 0
    ? `${bold(header)}:\n\n${text
        .filter((msg) => msg && typeof msg === 'string' && msg.trim())
        .map((msg) => {
          // If the message starts with spaces, it's already indented (sub-item), preserve the indentation
          if (msg.match(/^\s{4,}/)) {
            // For indented messages, add bullet but preserve the indentation level
            const trimmedMsg = msg.trim();
            const indentMatch = msg.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';
            return `${indent.slice(0, -4)}    - ${trimmedMsg}`;
          }
          // For non-indented messages, add main bullet
          return bullet(msg.trim());
        })
        .join('\n')}`
    : '';
}

/**
 * Summarize the results of a specific check
 * @param errors the errors returned by the check
 * @param warnings the warnings returned by the check
 * @param name the descriptive name of the check
 */
function toCheckSummary(checkId: string, check: AllCheckResults[string], chainKey: string): string {
  const {
    result: { errors, warnings, info, skipped },
    name,
  } = check;
  let status: string;

  if (skipped) {
    status = '⏭️ **Skipped**';
  } else if (errors.length === 0) {
    status = warnings.length === 0 ? '✅ Passed' : '❗❗ **Passed with warnings**';
  } else {
    status = '❌ **Failed**';
  }

  const anchorId = `check-${chainKey}-${checkId}`;
  let report = `<a id="${anchorId}"></a>\n\n### ${name} ${status}\n\n`;

  if (skipped) {
    report += `${bold('Skip Reason')}: ${skipped.reason}\n\n`;
  }

  report += toMessageList('Errors', errors);
  report += '\n\n';
  report += toMessageList('Warnings', warnings);
  report += '\n\n';
  report += toMessageList('Info', info);
  report += '\n';

  return report;
}

function escapeMarkdownInline(value: string): string {
  return value.replaceAll('\n', ' ');
}

function toCoverageMarkdown(coverage: CoverageData): string {
  const explainer =
    'Coverage tracks whether each check executed (ran/skipped/failed). It does not indicate pass/fail; see the check results below.';

  const metaLines = [
    `- Commit: \`${coverage.metadata.gitCommitHash}\``,
    `- Branch: \`${coverage.metadata.gitBranch}\``,
    `- Timestamp: ${coverage.metadata.timestamp}`,
    ...(coverage.metadata.runnerOs ? [`- Runner OS: \`${coverage.metadata.runnerOs}\``] : []),
    ...(coverage.metadata.nodeVersion ? [`- Node: \`${coverage.metadata.nodeVersion}\``] : []),
    ...(coverage.metadata.bunVersion ? [`- Bun: \`${coverage.metadata.bunVersion}\``] : []),
    ...(coverage.metadata.pythonVersion
      ? [`- Python: \`${coverage.metadata.pythonVersion}\``]
      : []),
    ...(coverage.metadata.solcVersion ? [`- solc: \`${coverage.metadata.solcVersion}\``] : []),
    ...(coverage.metadata.slitherVersion
      ? [`- slither: \`${coverage.metadata.slitherVersion}\``]
      : []),
  ].join('\n');

  const summary = coverage.summary;
  const summaryLines = [
    `- Total: ${summary.total}`,
    `- Ran: ${summary.ran}`,
    `- Skipped: ${summary.skipped}${
      summary.inferredSkips > 0 ? ` (${summary.inferredSkips} inferred)` : ''
    }`,
    `- Failed: ${summary.failed}`,
  ].join('\n');

  if (coverage.checks.length === 0) {
    return `## Coverage\n\n${explainer}\n\n${metaLines}\n\n${summaryLines}\n\nNo coverage entries found.\n`;
  }

  const checksByChainId = coverage.checks.reduce<Record<string, typeof coverage.checks>>(
    (acc, entry) => {
      const chainKey = String(entry.chainId ?? 'unknown');
      if (!acc[chainKey]) acc[chainKey] = [];
      acc[chainKey].push(entry);
      return acc;
    },
    {},
  );

  const chainSections = Object.entries(checksByChainId)
    .sort(([a], [b]) => {
      if (a === 'unknown') return 1;
      if (b === 'unknown') return -1;
      return Number(a) - Number(b);
    })
    .map(([chainId, chainChecks]) => {
      const chainHeading =
        chainId === 'unknown' ? '### Unknown chain' : `### ${getChainName(Number(chainId))}`;

      const items = [...chainChecks]
        .sort((a, b) => a.checkName.localeCompare(b.checkName))
        .map((entry) => {
          const status =
            entry.status === 'ran'
              ? '✅ ran'
              : entry.status === 'skipped'
                ? '⏭️ skipped'
                : '❌ failed';
          const methodSuffix = entry.wasInferred ? ' (inferred)' : '';
          const timeSuffix = entry.executionTimeMs != null ? ` • ${entry.executionTimeMs}ms` : '';
          const notesSuffix = entry.skipReason
            ? ` • ${escapeMarkdownInline(entry.skipReason)}`
            : '';

          const anchorId = `check-${chainId}-${entry.checkId}`;
          const nameWithLink =
            chainId === 'unknown' ? entry.checkName : `[${entry.checkName}](#${anchorId})`;

          return `- ${nameWithLink} (\`${entry.checkId}\`) — ${status}${methodSuffix}${timeSuffix}${notesSuffix}`;
        })
        .join('\n');

      return [chainHeading, '', items].join('\n');
    })
    .join('\n\n');

  return `## Coverage\n\n${explainer}\n\n${metaLines}\n\n${summaryLines}\n\n${chainSections}\n`;
}

/**
 * Extracts the title from the proposal description.
 * Handles both markdown format (starting with # Title) and plain text descriptions.
 * @param description the proposal description
 */
function getProposalTitle(description: string) {
  // First, try to extract a markdown H1 title (# Title)
  const markdownMatch = description.match(/^\s*#\s*(.*?)(?:\s*\n|$)/);
  if (markdownMatch?.[1]?.trim()) {
    return markdownMatch[1].trim();
  }

  // If no markdown title found, try to extract the first line as title
  const firstLine = description.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 0) {
    // Remove any leading # symbols if present but not properly formatted
    const cleanTitle = firstLine.replace(/^#+\s*/, '').trim();
    return cleanTitle || 'Title not found';
  }

  return 'Title not found';
}

/**
 * Format a block timestamp which is always in epoch seconds to a human readable string
 * @param blockTimestamp the block timestamp to format
 */
function formatTime(blockTimestamp: bigint): string {
  return `${new Date(Number(blockTimestamp) * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York',
  })} ET`;
}

/**
 * Estimate the timestamp of a future block number
 * @param current the current block
 * @param block the future block number
 */
function estimateTime(current: SimulationBlock, block: bigint): bigint {
  if (!current.number) throw new Error('Current block number is null');
  if (block < current.number) throw new Error('end block is less than current');
  return (block - current.number) * BigInt(13) + current.timestamp;
}

/**
 * Extract state changes from check results
 */
function extractStateChanges(checks: AllCheckResults): SimulationStateChange[] {
  const stateChanges: SimulationStateChange[] = [];

  for (const checkId in checks) {
    const { result } = checks[checkId];

    // Track the current contract name and address
    let currentContract = '';
    let currentContractAddress = '';

    for (const infoMsg of result.info) {
      // Skip non-string entries
      if (typeof infoMsg !== 'string') continue;

      // Check if this is a contract name line: "ContractName at `0xAddress`"
      const contractNameMatch = infoMsg.match(/^(.+) at `(0x[a-fA-F0-9]{40})`$/);
      if (contractNameMatch) {
        currentContract = contractNameMatch[1].trim();
        currentContractAddress = contractNameMatch[2];
        continue;
      }

      // Try to extract slot changes: "    Slot `0xhash` changed from `"value"` to `"newvalue"`"
      const slotChangeMatch = infoMsg.match(
        /^\s+Slot `(0x[a-fA-F0-9]+)` changed from `"(.*?)"` to `"(.*?)"`$/,
      );
      if (slotChangeMatch) {
        stateChanges.push({
          contract: currentContract,
          contractAddress: currentContractAddress,
          key: slotChangeMatch[1],
          oldValue: slotChangeMatch[2],
          newValue: slotChangeMatch[3],
        });
        continue;
      }

      // Try to extract mapping state changes: "`variable` key `key` changed from `value` to `newvalue`"
      const mappingStateChangeMatch = infoMsg.match(
        /`(.+?)`\s+key\s+`(.+?)`\s+changed\s+from\s+`(.+?)`\s+to\s+`(.+?)`/,
      );
      if (mappingStateChangeMatch) {
        stateChanges.push({
          contract: currentContract || mappingStateChangeMatch[1],
          contractAddress: currentContractAddress,
          key: mappingStateChangeMatch[2],
          oldValue: mappingStateChangeMatch[3],
          newValue: mappingStateChangeMatch[4],
        });
        continue;
      }

      // Try to extract simple type state changes: "`variable` changed from `value` to `newvalue`"
      const simpleStateChangeMatch = infoMsg.match(
        /`(.+?)`\s+changed\s+from\s+`(.+?)`\s+to\s+`(.+?)`/,
      );
      if (simpleStateChangeMatch) {
        stateChanges.push({
          contract: currentContract,
          contractAddress: currentContractAddress,
          key: simpleStateChangeMatch[1],
          oldValue: simpleStateChangeMatch[2],
          newValue: simpleStateChangeMatch[3],
        });
      }
    }
  }

  return stateChanges;
}

/**
 * Extract events from check results
 */
function extractEvents(checks: AllCheckResults): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const checkId in checks) {
    const { result } = checks[checkId];
    for (const infoMsg of result.info) {
      // Skip non-string entries
      if (typeof infoMsg !== 'string') continue;

      // Try to extract events from info messages
      const eventMatch = infoMsg.match(/`(.+?)`\s+at\s+`(.+?)`\s*\n\s+\*\s+`(.+?)`/);
      if (eventMatch) {
        events.push({
          name: eventMatch[1],
          contract: eventMatch[2],
          params: [{ name: 'params', value: eventMatch[3], type: 'unknown' }],
        });
      }
    }
  }

  return events;
}

/**
 * Extract permissions diff data from check results
 */
function extractPermissionsDiff(checks: AllCheckResults): PermissionsDiffItem[] {
  const items: PermissionsDiffItem[] = [];

  for (const checkId in checks) {
    const { result } = checks[checkId];
    if (result.permissionsDiff?.length) items.push(...result.permissionsDiff);
  }

  // Deduplicate (stable ordering) in case multiple sources emit the same item
  const seen = new Set<string>();
  const deduped: PermissionsDiffItem[] = [];
  for (const item of items) {
    const key = JSON.stringify(item, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

/**
 * Extract calldata from check results
 */
function extractCalldata(
  checks: AllCheckResults,
  proposal: ProposalEvent,
): SimulationCalldata | undefined {
  for (const checkId in checks) {
    if (checkId === 'decode-calldata') {
      const { result } = checks[checkId];
      for (const infoMsg of result.info) {
        // Try to extract calldata from info messages
        if (infoMsg.includes('transfers') || infoMsg.includes('calls')) {
          return {
            decoded: infoMsg,
            raw: proposal.calldatas.join(', '),
          };
        }
      }
    }
  }
  return undefined;
}

function getStatusForChecks(value: AllCheckResults): 'success' | 'warning' | 'error' {
  let hasErrors = false;
  let hasWarnings = false;

  for (const checkId in value) {
    const { result } = value[checkId];
    if (result.errors.length > 0) hasErrors = true;
    if (result.warnings.length > 0) hasWarnings = true;
  }

  if (hasErrors) return 'error';
  if (hasWarnings) return 'warning';
  return 'success';
}

function formatChecksForStructuredReport(
  value: AllCheckResults,
  chainId?: number,
): SimulationCheck[] {
  return Object.entries(value).map(([checkId, check]) => {
    const { name, result } = check;
    const { errors, warnings, info, skipped } = result;

    let checkStatus: 'passed' | 'warning' | 'failed' | 'skipped' = 'passed';
    let skipReason: string | undefined;

    if (skipped) {
      checkStatus = 'skipped';
      skipReason = skipped.reason;
    } else if (errors.length > 0) {
      checkStatus = 'failed';
    } else if (warnings.length > 0) {
      checkStatus = 'warning';
    }

    const details = [
      ...(skipped ? [`**Skipped**: ${skipped.reason}`] : []),
      ...errors.map((msg) => `**Error**: ${msg}`),
      ...warnings.map((msg) => `**Warning**: ${msg}`),
      ...info.map((msg) => `**Info**: ${msg}`),
    ].join('\n\n');

    return {
      checkId,
      chainId,
      title: name,
      status: checkStatus,
      skipReason,
      warningCount: warnings.length,
      errorCount: errors.length,
      details,
      info,
      warnings,
      errors,
      data: result.data,
    };
  });
}

/**
 * Infer simulationType from proposal block state when not explicitly provided.
 * - Has proposalExecutedBlock → "executed"
 * - Has proposalCreatedBlock but no executed block → "proposed"
 * - Neither → "new"
 */
function inferSimulationTypeFromProposalState(
  proposalCreatedBlock?: SimulationBlock,
  proposalExecutedBlock?: SimulationBlock,
): 'executed' | 'proposed' | 'new' {
  // Check for executed state first (has executed block number)
  if (proposalExecutedBlock?.number != null) {
    return 'executed';
  }
  // Check for proposed state (has created block number but no executed)
  if (proposalCreatedBlock?.number != null) {
    return 'proposed';
  }
  // Default to new proposal
  return 'new';
}

/**
 * Generate a structured report from the check results
 */
function generateStructuredReport(
  governorType: GovernorType,
  blocks: SimulationBlocks,
  proposal: ProposalEvent,
  checks: AllCheckResults,
  governorAddress: string,
  executor?: string,
  proposalCreatedBlock?: SimulationBlock,
  proposalExecutedBlock?: SimulationBlock,
  chainId?: number,
  simulationType?: 'executed' | 'proposed' | 'new',
  simulationId?: string,
  simulation?: TenderlySimulation,
  destinationChecks?: Record<number, AllCheckResults>,
  proposalState?: string,
): StructuredSimulationReport {
  // Validate required fields
  if (!proposal.proposer) {
    throw new Error(`Missing proposer for proposal ${proposal.id}`);
  }
  if (!governorAddress) {
    throw new Error('Governor address is required for metadata');
  }

  // Infer simulationType from proposal state if not explicitly provided (Issue #163)
  const resolvedSimulationType =
    simulationType ??
    inferSimulationTypeFromProposalState(proposalCreatedBlock, proposalExecutedBlock);

  // Extract title and proposal text
  const title = getProposalTitle(proposal.description.trim());
  const proposalText = proposal.description.trim();

  // Determine overall status
  let status: 'success' | 'warning' | 'error' | 'inconclusive' = 'success';

  // Set status based on conditions (skips are informational and do not make the report inconclusive)
  status = getStatusForChecks(checks);

  // Format checks
  const formattedChecks: SimulationCheck[] = formatChecksForStructuredReport(checks, chainId ?? 1);

  // Get chain configuration for explorer URL
  const targetChainId = chainId ?? 1; // Default to mainnet
  let blockExplorerBaseUrl = 'https://etherscan.io';
  try {
    const chainConfig = getChainConfig(targetChainId);
    blockExplorerBaseUrl = chainConfig.blockExplorer.baseUrl;
  } catch {
    // Fallback to etherscan if chain config not found
  }

  // Always include the standard placeholder address so Tally/seatbelt can badge any occurrence
  const placeholderAddresses: string[] = [DEFAULT_SIMULATION_ADDRESS];

  const proposerIsPlaceholder =
    getAddress(proposal.proposer) === getAddress(DEFAULT_SIMULATION_ADDRESS);
  const executorIsPlaceholder = executor
    ? getAddress(executor) === getAddress(DEFAULT_SIMULATION_ADDRESS)
    : undefined;

  // Get repository and Tenderly information
  const { repoCommit, repoUrl } = getRepoInfo();
  const tenderlyUrl = getTenderlyUrl(simulationId);

  // Create the structured report
  // Generate plain-language summary using the new summary generator
  // Pass L2 checks to enable detailed cross-chain summaries
  const plainLanguageSummary = generateProposalSummary(
    proposal,
    checks,
    simulation,
    destinationChecks,
  );

  // Combine with simulation status for complete summary
  const statusText =
    status === 'success'
      ? 'completed successfully'
      : status === 'warning'
        ? 'completed with warnings'
        : 'completed with errors';

  const mainStateChanges = extractStateChanges(checks);
  const mainEvents = extractEvents(checks);

  const chainReports: StructuredSimulationReport['chainReports'] = [
    {
      chainId: targetChainId,
      chainName: getChainName(targetChainId),
      blockExplorerBaseUrl,
      status: getStatusForChecks(checks),
      checks: formattedChecks,
      stateChanges: mainStateChanges,
      events: mainEvents,
    },
    ...Object.entries(destinationChecks ?? {}).map(([chainIdStr, destChecks]) => {
      const destChainId = Number(chainIdStr);

      let destBlockExplorerBaseUrl = 'https://etherscan.io';
      try {
        destBlockExplorerBaseUrl = getChainConfig(destChainId).blockExplorer.baseUrl;
      } catch {
        // Ignore unknown chain configs.
      }

      return {
        chainId: destChainId,
        chainName: getChainName(destChainId),
        blockExplorerBaseUrl: destBlockExplorerBaseUrl,
        status: getStatusForChecks(destChecks),
        checks: formatChecksForStructuredReport(destChecks, destChainId),
        stateChanges: extractStateChanges(destChecks),
        events: extractEvents(destChecks),
      };
    }),
  ];

  return {
    title,
    proposalText,
    status,
    summary: `${plainLanguageSummary}. Simulation ${statusText}.`,
    checks: formattedChecks,
    stateChanges: mainStateChanges,
    events: mainEvents,
    chainReports,
    permissionsDiff: extractPermissionsDiff(checks),
    calldata: extractCalldata(checks, proposal),
    metadata: {
      proposalId: formatProposalId(governorType, proposal.id!),
      proposer: proposal.proposer,
      proposerIsPlaceholder,
      governorAddress,
      executor,
      executorIsPlaceholder,
      simulationBlockNumber: blocks.current.number?.toString() ?? 'unknown',
      simulationTimestamp: blocks.current.timestamp.toString(),
      proposalCreatedAtBlockNumber: proposalCreatedBlock?.number?.toString() ?? 'unknown',
      proposalCreatedAtTimestamp: proposalCreatedBlock?.timestamp?.toString() ?? 'unknown',
      proposalExecutedAtBlockNumber: proposalExecutedBlock?.number?.toString(),
      proposalExecutedAtTimestamp: proposalExecutedBlock?.timestamp?.toString(),
      // Extended metadata for Tally integration
      schemaVersion: 1,
      chainId: targetChainId,
      chainName: getChainName(targetChainId),
      blockExplorerBaseUrl,
      simulationType: resolvedSimulationType,
      placeholderAddresses,
      // Repository and simulation links for Issue #92
      repoCommit,
      repoUrl,
      tenderlyUrl,
      // On-chain proposal state (Issue #165)
      proposalState,
    },
  };
}

/**
 * @notice Write simulation results JSON file for frontend or GitHub app consumption
 */
export function writeSimulationResultsJson(params: WriteSimulationResultsJsonParams) {
  const {
    governorType,
    blocks,
    proposal,
    checks,
    markdownReport,
    governorAddress,
    outputPath,
    destinationSimulations,
    destinationChecks,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
    chainId,
    simulationType,
    simulation,
    coverage,
    proposalState,
  } = params;

  try {
    // Extract the proposal data in the format expected by the frontend
    const id = formatProposalId(governorType, proposal.id!);
    const proposalData = {
      id,
      targets: proposal.targets.map((target) => target as `0x${string}`),
      values: (proposal.values || []).map((value) => BigInt(value.toString())),
      signatures: proposal.signatures,
      calldatas: proposal.calldatas.map((data) => data as `0x${string}`),
      description: proposal.description,
    };

    // Use pre-generated structured report if provided (e.g., already enriched with labels),
    // otherwise generate one.
    const simulationId = simulation?.simulation?.id;
    const structuredReport =
      params.structuredReport ??
      generateStructuredReport(
        governorType,
        blocks,
        proposal,
        checks,
        governorAddress,
        executor,
        proposalCreatedBlock,
        proposalExecutedBlock,
        chainId,
        simulationType,
        simulationId,
        simulation,
        destinationChecks,
        proposalState,
      );

    if (coverage) {
      structuredReport.coverage = coverage;
    }

    // Create a simplified report structure for the frontend
    const reportForFrontend = {
      status: structuredReport.status,
      summary: structuredReport.summary,
      markdownReport,
      structuredReport,
    };

    // Create the directory if it doesn't exist
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Write the simulation results JSON
    writeFileSync(
      outputPath,
      JSON.stringify({ proposalData, report: reportForFrontend }, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
    console.log(`Simulation results JSON written to: ${outputPath}`);

    // TODO: Potentially add destinationSimulations data if needed
    if (destinationSimulations && destinationSimulations.length > 0) {
      console.log('[Frontend Data] Destination Sims: ', destinationSimulations.length);
    }
  } catch (error) {
    console.error('Error writing simulation results JSON:', error);
  }
}

/**
 * Generates the proposal report and saves Markdown, PDF, and HTML versions of it.
 * Also writes the report data to the frontend/public directory for easy access.
 * @param blocks the relevant blocks for the proposal.
 * @param proposal The proposal details.
 * @param checks The checks results.
 * @param outputDir The directory where the file should be saved. It will be created if it doesn't exist.
 * @param filename The name of the file. All report formats will have the same filename with different extensions.
 * @param destinationSimulations Optional destination simulations
 */
export async function generateAndSaveReports(params: GenerateReportsParams) {
  const {
    governorType,
    blocks,
    proposal,
    checks,
    outputDir,
    governorAddress,
    destinationSimulations,
    destinationChecks,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
    chainId,
    simulationType,
    simulation,
    coverage,
    daoName,
    contracts,
    proposalState,
  } = params;
  console.log(`[Report] Generating report for proposal ${proposal.id} (${proposal.proposalId})`);
  console.log(`[Report] Output directory: ${outputDir}`);

  // Prepare the output folder and filename.
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const id = formatProposalId(governorType, proposal.id!);
  const path = `${outputDir}/${id}`;

  // Generate the base markdown proposal report. This is the markdown report which is translated into other file types.
  const baseReport = await toMarkdownProposalReport(
    governorType,
    blocks,
    proposal,
    checks,
    destinationSimulations,
    destinationChecks,
    coverage,
  );

  // The table of contents' links in the baseReport work when converted to HTML, but do not work as Markdown
  // or PDF links, since the emojis in the header titles cause issues. We apply the remarkFixEmojiLinks plugin
  // to fix this, and use this updated version when generating the Markdown and PDF reports.
  const markdownReport = String(await remark().use(remarkFixEmojiLinks).process(baseReport));

  // Generate the HTML report string using the `baseReport`.
  const htmlReport = String(
    await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeSanitize)
      .use(rehypeStringify)
      .use(rehypeSlug)
      .process(baseReport),
  );

  // Generate the structured report for JSON output with L2 checks for cross-chain summaries
  const structuredReport = generateStructuredReport(
    governorType,
    blocks,
    proposal,
    checks,
    governorAddress,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
    chainId,
    simulationType,
    simulation?.simulation?.id,
    simulation,
    destinationChecks,
    proposalState,
  );

  // Add coverage data to the structured report if available
  if (coverage) {
    structuredReport.coverage = coverage;
  }

  // Resolve address labels if daoName is provided (Issue #94)
  if (daoName) {
    try {
      // Extract all addresses from the report
      const addresses = extractAddressesFromReport(
        Object.values(checks).map((c) => c.result),
        structuredReport.stateChanges,
        structuredReport.events,
        structuredReport.metadata,
      );

      // Resolve labels for all unique addresses
      const addressLabels = await resolveLabelsForAddresses(
        addresses,
        daoName,
        publicClient,
        contracts || [],
      );

      // Add labels to the report metadata
      if (Object.keys(addressLabels).length > 0) {
        structuredReport.metadata.addressLabels = addressLabels;
        console.log(`[Report] Resolved ${Object.keys(addressLabels).length} address labels`);
      }
    } catch (error) {
      console.warn('[Report] Failed to resolve address labels:', error);
      // Continue without labels - they're optional
    }
  }

  // Add cross-chain preview data (Issue #101)
  if (destinationSimulations && destinationSimulations.length > 0) {
    try {
      structuredReport.crossChain = await buildCrossChainPreview(
        destinationSimulations,
        destinationChecks,
      );
    } catch (error) {
      console.warn('[Report] Failed to build cross-chain preview:', error);
      // Continue without cross-chain preview - it's optional.
    }
  }

  // Save off all reports. The Markdown and PDF reports use the `markdownReport`.
  await Promise.all([
    fsp.writeFile(`${path}.html`, htmlReport),
    fsp.writeFile(`${path}.md`, markdownReport),
    fsp.writeFile(`${path}.json`, JSON.stringify(structuredReport, null, 2)),
    mdToPdf(
      { content: markdownReport },
      {
        dest: `${path}.pdf`,
        launch_options: {
          args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
          timeout: 60000, // Increase timeout to 60 seconds
          ...(process.env.CHROME_EXECUTABLE_PATH && {
            executablePath: process.env.CHROME_EXECUTABLE_PATH,
          }),
        },
        pdf_options: {
          timeout: 60000, // Increase timeout to 60 seconds
        },
      },
    ),
  ]);

  // Write standalone coverage JSON file if coverage data is available
  if (coverage) {
    writeCoverageJson(coverage, outputDir, id);
  }

  // Write simulation results JSON for both SIM_NAME and bulk modes
  const simulationResultsPath = process.env.SIM_NAME
    ? join(dirname(__dirname), 'frontend', 'public', 'simulation-results.json') // SIM_NAME mode: frontend directory
    : `${path}-simulation-results.json`; // Bulk mode: alongside other reports

  writeSimulationResultsJson({
    governorType,
    blocks,
    proposal,
    checks,
    markdownReport,
    governorAddress,
    outputPath: simulationResultsPath,
    destinationSimulations,
    destinationChecks,
    executor,
    proposalCreatedBlock,
    proposalExecutedBlock,
    chainId,
    simulationType,
    simulation,
    coverage,
    structuredReport, // Pass the report with labels already resolved
  });
}

/**
 * Write standalone coverage JSON file
 */
function writeCoverageJson(coverage: CoverageData, outputDir: string, proposalId: string): void {
  const coveragePath = `${outputDir}/${proposalId}-coverage.json`;
  writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));
  console.log(`[Report] Coverage JSON written to: ${coveragePath}`);
}

/**
 * Produce a markdown report summarizing the result of all the checks for a given proposal.
 * @param blocks the relevant blocks for the proposal.
 * @param proposal The proposal details.
 * @param checks The checks results.
 * @param destinationSimulations Optional destination simulations
 */
async function toMarkdownProposalReport(
  governorType: GovernorType,
  blocks: SimulationBlocks,
  proposal: ProposalEvent,
  checks: AllCheckResults,
  destinationSimulations?: SimulationResult['destinationSimulations'],
  destinationChecks?: Record<number, AllCheckResults>,
  coverage?: CoverageData,
): Promise<string> {
  const { id, proposer, targets, endBlock, startBlock, description } = proposal;

  if (!blocks.current.number) throw new Error('Current block number is null');

  const sourceChainKey = String(coverage?.checks.find((c) => c.chainId != null)?.chainId ?? 1);

  // Generate the report. We insert an empty table of contents header which is populated later using remark-toc.
  const isPlaceholderProposer = getAddress(proposer) === getAddress(DEFAULT_SIMULATION_ADDRESS);

  const execSummary = await formatExecutiveSummary(
    proposal,
    checks,
    destinationSimulations,
    destinationChecks,
  );

  const report = `
# ${getProposalTitle(description.trim())}

_Updated as of block [${blocks.current.number}](https://etherscan.io/block/${blocks.current.number}) at ${formatTime(
    blocks.current.timestamp,
  )}_

- ID: ${formatProposalId(governorType, id!)}
- Proposer: ${toAddressLink(proposer)}${isPlaceholderProposer ? ' (placeholder simulation address)' : ''}
- Start Block: ${startBlock} (${
    blocks.start
      ? formatTime(blocks.start.timestamp)
      : formatTime(estimateTime(blocks.current, startBlock))
  })
- End Block: ${endBlock} (${
    blocks.end
      ? formatTime(blocks.end.timestamp)
      : formatTime(estimateTime(blocks.current, endBlock))
  })
- Targets: ${targets.map((target) => toAddressLink(target)).join('; ')}

## Executive Summary

${execSummary}

## Table of contents

This is filled in by remark-toc and this sentence will be removed.

${coverage ? `\n${toCoverageMarkdown(coverage)}\n` : ''}

## Proposal Text

${blockQuote(description.trim())}

## Main Chain Checks\n
${Object.keys(checks)
  .map((checkId) => toCheckSummary(checkId, checks[checkId], sourceChainKey))
  .join('\n')}

## Cross-Chain Simulation Results
${
  destinationSimulations && destinationSimulations.length > 0
    ? `\n${await formatCrossChainResults(destinationSimulations, destinationChecks)}`
    : '' // Render nothing if no destination sims
}
`;

  // Add table of contents and return report.
  return (await remark().use(remarkToc, { tight: true }).process(report)).toString();
}

function getOverallStatusFromChecks(checks: AllCheckResults): {
  status: 'success' | 'warning' | 'error' | 'inconclusive';
  skipped: Array<{ checkId: string; name: string; reason: string }>;
  warningCount: number;
  errorCount: number;
} {
  const skipped: Array<{ checkId: string; name: string; reason: string }> = [];
  let warningCount = 0;
  let errorCount = 0;

  for (const checkId in checks) {
    const { name, result } = checks[checkId];
    if (result.skipped) skipped.push({ checkId, name, reason: result.skipped.reason });
    warningCount += result.warnings.length;
    errorCount += result.errors.length;
  }

  if (errorCount > 0) {
    return { status: 'error', skipped, warningCount, errorCount };
  }
  if (warningCount > 0) {
    return { status: 'warning', skipped, warningCount, errorCount };
  }
  return { status: 'success', skipped, warningCount, errorCount };
}

async function formatExecutiveSummary(
  proposal: ProposalEvent,
  checks: AllCheckResults,
  destinationSimulations?: SimulationResult['destinationSimulations'],
  destinationChecks?: Record<number, AllCheckResults>,
): Promise<string> {
  const { status, skipped, warningCount, errorCount } = getOverallStatusFromChecks(checks);

  const statusLabel =
    status === 'success'
      ? 'SUCCESS'
      : status === 'warning'
        ? 'WARNING'
        : status === 'error'
          ? 'ERROR'
          : 'SUCCESS';

  const skippedText =
    skipped.length > 0
      ? ` • skipped checks: ${skipped
          .slice(0, 3)
          .map((s) => `${s.name} (${s.reason})`)
          .join('; ')}${skipped.length > 3 ? `; +${skipped.length - 3} more` : ''}`
      : '';

  const actionSummary = generateProposalSummary(proposal, checks, undefined, destinationChecks);

  const crossChainSummary = destinationSimulations?.length
    ? await formatCrossChainExecutiveSummary(destinationSimulations)
    : null;

  return [
    `- Action: ${actionSummary}`,
    `- Result: **${statusLabel}** (errors: ${errorCount}, warnings: ${warningCount}, skipped: ${skipped.length})${skippedText}`,
    ...(crossChainSummary ? [`- Cross-chain: ${crossChainSummary}`] : []),
  ].join('\n');
}

async function formatCrossChainExecutiveSummary(
  destinationSimulations: NonNullable<SimulationResult['destinationSimulations']>,
): Promise<string> {
  const byChain = destinationSimulations.reduce(
    (acc, sim) => {
      if (!acc[sim.chainId]) acc[sim.chainId] = [];
      acc[sim.chainId].push(sim);
      return acc;
    },
    {} as Record<number, NonNullable<SimulationResult['destinationSimulations']>>,
  );

  const chainSummaries = await Promise.all(
    Object.entries(byChain).map(async ([chainIdStr, sims]) => {
      const chainId = Number(chainIdStr);
      const chainName = getChainName(chainId);

      const total = sims.length;
      const succeeded = sims.filter((s) => s.status === 'success').length;
      const failed = sims.filter((s) => s.status === 'failure').length;
      const skipped = sims.filter((s) => s.status === 'skipped').length;
      const statusIcon = failed > 0 ? '❌' : skipped > 0 ? '⚠️' : succeeded === total ? '✅' : '⚠️';

      const uniqueCalls = new Set<string>();
      for (const sim of sims) {
        const target = sim.l2Params?.l2TargetAddress;
        const input = sim.l2Params?.l2InputData;
        if (!target || !input) continue;
        const decoded = await decodeContractCall(target, input, chainId);
        uniqueCalls.add(decoded?.signature || decoded?.selector || '(unknown)');
      }

      const callsText =
        uniqueCalls.size > 0 ? ` • ${Array.from(uniqueCalls).slice(0, 3).join(', ')}` : '';

      const skippedText = skipped > 0 ? `, ${skipped} skipped` : '';
      return `${statusIcon} ${chainName} (${chainId}) ${succeeded}/${total} succeeded${skippedText}${callsText}`;
    }),
  );

  return chainSummaries.join(' • ');
}

/**
 * Format cross-chain simulation results, grouping by chain ID
 */
async function formatCrossChainResults(
  destinationSimulations: SimulationResult['destinationSimulations'],
  destinationChecks?: Record<number, AllCheckResults>,
): Promise<string> {
  if (!destinationSimulations) return '';

  // Group simulations by chain ID
  const simulationsByChain = destinationSimulations.reduce(
    (acc, sim) => {
      const chainId = sim.chainId;
      if (!acc[chainId]) {
        acc[chainId] = [];
      }
      acc[chainId].push(sim);
      return acc;
    },
    {} as Record<number, typeof destinationSimulations>,
  );

  // Format each chain's section
  const chainSections = await Promise.all(
    Object.entries(simulationsByChain).map(async ([chainId, sims]) => {
      if (!sims || sims.length === 0) return '';

      const chainName = getChainName(Number(chainId));
      const bridgeType = sims[0].bridgeType;

      // Get the correct block explorer URL for this chain
      const chainConfig = getChainConfig(Number(chainId));
      const blockExplorerUrl = chainConfig.blockExplorer.baseUrl;

      // Format L1 message details with correct block explorer links
      const l1Messages = (
        await Promise.all(
          sims.map(async (sim, index) => {
            const l2Target = sim.l2Params?.l2TargetAddress;
            const l2InputData = sim.l2Params?.l2InputData;

            if (!l2Target) return `  - Message ${index + 1}: No target address`;

            const statusIcon =
              sim.status === 'success' ? '✅' : sim.status === 'skipped' ? '⚠️' : '❌';
            const label = getSimulationContractLabel(sim.sim, l2Target);
            const targetText = label
              ? `Target: ${label} ${toAddressLink(l2Target, blockExplorerUrl)}`
              : `Target: ${toAddressLink(l2Target, blockExplorerUrl)}`;

            let callText = 'Call: (unknown)';
            if (l2InputData) {
              const decoded = await decodeContractCall(l2Target, l2InputData, Number(chainId));
              if (decoded) {
                callText = `Call: \`${decoded.signature || decoded.selector}\``;
              }
            }

            return `  - Message ${index + 1} ${statusIcon}: ${targetText} • ${callText}`;
          }),
        )
      ).join('\n');

      // Get overall chain status
      const allSuccessful = sims.every((sim) => sim.status === 'success');
      const hasFailures = sims.some((sim) => sim.status === 'failure');
      const hasSkips = sims.some((sim) => sim.status === 'skipped');
      const status = hasFailures
        ? '❌ Failed'
        : hasSkips
          ? '⚠️ Partial (some destination sims skipped)'
          : allSuccessful
            ? '✅ Succeeded'
            : '⚠️ Partial';

      // Format check results for this chain
      let checkResults = '';
      if (destinationChecks?.[Number(chainId)]) {
        checkResults = '\n  ### L2 Checks\n';
        checkResults += Object.keys(destinationChecks[Number(chainId)])
          .map((checkId) =>
            toCheckSummary(checkId, destinationChecks[Number(chainId)][checkId], String(chainId)),
          )
          .join('\n');
      }

      // Format any errors
      const errors = sims
        .filter((sim) => sim.status === 'failure')
        .map((sim) => `    - Error: ${sim.error || 'Unknown error'}`)
        .join('\n');

      // Format L2 events from all simulations
      let l2Events = '';
      if (allSuccessful) {
        const allEventsArrays = await Promise.all(
          sims
            .filter((sim) => sim.sim)
            .map(async (sim, simIndex) => {
              const logs = sim.sim?.transaction.transaction_info.logs || [];

              const logPromises = logs.map(async (log) => {
                if (!log.name) return null;

                // Fix case-sensitivity bug: normalize addresses before comparison
                const contract = sim.sim?.contracts.find(
                  (c) => getAddress(c.address) === getAddress(log.raw.address),
                );

                // Use async getContractName with chain ID for better semantic names (e.g., "ARB Token")
                const contractName = await getContractName(contract, Number(chainId));

                const parsedInputs = log.inputs
                  .map((i) => `${i.soltype!.name}: ${i.value}`)
                  .join(', ');
                // Include simulation index to show which message this event came from
                const messageLabel = sims.length > 1 ? ` (Message ${simIndex + 1})` : '';
                return `  - ${contractName}${messageLabel}\n    * \`${log.name}(${parsedInputs})\``;
              });

              const results = await Promise.all(logPromises);
              return results.filter(Boolean);
            }),
        );

        const allEvents = allEventsArrays.flat();
        if (allEvents.length > 0) {
          l2Events = `\n  ### L2 Events\n${allEvents.join('\n')}`;
        }
      }

      return `### Chain: ${chainName} (${chainId})
- Bridge Type: ${bridgeType}
- L1 Messages:
${l1Messages}
- L2 Execution Status: ${status}
${errors ? `- Errors:\n${errors}` : ''}${l2Events}${checkResults}`;
    }),
  );

  return chainSections.filter(Boolean).join('\n\n');
}

/**
 * Intra-doc links are broken if the header has emojis, so we fix that here.
 * @dev This is a remark plugin, see the remark docs for more info on how it works.
 */
function remarkFixEmojiLinks() {
  return (tree: Root) => {
    visit(tree, 'link', ((node: Link) => {
      if (node.url) {
        const isInternalLink = node.url.startsWith('#');
        if (isInternalLink && node.url.endsWith('--passed-with-warnings')) {
          node.url = node.url.replace('--passed-with-warnings', '-❗❗-passed-with-warnings');
        } else if (isInternalLink && node.url.endsWith('--passed')) {
          node.url = node.url.replace('--passed', '-✅-passed');
        } else if (isInternalLink && node.url.endsWith('--failed')) {
          node.url = node.url.replace('--failed', '-❌-failed');
        } else if (isInternalLink && node.url.endsWith('--skipped')) {
          node.url = node.url.replace('--skipped', '-⏭️-skipped');
        }
      }
    }) as Visitor<Link>);
  };
}
