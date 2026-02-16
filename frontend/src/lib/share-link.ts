const ARTIFACT_QUERY_PARAM = 'artifact';
const INTERNAL_BASE_URL = 'https://seatbelt.local';

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function supportsArtifactProtocol(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'http:';
}

export function normalizeArtifactUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!supportsArtifactProtocol(parsed)) return null;
    if (parsed.username || parsed.password) return null;

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildCanonicalShareUrl(viewerUrl: string, artifactUrl: string): string {
  const normalizedArtifactUrl = normalizeArtifactUrl(artifactUrl);
  if (!normalizedArtifactUrl) {
    throw new Error('Invalid artifact URL');
  }

  const parsedViewerUrl = new URL(viewerUrl);
  parsedViewerUrl.search = '';
  parsedViewerUrl.hash = '';
  parsedViewerUrl.searchParams.set(ARTIFACT_QUERY_PARAM, normalizedArtifactUrl);

  return parsedViewerUrl.toString();
}

export function buildViewerUrl(origin: string): string {
  return new URL('/', origin).toString();
}

export function withArtifactParam(href: string, artifactUrl: string | null): string {
  const normalizedArtifactUrl = normalizeArtifactUrl(artifactUrl);
  if (!normalizedArtifactUrl) return href;

  const absoluteHref = isAbsoluteUrl(href);
  const parsedHref = absoluteHref ? new URL(href) : new URL(href, INTERNAL_BASE_URL);

  parsedHref.searchParams.set(ARTIFACT_QUERY_PARAM, normalizedArtifactUrl);

  if (absoluteHref) {
    return parsedHref.toString();
  }

  return `${parsedHref.pathname}${parsedHref.search}${parsedHref.hash}`;
}
