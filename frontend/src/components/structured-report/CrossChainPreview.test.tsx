import { describe, expect, it } from 'bun:test';
import type { CrossChainJobPreview } from '@/hooks/use-simulation-results';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrossChainPreview } from './CrossChainPreview';

function makeJob(
  overrides: Partial<CrossChainJobPreview> = {},
  stepCount = 1,
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
    steps: Array.from({ length: stepCount }, (_, index) => ({
      stepIndex: index,
      status: 'success',
      l2TargetAddress: targets[index] ?? targets[0],
      l2Value: '0',
      l2InputData: '0x12345678',
      targetLabel: `Arbitrum target ${index + 1}`,
      call: {
        selector: '0x12345678',
        signature: `bridgeAction${index + 1}()`,
      },
    })),
    ...overrides,
  };
}

describe('CrossChainPreview', () => {
  it('renders every destination step without aggregate action labels', () => {
    const html = renderToStaticMarkup(
      createElement(CrossChainPreview, {
        jobs: [makeJob({}, 1), makeJob({ sourceOrder: 1 }, 2)],
      }),
    );

    expect(html).toContain('Arbitrum');
    expect(html).toContain('Arbitrum target 1');
    expect(html).toContain('Arbitrum target 2');
    expect(html).toContain('bridgeAction1()');
    expect(html).toContain('bridgeAction2()');
    expect(html).toContain('From');
    expect(html).toContain('0x2222222222222222222222222222222222222222');
    expect(html).toContain('0x3333333333333333333333333333333333333333');
    expect(html).toContain('3 destination calls');
    expect(html).not.toContain('Action 1');
    expect(html).not.toContain('Action 2');
    expect(html).not.toContain('Execution 2');
    expect(html).not.toContain('1 step');
    expect(html).not.toContain('2 steps');
  });

  it('labels LayerZero job sources as receivers', () => {
    const html = renderToStaticMarkup(
      createElement(CrossChainPreview, {
        jobs: [
          makeJob({
            bridgeType: 'LayerZeroL1L2',
            chainName: 'MegaETH',
            l2FromAddress: '0x51F9629C1e75aF07421E662DBEb2B7dc8deDefd9',
          }),
        ],
      }),
    );

    expect(html).toContain('LayerZero');
    expect(html).toContain('Receiver');
    expect(html).toContain('0x51F9...efd9');
  });

  it('keeps different LayerZero receivers in separate cards', () => {
    const html = renderToStaticMarkup(
      createElement(CrossChainPreview, {
        jobs: [
          makeJob({
            bridgeType: 'LayerZeroL1L2',
            chainName: 'MegaETH',
            l2FromAddress: '0x8819b86ddF592c3aaAa6f9ec7cE1A0f99FC4322c',
          }),
          makeJob({
            bridgeType: 'LayerZeroL1L2',
            chainName: 'MegaETH',
            l2FromAddress: '0x51F9629C1e75aF07421E662DBEb2B7dc8deDefd9',
            sourceOrder: 1,
          }),
        ],
      }),
    );

    expect(html).toContain('0x8819...322c');
    expect(html).toContain('0x51F9...efd9');
    expect(html.match(/1 destination call/g) ?? []).toHaveLength(2);
  });
});
