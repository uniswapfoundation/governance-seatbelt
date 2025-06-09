import fs, { promises as fsp, writeFileSync } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
import type {
  AllCheckResults,
  GovernorType,
  ProposalEvent,
  SimulationBlock,
  SimulationCalldata,
  SimulationCheck,
  SimulationEvent,
  SimulationStateChange,
  StructuredSimulationReport,
} from '../types';
import { formatProposalId } from '../utils/contracts/governor';

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
 * @param code whether to link to the code tab
 */
export function toAddressLink(address: string, code = false) {
  return `[\`${address}\`](https://etherscan.io/address/${address}${code ? '#code' : ''})`;
}

// -- Report formatters ---

function toMessageList(header: string, text: string[]): string {
  return text.length > 0
    ? `${bold(header)}:\n\n${text
        .filter((msg) => msg.trim())
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
function toCheckSummary({
  result: { errors, warnings, info },
  name,
}: AllCheckResults[string]): string {
  const status =
    errors.length === 0
      ? warnings.length === 0
        ? '✅ Passed'
        : '❗❗ **Passed with warnings**'
      : '❌ **Failed**';

  return `### ${name} ${status}

${toMessageList('Errors', errors)}

${toMessageList('Warnings', warnings)}

${toMessageList('Info', info)}
`;
}

/**
 * Pulls the title out of the markdown description, from the first markdown h1 line
 * @param description the proposal description
 */
function getProposalTitle(description: string) {
  const match = description.match(/^\s*#\s*(.*)\s*\n/);
  if (!match || match.length < 2) return 'Title not found';
  return match[1];
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
 * Generate a structured report from the check results
 */
function generateStructuredReport(
  governorType: GovernorType,
  blocks: { current: SimulationBlock; start: SimulationBlock | null; end: SimulationBlock | null },
  proposal: ProposalEvent,
  checks: AllCheckResults,
): StructuredSimulationReport {
  // Extract title and proposal text
  const title = getProposalTitle(proposal.description.trim());
  const proposalText = proposal.description.trim();

  // Determine overall status
  let status: 'success' | 'warning' | 'error' = 'success';
  for (const checkId in checks) {
    const { result } = checks[checkId];
    if (result.errors.length > 0) {
      status = 'error';
      break;
    }
    if (result.warnings.length > 0) {
      status = 'warning';
    }
  }

  // Format checks
  const formattedChecks: SimulationCheck[] = Object.entries(checks).map(([_, check]) => {
    const { name, result } = check;
    const { errors, warnings, info } = result;

    let checkStatus: 'passed' | 'warning' | 'failed' = 'passed';
    if (errors.length > 0) {
      checkStatus = 'failed';
    } else if (warnings.length > 0) {
      checkStatus = 'warning';
    }

    // Combine all messages into details
    const details = [
      ...errors.map((msg) => `**Error**: ${msg}`),
      ...warnings.map((msg) => `**Warning**: ${msg}`),
      ...info.map((msg) => `**Info**: ${msg}`),
    ].join('\n\n');

    return {
      title: name,
      status: checkStatus,
      details,
      info,
    };
  });

  // Extract state changes
  const stateChanges: SimulationStateChange[] = [];
  // Look for state changes in the check results
  for (const checkId in checks) {
    const { result } = checks[checkId];

    // Track the current contract name and address
    let currentContract = '';
    let currentContractAddress = '';

    for (const infoMsg of result.info) {
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
          oldValue: slotChangeMatch[2], // Already clean, no quotes
          newValue: slotChangeMatch[3], // Already clean, no quotes
        });
        continue;
      }

      // Try to extract mapping state changes (if any): "`variable` key `key` changed from `value` to `newvalue`"
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

      // Try to extract simple type state changes (if any): "`variable` changed from `value` to `newvalue`"
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

  // Extract events
  const events: SimulationEvent[] = [];
  // Look for events in the check results
  for (const checkId in checks) {
    const { result } = checks[checkId];
    for (const infoMsg of result.info) {
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

  // Extract calldata
  let calldata: SimulationCalldata | undefined;
  // Look for calldata in the check results
  for (const checkId in checks) {
    if (checkId === 'decode-calldata') {
      const { result } = checks[checkId];
      for (const infoMsg of result.info) {
        // Try to extract calldata from info messages
        if (infoMsg.includes('transfers') || infoMsg.includes('calls')) {
          calldata = {
            decoded: infoMsg,
            raw: proposal.calldatas.join(', '),
          };
          break;
        }
      }
    }
  }

  // Create the structured report
  return {
    title,
    proposalText,
    status,
    summary: `Simulation ${status === 'success' ? 'completed successfully' : status === 'warning' ? 'completed with warnings' : 'failed'} for proposal: "${title}".`,
    checks: formattedChecks,
    stateChanges,
    events,
    calldata,
    metadata: {
      blockNumber: blocks.current.number?.toString() ?? 'unknown',
      timestamp: blocks.current.timestamp.toString(),
      proposalId: formatProposalId(governorType, proposal.id!),
      proposer: proposal.proposer,
    },
  };
}

/**
 * @notice Write simulation results to frontend public directory for easy access
 * @param governorType The type of governor contract
 * @param blocks The relevant blocks for the proposal
 * @param proposal The proposal details
 * @param checks The check results
 * @param markdownReport The full markdown report
 */
export function writeFrontendData(
  governorType: GovernorType,
  blocks: { current: SimulationBlock; start: SimulationBlock | null; end: SimulationBlock | null },
  proposal: ProposalEvent,
  checks: AllCheckResults,
  markdownReport: string,
) {
  // Only write frontend data if we're in proposal creation mode (SIM_NAME is set)
  if (!process.env.SIM_NAME) {
    return;
  }

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

    // Generate the structured report
    const structuredReport = generateStructuredReport(governorType, blocks, proposal, checks);

    // Create a simplified report structure for the frontend
    const reportForFrontend = {
      status: structuredReport.status,
      summary: structuredReport.summary,
      markdownReport,
      structuredReport,
    };

    // Use the correct path to the frontend/public directory
    const projectRoot = join(__dirname, '..');
    const frontendPublicDir = join(projectRoot, 'frontend', 'public');

    // Create the directory if it doesn't exist
    if (!existsSync(frontendPublicDir)) {
      mkdirSync(frontendPublicDir, { recursive: true });
    }

    // Write the frontend data
    writeFileSync(
      join(frontendPublicDir, 'simulation-results.json'),
      JSON.stringify([{ proposalData, report: reportForFrontend }], (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
    console.log('Frontend data written for proposal creation');
  } catch (error) {
    console.error('Error writing frontend data:', error);
  }
}

/**
 * Generates the proposal report and saves Markdown, PDF, and HTML versions of it.
 * Also writes the report data to the frontend/public directory for easy access.
 * @param blocks the relevant blocks for the proposal.
 * @param proposal The proposal details.
 * @param checks The checks results.
 * @param dir The directory where the file should be saved. It will be created if it doesn't exist.
 * @param filename The name of the file. All report formats will have the same filename with different extensions.
 */
export async function generateAndSaveReports(
  governorType: GovernorType,
  blocks: { current: SimulationBlock; start: SimulationBlock | null; end: SimulationBlock | null },
  proposal: ProposalEvent,
  checks: AllCheckResults,
  dir: string,
) {
  // Prepare the output folder and filename.
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const id = formatProposalId(governorType, proposal.id!);
  const path = `${dir}/${id}`;

  // Generate the base markdown proposal report. This is the markdown report which is translated into other file types.
  const baseReport = await toMarkdownProposalReport(governorType, blocks, proposal, checks);

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

  // Generate the structured report for JSON output
  const structuredReport = generateStructuredReport(governorType, blocks, proposal, checks);

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
        },
      },
    ),
  ]);

  // Write frontend data if in proposal creation mode
  writeFrontendData(governorType, blocks, proposal, checks, markdownReport);
}

/**
 * Produce a markdown report summarizing the result of all the checks for a given proposal.
 * @param blocks the relevant blocks for the proposal.
 * @param proposal The proposal details.
 * @param checks The checks results.
 */
async function toMarkdownProposalReport(
  governorType: GovernorType,
  blocks: { current: SimulationBlock; start: SimulationBlock | null; end: SimulationBlock | null },
  proposal: ProposalEvent,
  checks: AllCheckResults,
): Promise<string> {
  const { id, proposer, targets, endBlock, startBlock, description } = proposal;

  if (!blocks.current.number) throw new Error('Current block number is null');

  // Generate the report. We insert an empty table of contents header which is populated later using remark-toc.
  const report = `
# ${getProposalTitle(description.trim())}

_Updated as of block [${blocks.current.number}](https://etherscan.io/block/${blocks.current.number}) at ${formatTime(
    blocks.current.timestamp,
  )}_

- ID: ${formatProposalId(governorType, id!)}
- Proposer: ${toAddressLink(proposer)}
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
- Targets: ${targets.map((target) => toAddressLink(target, true)).join('; ')}

## Table of contents

This is filled in by remark-toc and this sentence will be removed.

## Proposal Text

${blockQuote(description.trim())}

## Checks\n
${Object.keys(checks)
  .map((checkId) => toCheckSummary(checks[checkId]))
  .join('\n')}
`;

  // Add table of contents and return report.
  return (await remark().use(remarkToc, { tight: true }).process(report)).toString();
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
        }
      }
    }) as Visitor<Link>);
  };
}
