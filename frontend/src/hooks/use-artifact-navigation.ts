'use client';

import { normalizeArtifactUrl, withArtifactParam } from '@/lib/share-link';
import { useSearchParams } from 'next/navigation';

export function useArtifactQueryParam(): string | null {
  const searchParams = useSearchParams();
  return normalizeArtifactUrl(searchParams.get('artifact'));
}

export function useHrefWithArtifact(href: string): string {
  const artifactUrl = useArtifactQueryParam();
  return withArtifactParam(href, artifactUrl);
}
