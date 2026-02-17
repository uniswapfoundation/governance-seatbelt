'use client';

import { buildCanonicalShareUrl, buildViewerUrl, normalizeArtifactUrl } from '@/lib/share-link';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Clipboard copy failed');
  }
}

async function requestShareArtifact(): Promise<string> {
  const response = await fetch('/api/share-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Ignore parse failures and fall through to a generic error.
  }

  if (!response.ok) {
    throw new Error('Share link generation failed');
  }

  if (!payload || typeof payload !== 'object' || !('artifactUrl' in payload)) {
    throw new Error('Share link response is invalid');
  }

  const artifactUrl = Reflect.get(payload, 'artifactUrl');
  const normalizedArtifactUrl =
    typeof artifactUrl === 'string' ? normalizeArtifactUrl(artifactUrl) : null;

  if (!normalizedArtifactUrl) {
    throw new Error('Share link response is invalid');
  }

  return normalizedArtifactUrl;
}

function getCanonicalViewerUrl(): string {
  if (typeof window === 'undefined') {
    throw new Error('Window is unavailable');
  }

  return buildViewerUrl(window.location.origin);
}

function updateArtifactParamInUrl(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  artifactUrl: string,
) {
  const query = new URLSearchParams(searchParams.toString());
  query.set('artifact', artifactUrl);

  const basePath = pathname || '/';
  const destination = query.size > 0 ? `${basePath}?${query.toString()}` : basePath;
  router.replace(destination, { scroll: false });
}

export function useShareLink() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const artifactFromQuery = normalizeArtifactUrl(searchParams.get('artifact'));

  const generateMutation = useMutation({
    mutationFn: requestShareArtifact,
  });

  const handleShare = async () => {
    const viewerUrl = getCanonicalViewerUrl();

    if (artifactFromQuery) {
      try {
        const shareUrl = buildCanonicalShareUrl(viewerUrl, artifactFromQuery);
        await copyToClipboard(shareUrl);
        toast.success('Share link copied');
      } catch (error) {
        console.error('Error copying existing share link:', error);
        toast.error('Couldn’t generate share link. Try again.');
      }

      return;
    }

    try {
      const artifactUrl = await generateMutation.mutateAsync();
      const shareUrl = buildCanonicalShareUrl(viewerUrl, artifactUrl);
      await copyToClipboard(shareUrl);
      updateArtifactParamInUrl(router, pathname, searchParams, artifactUrl);
      toast.success('Share link ready — copied to clipboard');
    } catch (error) {
      console.error('Error generating share link:', error);
      toast.error('Couldn’t generate share link. Try again.');
    }
  };

  return {
    hasArtifact: artifactFromQuery !== null,
    isGenerating: generateMutation.isPending,
    onShare: handleShare,
  };
}
