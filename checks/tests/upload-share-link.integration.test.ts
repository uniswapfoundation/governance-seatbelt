import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRelayFetchHandler } from '../../relay/server';

const artifactPath = resolve(
  import.meta.dir,
  '../../tests/fixtures/upload/simulation-results.proposed.json',
);
const uploadScript = resolve(import.meta.dir, '../../scripts/upload.ts');

for (const mode of ['pretty', 'lookup-unavailable', 'viewer-unconfigured'] as const) {
  test(`upload CLI prints the report link with ${mode}`, async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'seatbelt-share-link-'));
    let publishedArtifact = '';
    let publishedId = '';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        // External Upstash and Vercel boundaries stay local: CI must not publish publicly.
        if (pathname === '/redis')
          return Response.json({ error: 'Storage unavailable' }, { status: 503 });
        if (pathname === '/simulation-results.json') return new Response(publishedArtifact);
        return handler(request);
      },
    });
    const artifactUrl = `${server.url}simulation-results.json`;
    const handler: (request: Request) => Promise<Response> = createRelayFetchHandler({
      env: {
        ...(mode !== 'viewer-unconfigured' && {
          SEATBELT_VIEWER_URL: 'https://seatbelt.example/old-report?stale=1#section',
        }),
        ...(mode === 'lookup-unavailable' && {
          UPSTASH_REDIS_REST_URL: `${server.url}redis`,
          UPSTASH_REDIS_REST_TOKEN: 'local-test',
        }),
      },
      dependencies: {
        publisher: async ({ artifactRaw, publishLogEntry }) => {
          publishedArtifact = artifactRaw;
          publishedId = publishLogEntry.publish_id;
          return {
            deploymentUrl: server.url.toString(),
            artifactUrl,
            metadataUrl: `${server.url}publish-metadata.json`,
          };
        },
      },
    });

    try {
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          uploadScript,
          '--artifact',
          artifactPath,
          '--publish',
          '--relay-url',
          server.url.toString(),
          '--log',
          join(tempDir, 'publish.jsonl'),
        ],
        cwd: tempDir,
        env: { PATH: process.env.PATH },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(stdout).toContain('[upload] Publish succeeded.');
      const shareLine = stdout.split('\n').find((line) => line.startsWith('[upload] Share URL'));
      if (mode === 'pretty') {
        expect(shareLine).toBe(`[upload] Share URL: https://seatbelt.example/p/${publishedId}`);
        const lookup = await fetch(`${server.url}api/v1/publishes/${publishedId}`);
        expect(lookup.status).toBe(200);
        expect((await lookup.json()).artifactUrl).toBe(artifactUrl);
      } else if (mode === 'lookup-unavailable') {
        expect(shareLine).toBe(
          `[upload] Share URL: https://seatbelt.example/?artifact=${encodeURIComponent(artifactUrl)}`,
        );
        expect(stdout).not.toContain('https://seatbelt.example/p/');
      } else {
        expect(shareLine).toBe(
          '[upload] Share URL unavailable: configure SEATBELT_VIEWER_URL on the relay.',
        );
      }
      const published = await fetch(artifactUrl);
      const reports = await published.json();
      expect(reports[0].report.structuredReport.metadata.proposalId).toBe('123');
    } finally {
      server.stop(true);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}
