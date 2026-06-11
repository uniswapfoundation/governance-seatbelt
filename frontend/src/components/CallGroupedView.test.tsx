import { describe, expect, it } from 'bun:test';
import type {
  CrossChainJobPreview,
  Proposal,
  StructuredSimulationReport,
} from '@/hooks/use-simulation-results';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encodeEventTopics, getAddress, parseAbi } from 'viem';
import { CallGroupedView } from './CallGroupedView';

const MYSTERY_EVENT_ABI = parseAbi(['event MysteryEvent(address indexed account)']);

function makeJob(
  overrides: Partial<CrossChainJobPreview> = {},
  signatures: string[] = ['bridgeAction()'],
): CrossChainJobPreview {
  const targets = [
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
  ] as const;

  return {
    chainId: 42161,
    chainName: 'Arbitrum',
    blockExplorerBaseUrl: 'https://arbiscan.io',
    bridgeType: 'ArbitrumL1L2',
    status: 'success',
    l2FromAddress: '0x1111111111111111111111111111111111111111',
    sourceOrder: 0,
    steps: signatures.map((signature, index) => ({
      stepIndex: index,
      status: 'success',
      l2TargetAddress: targets[index] ?? targets[0],
      l2Value: '0',
      l2InputData: `0x${String(index + 1).padStart(8, '0')}`,
      targetLabel: `Arbitrum target ${index + 1}`,
      call: {
        selector: `0x${String(index + 1).padStart(8, '0')}`,
        signature,
      },
    })),
    ...overrides,
  };
}

const proposal: Proposal = {
  id: '225',
  targets: [],
  values: [],
  calldatas: [],
  signatures: [],
  description: 'Cross-chain only proposal',
};

function makeReport(jobs: CrossChainJobPreview[]): StructuredSimulationReport {
  return {
    title: 'Cross-chain report',
    proposalText: '',
    status: 'success',
    summary: 'Cross-chain summary',
    checks: [],
    stateChanges: [],
    events: [],
    crossChain: { jobs },
    metadata: {
      proposalId: '225',
      proposer: '0x9999999999999999999999999999999999999999',
      chainId: 1,
      chainName: 'Ethereum',
      blockExplorerBaseUrl: 'https://etherscan.io',
    },
  };
}

function makeForwardedJob(overrides: Partial<CrossChainJobPreview> = {}): CrossChainJobPreview {
  return {
    chainId: 143,
    chainName: 'Monad',
    blockExplorerBaseUrl: 'https://monadvision.com',
    bridgeType: 'WormholeL1L2',
    status: 'success',
    l2FromAddress: '0x1111111111111111111111111111111111111111',
    sourceOrder: 0,
    steps: [
      {
        stepIndex: 0,
        status: 'success',
        l2TargetAddress: '0x2222222222222222222222222222222222222222',
        l2Value: '0',
        l2InputData: '0x6fadcf72',
        call: {
          selector: '0x6fadcf72',
          signature: 'forward(address,bytes)',
        },
        forwardedTargetAddress: '0x3333333333333333333333333333333333333333',
        forwardedCall: {
          selector: '0xf46901ed',
          signature: 'setFeeTo(address)',
        },
      },
    ],
    ...overrides,
  };
}

describe('CallGroupedView cross-chain summary headers', () => {
  it('omits aggregate action labels while keeping technical step details', () => {
    const html = renderToStaticMarkup(
      createElement(CallGroupedView, {
        proposal,
        report: makeReport([
          makeJob({ sourceOrder: 0 }, ['bridgeFirst()', 'bridgeSecond()']),
          makeJob({ sourceOrder: 1 }, ['cleanup()']),
        ]),
      }),
    );

    expect(html).not.toContain('2 actions');
    expect(html).not.toContain('Action 1');
    expect(html).not.toContain('Action 2');
    expect(html).not.toContain('Execution 1');
    expect(html).not.toContain('Execution 2');
    expect(html).toContain('bridgeFirst');
    expect(html).toContain('bridgeSecond');
    expect(html).toContain('cleanup');
    expect(html).toContain('3 cross-chain destination calls');
    expect(html).toContain('2 destination calls');
    expect(html).toContain('via Arbitrum');
    expect(html).not.toContain('via ArbitrumL1L2');
    expect(html).toContain('Arbitrum target 1');
    expect(html).toContain('Arbitrum target 2');
    expect(html).toContain('0x2222222222222222222222222222222222222222');
    expect(html).toContain('0x3333333333333333333333333333333333333333');
    expect(html).toContain(
      'inline-flex items-center justify-center h-5 w-5 rounded bg-muted text-[10px] font-semibold text-muted-foreground shrink-0',
    );
    expect(html).not.toContain('1 step');
    expect(html).not.toContain('2 steps');
  });

  it('shows forwarded inner calls in the detailed cross-chain call list', () => {
    const html = renderToStaticMarkup(
      createElement(CallGroupedView, {
        proposal,
        report: makeReport([makeForwardedJob()]),
      }),
    );

    expect(html).toContain('setFeeTo');
    expect(html).toContain('forward(address,bytes)');
    expect(html).toContain('0x3333333333333333333333333333333333333333');
  });
});

describe('CallGroupedView event rendering', () => {
  it('keeps legacy undecoded log rows visible under the emitting contract', () => {
    const emitter = '0x1111111111111111111111111111111111111111';
    const account = getAddress('0x2222222222222222222222222222222222222222');
    const rawLog = JSON.stringify({
      raw: {
        topics: encodeEventTopics({
          abi: MYSTERY_EVENT_ABI,
          eventName: 'MysteryEvent',
          args: { account },
        }),
        data: '0x1234',
      },
    });

    const html = renderToStaticMarkup(
      createElement(CallGroupedView, {
        proposal: {
          id: '1',
          targets: [emitter],
          values: [0n],
          calldatas: ['0x'],
          signatures: [''],
          description: 'Events proposal',
        },
        report: {
          ...makeReport([]),
          checks: [
            {
              checkId: 'checkLogs',
              title: 'Reports all events emitted from the proposal',
              status: 'passed',
              info: [`MysteryEmitter at \`${emitter}\``, `    Undecoded log: \`${rawLog}\``],
              warnings: [],
              errors: [],
            },
          ],
        },
      }),
    );

    expect(html).toContain('1 event');
    expect(html).toContain('RawLog');
    expect(html).toContain('Could not decode');
    expect(html).toContain('topic0');
    expect(html).toContain(account.slice(2).toLowerCase());
    expect(html).toContain('0x1234');
  });
});
