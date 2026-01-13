import type {
  AllCheckResults,
  ProposalCheck,
  ProposalData,
  ProposalEvent,
  TenderlySimulation,
} from '../types.d';

export type CheckTimeoutConfig = {
  globalTimeoutMs: number;
  defaultPerCheckTimeoutMs: number;
  perCheckTimeoutOverridesMs?: Record<string, number>;
};

function formatTimeoutMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function timeoutSkipResult(reason: string) {
  return { info: [], warnings: [], errors: [], skipped: { reason } };
}

async function runCheckSafely(
  checkId: string,
  check: ProposalCheck,
  proposal: ProposalEvent,
  sim: TenderlySimulation,
  deps: ProposalData,
  l2Simulations?: {
    chainId: number;
    sim: TenderlySimulation;
  }[],
) {
  try {
    return await check.checkProposal(proposal, sim, deps, l2Simulations);
  } catch (error) {
    const msg = `Unhandled exception in ${check.name} (${checkId}): ${toErrorMessage(error)}`;
    console.warn(msg);
    return { info: [], warnings: [], errors: [msg] };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  const result = await Promise.race([promise, timedOut]);
  if (timeoutId) clearTimeout(timeoutId);
  return result;
}

export async function runChecksWithTimeouts(
  checks: Record<string, ProposalCheck>,
  proposal: ProposalEvent,
  sim: TenderlySimulation,
  deps: ProposalData,
  l2Simulations: { chainId: number; sim: TenderlySimulation }[] | undefined,
  config: CheckTimeoutConfig,
): Promise<AllCheckResults> {
  const results: AllCheckResults = {};

  const checksInOrder = Object.entries(checks);
  const globalDeadlineMs = Date.now() + config.globalTimeoutMs;

  for (let i = 0; i < checksInOrder.length; i++) {
    const [checkId, check] = checksInOrder[i];

    const remainingGlobalMs = globalDeadlineMs - Date.now();
    if (remainingGlobalMs <= 0) {
      const globalReason = `Skipped: global checks timeout of ${formatTimeoutMs(config.globalTimeoutMs)} exceeded`;
      for (const [remainingCheckId, remainingCheck] of checksInOrder.slice(i)) {
        results[remainingCheckId] = {
          name: remainingCheck.name,
          result: timeoutSkipResult(globalReason),
        };
      }
      break;
    }

    const overrides = config.perCheckTimeoutOverridesMs ?? {};
    const configuredTimeoutMs = overrides[checkId] ?? config.defaultPerCheckTimeoutMs;
    const effectiveTimeoutMs = Math.min(configuredTimeoutMs, remainingGlobalMs);
    const timeoutKind = effectiveTimeoutMs === remainingGlobalMs ? 'global' : 'per-check';

    const maybeResult = await withTimeout(
      runCheckSafely(checkId, check, proposal, sim, deps, l2Simulations),
      effectiveTimeoutMs,
    );

    if (maybeResult === null) {
      if (timeoutKind === 'per-check') {
        results[checkId] = {
          name: check.name,
          result: timeoutSkipResult(
            `Timed out after ${formatTimeoutMs(effectiveTimeoutMs)} (per-check timeout)`,
          ),
        };
        continue;
      }

      results[checkId] = {
        name: check.name,
        result: timeoutSkipResult(
          `Timed out after ${formatTimeoutMs(effectiveTimeoutMs)} (global checks timeout)`,
        ),
      };

      const globalReason = `Skipped: global checks timeout of ${formatTimeoutMs(config.globalTimeoutMs)} exceeded`;
      for (const [remainingCheckId, remainingCheck] of checksInOrder.slice(i + 1)) {
        results[remainingCheckId] = {
          name: remainingCheck.name,
          result: timeoutSkipResult(globalReason),
        };
      }
      break;
    }

    results[checkId] = { name: check.name, result: maybeResult };
  }

  return results;
}
