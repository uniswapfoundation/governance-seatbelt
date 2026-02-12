import { createHash, randomUUID } from 'node:crypto';

export type PublishMetadata = {
  publish_id: string;
  published_at: string;
  artifact_hash: string;
};

export function computeArtifactHash(rawArtifact: string): string {
  return createHash('sha256').update(rawArtifact).digest('hex');
}

export function createPublishMetadata(
  artifactHash: string,
  now: Date = new Date(),
): PublishMetadata {
  return {
    publish_id: randomUUID(),
    published_at: now.toISOString(),
    artifact_hash: artifactHash,
  };
}
