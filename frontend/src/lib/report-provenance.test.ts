import { describe, expect, it } from 'bun:test';
import type { PublishArtifactMetadata, ReportTrustMetadata } from '@/hooks/use-simulation-results';
import {
  formatAuthenticityBadgeLabel,
  formatAuthenticityDetails,
  getCanonicalPublishedFileUrl,
  getVisibleTrustState,
} from './report-provenance';

describe('report provenance helpers', () => {
  it('hides generic trust warnings already explained by report status', () => {
    const trust: ReportTrustMetadata = {
      level: 'warning',
      warningReasons: [
        'Simulation completed with warnings or inconclusive checks.',
        'Some checks were skipped and should be reviewed.',
      ],
    };

    expect(getVisibleTrustState(trust)).toBeNull();
  });

  it('canonicalizes published file links away from vercel deployment urls', () => {
    const publish: PublishArtifactMetadata = {
      publishId: 'c270963b-e243-48a6-b853-bb8166929c76',
      artifactHash: 'hash',
      artifactUrl: 'https://seatbelt-publish-123.vercel.app/simulation-results.json',
      metadataUrl: 'https://seatbelt-publish-123.vercel.app/publish-metadata.json',
      publishedAt: '2026-03-28T01:37:48.565Z',
      authenticity: {
        status: 'verified',
        algorithm: 'ed25519',
        keyId: 'authenticity-v1',
      },
    };

    expect(getCanonicalPublishedFileUrl(publish, 'artifact')).toBe(
      'https://a-c270963b-e243-48a6-b853-bb8166929c76.publish.scopelift.co/simulation-results.json',
    );
    expect(getCanonicalPublishedFileUrl(publish, 'metadata')).toBe(
      'https://a-c270963b-e243-48a6-b853-bb8166929c76.publish.scopelift.co/publish-metadata.json',
    );
    expect(formatAuthenticityBadgeLabel(publish.authenticity)).toBe('Verified');
    expect(formatAuthenticityDetails(publish.authenticity)).toBe(
      'This report matches the signed artifact that was published.',
    );
  });

  it('falls back to the original vercel url when publish id is blank', () => {
    const publish = {
      publishId: '   ',
      artifactHash: 'hash',
      artifactUrl: 'https://seatbelt-publish-123.vercel.app/simulation-results.json',
      metadataUrl: 'https://seatbelt-publish-123.vercel.app/publish-metadata.json',
      publishedAt: '2026-03-28T01:37:48.565Z',
      authenticity: {
        status: 'verified',
        algorithm: 'ed25519',
        keyId: 'authenticity-v1',
      },
    } satisfies PublishArtifactMetadata;

    expect(getCanonicalPublishedFileUrl(publish, 'artifact')).toBe(publish.artifactUrl);
    expect(getCanonicalPublishedFileUrl(publish, 'metadata')).toBe(publish.metadataUrl);
  });
});
