import type {
  Proposal,
  SimulationCheck,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { encodeFunctionData, maxUint256, parseAbi } from 'viem';

// Synthetic presentation inputs only. These are not simulated or executable proposals.
const proxy = '0x1111111111111111111111111111111111111111';
const receiver = '0x2222222222222222222222222222222222222222';
const implementation = '0x3333333333333333333333333333333333333333';
const unnamedTarget = '0x4444444444444444444444444444444444444444';
const hugeBytes = `0x${'abcdef0123456789'.repeat(512)}` as const;
const unknownCalldata = `0xdeadbeef${hugeBytes.slice(2)}` as const;
const recipients = Array.from({ length: 24 }, (): typeof receiver => receiver);
const namedSignature =
  'configureCrossChainPermissionsAndRateLimitsForRemoteGovernance(address authorizedCounterpartyWithAnIntentionallyLongParameterName, uint256 maximumLimit, bool enabled)';
const abi = parseAbi([
  `function ${namedSignature}`,
  'function sendMessage(address[] recipients, bytes[] payloads, string description)',
  'function forward(address target, bytes data)',
  'function setFeeTo(address recipient)',
  'function setParticipants(address first, address second, address third, address fourth, bool enabled)',
]);
const namedCalldata = encodeFunctionData({
  abi,
  functionName: 'configureCrossChainPermissionsAndRateLimitsForRemoteGovernance',
  args: [receiver, maxUint256, false],
});
const payloadCalldata = encodeFunctionData({
  abi,
  functionName: 'sendMessage',
  args: [recipients, [hugeBytes, '0x'], 'Unicode: 東京, Zürich; commas, parentheses (kept intact)'],
});
const participantsCalldata = encodeFunctionData({
  abi,
  functionName: 'setParticipants',
  args: [proxy, receiver, implementation, unnamedTarget, false],
});
const innerCalldata = encodeFunctionData({ abi, functionName: 'setFeeTo', args: [implementation] });
const forwardedCalldata = encodeFunctionData({
  abi,
  functionName: 'forward',
  args: [receiver, innerCalldata],
});
const failedCalldata = encodeFunctionData({
  abi,
  functionName: 'configureCrossChainPermissionsAndRateLimitsForRemoteGovernance',
  args: [implementation, maxUint256, false],
});
const namedCall = `configureCrossChainPermissionsAndRateLimitsForRemoteGovernance(${receiver}, ${maxUint256}, false)`;
const payloadCall = `sendMessage(${JSON.stringify(recipients)}, ${JSON.stringify([hugeBytes, '0x'])}, Unicode: 東京, Zürich; commas, parentheses (kept intact))`;
const info = [
  `Advisory: no exact trace match for target ${proxy}; decoded calldata via abi fallback.`,
  `\`${receiver}\` calls \`${namedCall}\` on VeryLongProxyContractNameForCrossChainGovernanceConfiguration at \`${proxy}\` (decoded from implementation ABI at \`${implementation}\`)`,
  `\`${receiver}\` calls \`${payloadCall}\` on VeryLongProxyContractNameForCrossChainGovernanceConfiguration at \`${proxy}\` (decoded from ABI)`,
  `\`${receiver}\` calls \`${payloadCall}\` on \`${unnamedTarget}\` (decoded from ABI)`,
  `On contract \`${implementation}\`, call \`${unknownCalldata}\` (not decoded)`,
  `\`${receiver}\` transfers 0.000000000000000001 ETH to \`${unnamedTarget}\` (formatted)`,
  `\`${receiver}\` calls \`setParticipants(${proxy}, ${receiver}, ${implementation}, ${unnamedTarget}, false)\` on \`${unnamedTarget}\` (decoded from ABI)`,
];

export const fixtureProposal: Proposal = {
  id: 'ui-fixture',
  targets: [proxy, proxy, unnamedTarget, implementation, unnamedTarget, unnamedTarget],
  signatures: [
    namedSignature,
    'sendMessage(address[] recipients, bytes[] payloads, string description)',
    '',
    '',
    '',
    '',
  ],
  calldatas: [
    namedCalldata,
    payloadCalldata,
    payloadCalldata,
    unknownCalldata,
    '0x',
    participantsCalldata,
  ],
  values: [0n, 0n, 0n, 0n, 1n, 0n],
  description: 'Synthetic UI stress fixture',
};

export const fixtureCheck: SimulationCheck = {
  checkId: 'checkDecodeCalldata',
  title: 'Decodes target calldata into a human-readable format',
  status: 'warning',
  warnings: [`Failed to decode function with selector 0xdeadbeef for contract ${implementation}`],
  errors: [],
  info,
  details: [
    `**Warning**: Failed to decode function with selector 0xdeadbeef for contract ${implementation}`,
    ...info.map((line) => `**Info**: ${line}`),
  ].join('\n\n'),
};

export const fixtureReport: StructuredSimulationReport = {
  title: 'Synthetic UI stress fixture',
  proposalText: '',
  status: 'warning',
  summary: 'Presentation cases only. No simulation was run.',
  checks: [
    fixtureCheck,
    {
      checkId: 'checkLogs',
      title: 'Events',
      status: 'passed',
      warnings: [],
      errors: [],
      info: [
        `Proxy at \`${proxy}\``,
        `    \`RawLog(topic0: 0x${'ab'.repeat(32)}, data: ${hugeBytes})\``,
        `    \`PermissionUpdated(account: ${receiver}, enabled: false)\``,
        '    `Paused()`',
      ],
    },
  ],
  stateChanges: [],
  events: [],
  metadata: {
    proposalId: 'ui-fixture',
    proposer: receiver,
    chainId: 1,
    chainName: 'Ethereum',
    blockExplorerBaseUrl: 'https://etherscan.io',
    addressLabels: {
      [proxy]: {
        label: 'VeryLongProxyContractNameForCrossChainGovernanceConfiguration',
        type: 'contract',
      },
      [receiver]: {
        label:
          'A deliberately long recipient label that must wrap without covering the copy button',
        type: 'governance',
      },
    },
  },
  crossChain: {
    jobs: [
      {
        chainId: 42161,
        chainName: 'Arbitrum',
        blockExplorerBaseUrl: 'https://arbiscan.io',
        bridgeType: 'WormholeL1L2',
        status: 'failure',
        l2FromAddress: receiver,
        sourceOrder: 0,
        steps: [
          {
            stepIndex: 0,
            status: 'success',
            l2TargetAddress: proxy,
            l2Value: '0',
            l2InputData: forwardedCalldata,
            targetLabel: 'TransportContractThatForwardsTheGovernanceAction',
            call: {
              selector: forwardedCalldata.slice(0, 10) as `0x${string}`,
              signature: 'forward(address target,bytes data)',
              args: [receiver, innerCalldata],
            },
            forwardedTargetAddress: receiver,
            forwardedTargetLabel: 'DestinationContractWithAnExtremelyLongButUnmodifiedOriginalName',
            forwardedCall: {
              selector: '0xf46901ed',
              signature: 'setFeeTo(address recipient)',
              args: [implementation],
            },
          },
          {
            stepIndex: 1,
            status: 'failure',
            error: `Destination call reverted: a deliberately long diagnostic including revert data 0x${'ab'.repeat(128)}`,
            l2TargetAddress: receiver,
            l2Value: '1',
            l2InputData: failedCalldata,
            targetLabel: 'DestinationContractWithAnExtremelyLongButUnmodifiedOriginalName',
            call: {
              selector: namedCalldata.slice(0, 10) as `0x${string}`,
              signature: namedSignature,
            },
          },
          {
            stepIndex: 2,
            status: 'skipped',
            l2TargetAddress: unnamedTarget,
            l2Value: '0',
            l2InputData: '0xdeadbeef',
            error: 'Skipped because a prior destination call failed.',
          },
        ],
      },
    ],
  },
};
