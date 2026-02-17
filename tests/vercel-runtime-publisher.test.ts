import { describe, expect, it } from 'bun:test';
import { publishViaVercelApi } from '../relay/vercel-runtime-publisher';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('vercel runtime publisher', () => {
  it('forces static framework config in deployment payload', async () => {
    const originalFetch = globalThis.fetch;

    let capturedBody = '';

    const mockedFetch: typeof fetch = async (_input, init) => {
      if (typeof init?.body === 'string') {
        capturedBody = init.body;
      }

      return new Response(JSON.stringify({ url: 'seatbelt-publish-example.vercel.app' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    globalThis.fetch = mockedFetch;

    try {
      const result = await publishViaVercelApi({
        artifactRaw: '{"ok":true}\n',
        publishLogEntry: {
          publish_id: 'pub-123',
          artifact_hash: 'abc123',
          published_at: '2026-02-17T00:00:00.000Z',
        },
        env: {
          SEATBELT_RELAY_VERCEL_TOKEN: 'token',
          SEATBELT_RELAY_VERCEL_PROJECT_ID: 'project-id',
          SEATBELT_RELAY_VERCEL_ORG_ID: 'team-id',
        },
      });

      expect(result.deploymentUrl).toBe('https://seatbelt-publish-example.vercel.app');

      const parsedBody: unknown = JSON.parse(capturedBody);
      if (!isRecord(parsedBody)) {
        throw new Error('Expected deployment request payload to be an object');
      }

      const files = parsedBody.files;
      if (!Array.isArray(files)) {
        throw new Error('Expected deployment request payload to include files');
      }

      const vercelConfigFile = files.find((entry) => {
        if (!isRecord(entry)) {
          return false;
        }

        return entry.file === 'vercel.json';
      });

      if (!isRecord(vercelConfigFile)) {
        throw new Error('Expected deployment request payload to include vercel.json');
      }

      expect(vercelConfigFile.data).toBe('{\n  "framework": null\n}\n');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
