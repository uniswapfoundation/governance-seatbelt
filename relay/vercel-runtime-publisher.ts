type OpenJsonObject = Record<string, unknown>;

type RelayPublisherResult = {
  deploymentUrl: string;
  artifactUrl: string;
  metadataUrl: string;
};

type RelayPublishLogEntry = {
  publish_id: string;
  artifact_hash: string;
  published_at: string;
  [key: string]: unknown;
};

type RuntimePublisherInput = {
  artifactRaw: string;
  publishLogEntry: RelayPublishLogEntry;
  env: Record<string, string | undefined>;
};

type VercelPublishEnv = {
  token: string;
  projectId: string;
  orgId: string;
};

const VERCEL_API_BASE_URL = 'https://api.vercel.com';

function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function readPrimaryOrAliasEnv(
  env: Record<string, string | undefined>,
  primaryName: string,
  aliasName: string,
): string | undefined {
  const primaryValue = readNonEmptyEnv(env, primaryName);
  if (primaryValue) {
    return primaryValue;
  }

  return readNonEmptyEnv(env, aliasName);
}

function formatEnvPair(primaryName: string, aliasName: string): string {
  return `${primaryName} (or ${aliasName})`;
}

function readManagedVercelEnv(env: Record<string, string | undefined>): VercelPublishEnv {
  const token = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN');
  const projectId = readPrimaryOrAliasEnv(
    env,
    'SEATBELT_RELAY_VERCEL_PROJECT_ID',
    'VERCEL_PROJECT_ID',
  );
  const orgId = readPrimaryOrAliasEnv(env, 'SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID');

  const missing: string[] = [];

  if (!token) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_TOKEN', 'VERCEL_TOKEN'));
  }

  if (!projectId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_PROJECT_ID', 'VERCEL_PROJECT_ID'));
  }

  if (!orgId) {
    missing.push(formatEnvPair('SEATBELT_RELAY_VERCEL_ORG_ID', 'VERCEL_ORG_ID'));
  }

  if (missing.length > 0) {
    throw new Error(
      `Relay publish is missing required environment variables: ${missing.join(', ')}.`,
    );
  }

  if (!token || !projectId || !orgId) {
    throw new Error('Relay Vercel env validation failed unexpectedly.');
  }

  return {
    token,
    projectId,
    orgId,
  };
}

function appendPathToUrl(baseUrl: string, relativePath: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${relativePath}`;
  }

  return `${baseUrl}/${relativePath}`;
}

function toDeploymentUrl(value: string): string {
  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value;
  }

  return `https://${value}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPublishLandingPage(logEntry: RelayPublishLogEntry): string {
  const metadataJson = escapeHtml(JSON.stringify(logEntry, null, 2));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Seatbelt publish artifact</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        margin: 2rem;
        line-height: 1.5;
        background: #0f1117;
        color: #e6edf3;
      }
      a {
        color: #7cc7ff;
      }
      pre {
        padding: 1rem;
        border-radius: 0.5rem;
        background: #161b22;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <h1>Seatbelt simulation publish</h1>
    <p>This deployment contains a validated simulation artifact.</p>
    <ul>
      <li><a href="./simulation-results.json">simulation-results.json</a></li>
      <li><a href="./publish-metadata.json">publish-metadata.json</a></li>
    </ul>
    <h2>Publish metadata</h2>
    <pre>${metadataJson}</pre>
  </body>
</html>
`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return undefined;
}

function summarizeErrorPayload(value: unknown): string {
  if (!isRecord(value)) {
    return '(non-JSON error payload)';
  }

  const errorCode = readOptionalString(value, 'error');
  const message = readOptionalString(value, 'message');

  if (errorCode && message) {
    return `${errorCode}: ${message}`;
  }

  if (message) {
    return message;
  }

  if (errorCode) {
    return errorCode;
  }

  return JSON.stringify(value);
}

function buildDeploymentRequestBody(input: {
  projectId: string;
  publishLogEntry: RelayPublishLogEntry;
  artifactRaw: string;
}): OpenJsonObject {
  return {
    name: 'seatbelt-publish',
    project: input.projectId,
    target: 'production',
    files: [
      {
        file: 'simulation-results.json',
        data: input.artifactRaw,
      },
      {
        file: 'publish-metadata.json',
        data: `${JSON.stringify(input.publishLogEntry, null, 2)}\n`,
      },
      {
        file: 'index.html',
        data: buildPublishLandingPage(input.publishLogEntry),
      },
      {
        file: 'vercel.json',
        // Force static-file deployment even if the target Vercel project has a framework preset.
        data: `${JSON.stringify({ framework: null }, null, 2)}\n`,
      },
    ],
  };
}

async function createDeployment(input: {
  artifactRaw: string;
  publishLogEntry: RelayPublishLogEntry;
  vercelEnv: VercelPublishEnv;
}): Promise<string> {
  const url = `${VERCEL_API_BASE_URL}/v13/deployments?teamId=${encodeURIComponent(input.vercelEnv.orgId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.vercelEnv.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(
      buildDeploymentRequestBody({
        projectId: input.vercelEnv.projectId,
        publishLogEntry: input.publishLogEntry,
        artifactRaw: input.artifactRaw,
      }),
    ),
  });

  const responseText = await response.text();

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText) as unknown;
  } catch {
    parsedBody = undefined;
  }

  if (!response.ok) {
    throw new Error(
      `Vercel deployment API request failed with HTTP ${response.status}. ${summarizeErrorPayload(parsedBody)}`,
    );
  }

  if (!isRecord(parsedBody)) {
    throw new Error('Vercel deployment API returned a non-object response.');
  }

  const deploymentUrl = readOptionalString(parsedBody, 'url');
  if (!deploymentUrl) {
    throw new Error('Vercel deployment API response was missing deployment url.');
  }

  return toDeploymentUrl(deploymentUrl);
}

export async function publishViaVercelApi(
  input: RuntimePublisherInput,
): Promise<RelayPublisherResult> {
  const vercelEnv = readManagedVercelEnv(input.env);

  const deploymentUrl = await createDeployment({
    artifactRaw: input.artifactRaw,
    publishLogEntry: input.publishLogEntry,
    vercelEnv,
  });

  return {
    deploymentUrl,
    artifactUrl: appendPathToUrl(deploymentUrl, 'simulation-results.json'),
    metadataUrl: appendPathToUrl(deploymentUrl, 'publish-metadata.json'),
  };
}
