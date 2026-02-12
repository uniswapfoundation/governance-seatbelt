import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PublishArtifactValidationError,
  type PublishableSimulationResult,
  validatePublishArtifact,
} from '../utils/publish/artifact-validator';
import { computeArtifactHash, createPublishMetadata } from '../utils/publish/publish-metadata';

type UploadArgs = {
  artifactPath: string;
  logPath: string;
  publish: boolean;
  validateOnly: boolean;
};

const DEFAULT_ARTIFACT_PATH = 'frontend/public/simulation-results.json';
const DEFAULT_LOG_PATH = '.seatbelt/publish-log.jsonl';

function printHelp() {
  console.log('Seatbelt upload (Phase 1 scaffold)');
  console.log('');
  console.log('Usage: bun upload [options]');
  console.log('');
  console.log('Options:');
  console.log('  --artifact <path>      Path to simulation-results artifact');
  console.log('  --publish              Attempt Vercel publish (scaffold hook)');
  console.log('  --validate-only        Validate + log metadata without publish attempt');
  console.log('  --log <path>           Publish metadata log path');
  console.log('  -h, --help             Show this help');
}

function parseUploadArgs(argv: string[]): UploadArgs {
  const parsed: UploadArgs = {
    artifactPath: DEFAULT_ARTIFACT_PATH,
    logPath: DEFAULT_LOG_PATH,
    publish: false,
    validateOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--artifact') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --artifact');
      }
      parsed.artifactPath = value;
      i += 1;
      continue;
    }

    if (arg === '--log') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --log');
      }
      parsed.logPath = value;
      i += 1;
      continue;
    }

    if (arg === '--publish') {
      parsed.publish = true;
      continue;
    }

    if (arg === '--validate-only') {
      parsed.validateOnly = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

type PublishLogEntry = {
  publish_id: string;
  published_at: string;
  artifact_hash: string;
  schema_version: number;
  simulation_type: string;
  proposal_id: string;
  chain_id: number;
  artifact_path: string;
  mode: 'validate-only' | 'upload-scaffold';
};

function appendPublishLog(logPath: string, entry: PublishLogEntry) {
  const fullPath = resolve(logPath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const serialized = `${JSON.stringify(entry)}\n`;
  writeFileSync(fullPath, serialized, { flag: 'a' });
}

function buildLogEntry(
  validated: PublishableSimulationResult,
  artifactPath: string,
  mode: PublishLogEntry['mode'],
  artifactHash: string,
): PublishLogEntry {
  const metadata = validated.report.structuredReport.metadata;
  const publishMetadata = createPublishMetadata(artifactHash);

  return {
    ...publishMetadata,
    schema_version: metadata.schemaVersion,
    simulation_type: metadata.simulationType,
    proposal_id: metadata.proposalId,
    chain_id: metadata.chainId,
    artifact_path: resolve(artifactPath),
    mode,
  };
}

function assertVercelConfigForPublish() {
  const missing = ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'].filter(
    (name) => !process.env[name],
  );

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Vercel publish not configured. Missing environment variables: ${missing.join(', ')}.`,
  );
}

async function runUploadScaffold(logEntry: PublishLogEntry): Promise<void> {
  assertVercelConfigForPublish();

  console.log('[upload] Validation succeeded.');
  console.log('[upload] Vercel publish hook is scaffolded and blocked until Day 3 implementation.');
  console.log('[upload] Metadata:');
  console.log(JSON.stringify(logEntry, null, 2));

  throw new Error('Vercel deploy step is not implemented yet (planned for Day 3).');
}

export async function runUpload(argv: string[]): Promise<number> {
  try {
    const args = parseUploadArgs(argv);
    const artifactPath = resolve(args.artifactPath);

    if (!existsSync(artifactPath)) {
      throw new Error(`Artifact not found at ${artifactPath}`);
    }

    const rawArtifact = readFileSync(artifactPath, 'utf8');
    const parsedArtifact: unknown = JSON.parse(rawArtifact);
    const validated = validatePublishArtifact(parsedArtifact);
    const artifactHash = computeArtifactHash(rawArtifact);

    const mode: PublishLogEntry['mode'] = args.publish ? 'upload-scaffold' : 'validate-only';
    const logEntry = buildLogEntry(validated, artifactPath, mode, artifactHash);
    appendPublishLog(args.logPath, logEntry);

    console.log('[upload] Artifact validation passed.');
    console.log(`[upload] Artifact hash: ${artifactHash}`);
    console.log(`[upload] Publish metadata logged at: ${resolve(args.logPath)}`);

    if (args.validateOnly || !args.publish) {
      console.log('[upload] Validation-only mode complete.');
      console.log(JSON.stringify(logEntry, null, 2));
      return 0;
    }

    await runUploadScaffold(logEntry);
    return 0;
  } catch (error) {
    if (error instanceof PublishArtifactValidationError) {
      console.error(error.message);
      return 1;
    }

    if (error instanceof Error) {
      console.error(`[upload] ${error.message}`);
      return 1;
    }

    console.error('[upload] Unknown upload error');
    return 1;
  }
}

if (import.meta.main) {
  const code = await runUpload(process.argv.slice(2));
  process.exit(code);
}
