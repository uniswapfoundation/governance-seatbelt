/**
 * Check execution timeouts.
 *
 * Parsed from environment variables but safe to import in tests (no required envs).
 *
 * Env vars:
 * - CHECKS_GLOBAL_TIMEOUT_MS: total budget for running all checks (per chain simulation)
 * - CHECK_TIMEOUT_MS: default per-check timeout
 * - CHECK_TIMEOUT_OVERRIDES_JSON: JSON map of { "<checkKey>": <timeoutMs> }
 */

const DEFAULT_CHECKS_GLOBAL_TIMEOUT_MS = 15 * 60_000; // 15 minutes
const DEFAULT_CHECK_TIMEOUT_MS = 5 * 60_000; // 5 minutes

function parsePositiveInteger(envName: string, defaultValue: number): number {
  const raw = process.env[envName];
  if (!raw) return defaultValue;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`Invalid ${envName}="${raw}", using default ${defaultValue}ms`);
    return defaultValue;
  }

  return parsed;
}

function parseTimeoutOverrides(): Record<string, number> {
  const raw = process.env.CHECK_TIMEOUT_OVERRIDES_JSON;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('Invalid CHECK_TIMEOUT_OVERRIDES_JSON: expected JSON object');
      return {};
    }

    const overrides: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const numberValue =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : Number.NaN;

      if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue <= 0) {
        console.warn(
          `Invalid CHECK_TIMEOUT_OVERRIDES_JSON value for "${key}": ${JSON.stringify(value)}`,
        );
        continue;
      }
      overrides[key] = numberValue;
    }

    return overrides;
  } catch (error) {
    console.warn('Failed to parse CHECK_TIMEOUT_OVERRIDES_JSON:', error);
    return {};
  }
}

export const CHECKS_GLOBAL_TIMEOUT_MS = parsePositiveInteger(
  'CHECKS_GLOBAL_TIMEOUT_MS',
  DEFAULT_CHECKS_GLOBAL_TIMEOUT_MS,
);

export const CHECK_TIMEOUT_MS = parsePositiveInteger('CHECK_TIMEOUT_MS', DEFAULT_CHECK_TIMEOUT_MS);

export const CHECK_TIMEOUT_OVERRIDES_MS = parseTimeoutOverrides();
