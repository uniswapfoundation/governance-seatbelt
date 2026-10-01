import type { AllCheckResults, CheckResult } from '../types.d';

function dedupeStrings(messages: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const message of messages) {
    if (seen.has(message)) continue;
    seen.add(message);
    deduped.push(message);
  }

  return deduped;
}

function dedupeJsonValues<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = JSON.stringify(item, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeCheckResult(current: CheckResult, next: CheckResult): CheckResult {
  const info = dedupeStrings([...current.info, ...next.info]);
  const warnings = dedupeStrings([...current.warnings, ...next.warnings]);
  const errors = dedupeStrings([...current.errors, ...next.errors]);

  // Treat merged checks as skipped only when all merged runs were skipped.
  const skippedReasons = [current.skipped?.reason, next.skipped?.reason].filter(
    (reason): reason is string => Boolean(reason),
  );
  const skipped =
    current.skipped && next.skipped && skippedReasons.length > 0
      ? { reason: dedupeStrings(skippedReasons).join(' | ') }
      : undefined;

  const permissionsDiffMerged = dedupeJsonValues([
    ...(current.permissionsDiff ?? []),
    ...(next.permissionsDiff ?? []),
  ]);
  const permissionsDiff = permissionsDiffMerged.length > 0 ? permissionsDiffMerged : undefined;

  const storageChanges = dedupeJsonValues([
    ...(current.storageChanges ?? []),
    ...(next.storageChanges ?? []),
  ]);

  let data = current.data ?? next.data;
  if (current.data !== undefined && next.data !== undefined) {
    if (Array.isArray(current.data) && Array.isArray(next.data)) {
      data = dedupeJsonValues([...current.data, ...next.data]);
    } else if (isPlainObject(current.data) && isPlainObject(next.data)) {
      data = { ...current.data, ...next.data };
    }
  }

  return {
    info,
    warnings,
    errors,
    ...(data !== undefined ? { data } : {}),
    ...(skipped ? { skipped } : {}),
    ...(permissionsDiff ? { permissionsDiff } : {}),
    ...(storageChanges.length ? { storageChanges } : {}),
  };
}

export function mergeAllCheckResults(
  current: AllCheckResults,
  next: AllCheckResults,
): AllCheckResults {
  const merged: AllCheckResults = { ...current };

  for (const [checkId, nextCheck] of Object.entries(next)) {
    const currentCheck = merged[checkId];

    if (!currentCheck) {
      merged[checkId] = nextCheck;
      continue;
    }

    merged[checkId] = {
      name: currentCheck.name || nextCheck.name,
      result: mergeCheckResult(currentCheck.result, nextCheck.result),
    };
  }

  return merged;
}
