'use client';

import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const CACTUS_IPFS_GATEWAY = 'https://cloudflare-ipfs.com/ipfs/';
const CACTUS_COLLAPSED_HEIGHT = 400;
const cactusSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'ipfs'],
  },
};

export function getCactusProposalBody(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\\n/g, '\n');
  const firstLineBreak = normalizedMarkdown.indexOf('\n');

  if (firstLineBreak === -1) return normalizedMarkdown;

  return normalizedMarkdown.slice(firstLineBreak).trimStart();
}

export function getCactusImageSource(src?: string): string | undefined {
  if (!src?.startsWith('ipfs://')) return src;

  return `${CACTUS_IPFS_GATEWAY}${src.slice('ipfs://'.length)}`;
}

function getSafeImageDimension(value?: number | string): number | undefined {
  const dimension =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(dimension) && dimension >= 0 && dimension <= 10_000
    ? dimension
    : undefined;
}

function cactusUrlTransform(url: string): string {
  return url.startsWith('ipfs://') ? url : defaultUrlTransform(url);
}

export function CactusMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ node: _node, ...props }) => (
          <a
            {...props}
            className="text-[#1e7246] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          />
        ),
        h1: ({ node: _node, ...props }) => (
          <h1 {...props} className="mb-[0.5em] mt-[0.5em] text-[2em] font-bold leading-[1.5]" />
        ),
        h2: ({ node: _node, ...props }) => (
          <h2 {...props} className="mb-[0.3em] mt-[0.5em] text-[1.4em] font-bold leading-[1.5]" />
        ),
        h3: ({ node: _node, ...props }) => (
          <h3 {...props} className="mb-[0.3em] mt-[0.5em] text-[1.1em] font-bold leading-[1.5]" />
        ),
        h4: ({ node: _node, ...props }) => <h4 {...props} className="mb-[0.4em] font-bold" />,
        p: ({ node: _node, ...props }) => <p {...props} className="mb-2" />,
        ul: ({ node: _node, ...props }) => (
          <ul {...props} className="mb-4 ml-5 list-[circle] pl-5" />
        ),
        ol: ({ node: _node, ...props }) => (
          <ol {...props} className="mb-4 ml-5 list-decimal pl-5" />
        ),
        blockquote: ({ node: _node, ...props }) => (
          <blockquote
            {...props}
            className="mx-[10px] my-[1.5em] border-l-[10px] border-[#ccc] bg-[#f9f9f9] pb-[0.1em] pl-[10px] pr-[10px] pt-[0.7em]"
          />
        ),
        code: ({ node: _node, ...props }) => (
          <code
            {...props}
            style={{
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              marginBottom: '3px',
              marginTop: '1px',
            }}
          />
        ),
        pre: ({ node: _node, ...props }) => (
          <pre {...props} className="mb-[3px] mt-px overflow-x-auto bg-[#edf2f7] p-[5px]" />
        ),
        img: ({ node: _node, alt, height, src, title, width, ...props }) => {
          const maxWidth = title?.startsWith(':') ? '25px' : '100%';
          const safeHeight = getSafeImageDimension(height);
          const safeWidth = getSafeImageDimension(width);

          return (
            <img
              {...props}
              alt={alt ?? ''}
              height={safeHeight}
              src={getCactusImageSource(src)}
              title={title}
              width={safeWidth}
              style={{
                height: safeHeight ?? 'auto',
                marginBottom: '10px',
                maxWidth,
                width: safeWidth ?? maxWidth,
              }}
            />
          );
        },
        table: ({ node: _node, ...props }) => (
          <div className="mb-4 overflow-x-auto">
            <table {...props} className="w-full border-collapse text-left" />
          </div>
        ),
        thead: ({ node: _node, ...props }) => <thead {...props} className="bg-muted" />,
        th: ({ node: _node, ...props }) => (
          <th {...props} className="border border-border px-2 py-1.5 font-bold" />
        ),
        td: ({ node: _node, ...props }) => (
          <td {...props} className="border border-border px-2 py-1.5" />
        ),
      }}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, cactusSanitizeSchema]]}
      remarkPlugins={[remarkGfm]}
      urlTransform={cactusUrlTransform}
    >
      {content}
    </ReactMarkdown>
  );
}

export function ProposalDescriptionPreview({ description }: { description: string }) {
  const cactusBody = getCactusProposalBody(description);
  const [view, setView] = useState<'preview' | 'raw'>('preview');
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view !== 'preview' || !contentRef.current) return;

    const content = contentRef.current;
    const checkHeight = () => setCanExpand(content.scrollHeight > CACTUS_COLLAPSED_HEIGHT);
    const resizeObserver = new ResizeObserver(checkHeight);

    checkHeight();
    resizeObserver.observe(content);

    return () => resizeObserver.disconnect();
  }, [view]);

  return (
    <section className="w-[calc(100vw-32px)] space-y-2 sm:-ml-2 min-[62rem]:ml-0 min-[62rem]:w-[800px] min-[62rem]:max-w-[70%]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Proposal Details
        </h3>
        <fieldset
          aria-label="Proposal description view"
          className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px]"
        >
          <button
            type="button"
            aria-pressed={view === 'preview'}
            className={`h-6 rounded-md px-2 text-xs font-medium transition-colors ${
              view === 'preview'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setView('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            aria-pressed={view === 'raw'}
            className={`h-6 rounded-md px-2 text-xs font-medium transition-colors ${
              view === 'raw'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setView('raw')}
          >
            Raw
          </button>
        </fieldset>
      </div>

      {view === 'preview' ? (
        <div
          className="overflow-hidden rounded-[6px] border border-[#e5ece2] bg-[#fefefd]"
          style={{ fontFamily: 'var(--font-dm-sans), Inter, sans-serif' }}
        >
          <div
            id={contentId}
            className={`relative overflow-hidden ${expanded ? '' : 'max-h-[400px]'}`}
          >
            <div
              ref={contentRef}
              className="break-words p-3 text-base leading-6 text-[#1a202c] min-[48rem]:px-6 min-[48rem]:py-5"
            >
              <CactusMarkdown content={cactusBody} />
            </div>
            {!expanded && canExpand && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#fefefd]" />
            )}
          </div>
          {canExpand && (
            <div className="border-t border-[#e2e8f0] p-2">
              <button
                type="button"
                aria-controls={contentId}
                aria-expanded={expanded}
                className="w-full rounded-[6px] px-4 py-2 text-sm font-semibold leading-[1.2] text-[#2d3748] hover:bg-[#f6f4f0]"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/50 p-4 font-mono text-xs">
          {description}
        </pre>
      )}
    </section>
  );
}
