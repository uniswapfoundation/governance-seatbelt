import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CactusMarkdown,
  ProposalDescriptionPreview,
  getCactusImageSource,
  getCactusProposalBody,
} from './ProposalDescriptionPreview';

describe('getCactusProposalBody', () => {
  it('removes the proposal title like Cactus', () => {
    expect(getCactusProposalBody('# Treasury proposal\n\nSend funds to the grants multisig.')).toBe(
      'Send funds to the grants multisig.',
    );
  });

  it('normalizes escaped newlines before removing the title', () => {
    expect(getCactusProposalBody('# Treasury proposal\\n- Send funds\\n- Update limits')).toBe(
      '- Send funds\n- Update limits',
    );
  });

  it('keeps a one-line description', () => {
    expect(getCactusProposalBody('One-line proposal')).toBe('One-line proposal');
  });
});

describe('CactusMarkdown', () => {
  it('renders the Markdown features used by Cactus proposals', () => {
    const html = renderToStaticMarkup(
      createElement(CactusMarkdown, {
        content: [
          '## Execution',
          '',
          '- Transfer funds',
          '',
          '[Read the discussion](https://gov.example.com)',
          '',
          '| Asset | Amount |',
          '| --- | ---: |',
          '| USDC | 100 |',
        ].join('\n'),
      }),
    );

    expect(html).toContain('<h2');
    expect(html).toContain('<ul');
    expect(html).toContain('<table');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('href="https://gov.example.com"');
  });

  it('rewrites IPFS image URLs like Cactus', () => {
    expect(getCactusImageSource('ipfs://QmProposalImage')).toBe(
      'https://cloudflare-ipfs.com/ipfs/QmProposalImage',
    );

    const html = renderToStaticMarkup(
      createElement(CactusMarkdown, {
        content: '![Proposal diagram](ipfs://QmProposalImage)',
      }),
    );

    expect(html).toContain('src="https://cloudflare-ipfs.com/ipfs/QmProposalImage"');
  });

  it('strips unsafe HTML', () => {
    const html = renderToStaticMarkup(
      createElement(CactusMarkdown, {
        content:
          '<script>alert("unsafe")</script><img src="https://example.com/image.png" onerror="alert(1)" width="1;position:fixed;inset:0">\n\n[Unsafe](javascript:alert(1))',
      }),
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('position:fixed');
  });
});

describe('ProposalDescriptionPreview', () => {
  it('defaults to a preview and keeps raw Markdown available', () => {
    const html = renderToStaticMarkup(
      createElement(ProposalDescriptionPreview, {
        description: '# Treasury proposal\n\nSend funds.',
      }),
    );

    expect(html).toContain('Preview');
    expect(html).toContain('Raw');
    expect(html).toContain('Send funds.');
    expect(html).not.toContain('Treasury proposal');
  });
});
