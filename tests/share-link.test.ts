import { describe, expect, it } from 'bun:test';
import {
  buildCanonicalShareUrl,
  normalizeArtifactUrl,
  withArtifactParam,
} from '../frontend/src/lib/share-link';

describe('share-link helpers', () => {
  it('builds canonical share url with artifact query only', () => {
    const result = buildCanonicalShareUrl(
      'https://seatbelt-viewer.vercel.app/?foo=bar#section',
      'https://seatbelt-publish.vercel.app/simulation-results.json',
    );

    expect(result).toBe(
      'https://seatbelt-viewer.vercel.app/?artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%2Fsimulation-results.json',
    );
  });

  it('normalizes base deployment urls to simulation-results.json', () => {
    expect(normalizeArtifactUrl('https://seatbelt-publish.vercel.app')).toBe(
      'https://seatbelt-publish.vercel.app/simulation-results.json',
    );

    expect(normalizeArtifactUrl('https://seatbelt-publish.vercel.app/deployments/abc123')).toBe(
      'https://seatbelt-publish.vercel.app/deployments/abc123/simulation-results.json',
    );
  });

  it('does not append simulation-results.json when it is already present', () => {
    expect(
      normalizeArtifactUrl('https://seatbelt-publish.vercel.app/simulation-results.json'),
    ).toBe('https://seatbelt-publish.vercel.app/simulation-results.json');
  });

  it('preserves existing query params when adding artifact to internal links', () => {
    const result = withArtifactParam(
      '/action?tab=checks',
      'https://seatbelt-publish.vercel.app/simulation-results.json',
    );

    expect(result).toBe(
      '/action?tab=checks&artifact=https%3A%2F%2Fseatbelt-publish.vercel.app%2Fsimulation-results.json',
    );
  });

  it('leaves href unchanged when artifact is missing', () => {
    expect(withArtifactParam('/action?tab=checks', null)).toBe('/action?tab=checks');
  });

  it('rejects artifact urls with credentials', () => {
    const artifactUrlWithCredentials = [
      'https://user',
      'pass@seatbelt-publish.vercel.app/simulation-results.json',
    ].join(':');

    expect(normalizeArtifactUrl(artifactUrlWithCredentials)).toBe(null);
  });
});
