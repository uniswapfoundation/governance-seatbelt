import { describe, expect, it } from 'bun:test';
import type { CrossChainJobStepPreview } from '@/hooks/use-simulation-results';
import {
  formatBridgeType,
  formatCrossChainCall,
  getCrossChainStepTarget,
  getCrossChainTransportLabel,
} from './cross-chain';

function makeForwardStep(): CrossChainJobStepPreview {
  return {
    stepIndex: 0,
    status: 'success',
    l2TargetAddress: '0x100000000000000000000000000000000000b110',
    l2Value: '0',
    l2InputData:
      '0x6fadcf72000000000000000000000000100000000000000000000000000000000000b11100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024f46901ed000000000000000000000000100000000000000000000000000000000000b11500000000000000000000000000000000000000000000000000000000',
    call: {
      selector: '0x6fadcf72',
      signature: 'forward(address,bytes)',
    },
    forwardedTargetAddress: '0x100000000000000000000000000000000000B111',
    forwardedCall: {
      selector: '0xf46901ed',
      signature: 'setFeeTo(address)',
    },
  };
}

describe('cross-chain formatting', () => {
  it('unwraps forwarded Wormhole calls to the inner target and function', () => {
    const step = makeForwardStep();

    expect(formatCrossChainCall(step)).toBe('setFeeTo(address)');
    expect(getCrossChainStepTarget(step)).toBe('0x100000000000000000000000000000000000B111');
    expect(getCrossChainTransportLabel(step)).toBe('forward(address,bytes)');
  });

  it('preserves the forwarded target when the inner call is undecodable', () => {
    const step = {
      ...makeForwardStep(),
      forwardedCall: undefined,
    } satisfies CrossChainJobStepPreview;

    expect(formatCrossChainCall(step)).toBe('forward(address,bytes)');
    expect(getCrossChainStepTarget(step)).toBe('0x100000000000000000000000000000000000B111');
    expect(getCrossChainTransportLabel(step)).toBe('forward(address,bytes)');
  });

  it('uses readable bridge labels for report badges', () => {
    expect(formatBridgeType('LayerZeroL1L2')).toBe('LayerZero');
    expect(formatBridgeType('WormholeL1L2')).toBe('Wormhole');
    expect(formatBridgeType('UnknownBridge')).toBe('UnknownBridge');
  });
});
