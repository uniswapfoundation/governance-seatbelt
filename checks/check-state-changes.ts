import { getAddress } from 'viem';
import type { CallTrace, ProposalCheck, SimulationStateChange, StateDiff } from '../types';
import { getContractName } from '../utils/clients/tenderly';
import {
  decodeMappingWrite,
  decodeStorageWrite,
  getVerifiedStorageLayout,
} from '../utils/storage-layout';

/** Ignore opcode/internal-function frames while retaining their nested contract calls. */
function contractCalls(trace: CallTrace): CallTrace[] {
  if (trace.error_reason) return [];
  const callType = (trace.call_type ?? trace.type ?? '').toUpperCase();
  if (
    !callType ||
    ['CALL', 'STATICCALL', 'DELEGATECALL', 'CALLCODE', 'CREATE', 'CREATE2'].includes(callType)
  )
    return [trace];
  return (trace.calls ?? []).flatMap(contractCalls);
}

/** Delegate calls execute implementation code in the caller's storage context. */
function storageCalls(
  trace: CallTrace,
  inheritedStorageAddress?: string,
): { storageAddress: string; codeAddress: string; input: string }[] {
  if (trace.error_reason) return [];
  const callType = (trace.call_type ?? trace.type ?? '').toUpperCase();
  const isDelegateCall = ['DELEGATECALL', 'CALLCODE'].includes(callType);
  const storageAddress = isDelegateCall ? inheritedStorageAddress : trace.to;
  const children = (trace.calls ?? []).flatMap(contractCalls);
  // Proxy forwarding passes the original calldata; library calls use their own selector.
  const forwardsCalldata = children.some(
    (call) =>
      call.input === trace.input &&
      ['DELEGATECALL', 'CALLCODE'].includes((call.call_type ?? call.type ?? '').toUpperCase()),
  );
  const currentCallEntries =
    storageAddress &&
    trace.to &&
    !forwardsCalldata &&
    !['STATICCALL', 'CREATE', 'CREATE2'].includes(callType)
      ? [
          {
            storageAddress: getAddress(storageAddress),
            codeAddress: getAddress(trace.to),
            input: trace.input,
          },
        ]
      : [];
  return [...currentCallEntries, ...children.flatMap((call) => storageCalls(call, storageAddress))];
}

/**
 * Reports all state changes from the proposal
 */
export const checkStateChanges: ProposalCheck = {
  name: 'Reports all state changes from the proposal',
  async checkProposal(_, sim, deps) {
    const info: string[] = [];
    const warnings: string[] = [];
    const storageChanges: SimulationStateChange[] = [];
    const warningsSeen = new Set<string>();
    // Check if the transaction reverted, and if so return revert reason
    if (!sim.transaction.status) {
      const txInfo = sim.transaction.transaction_info;
      const callTraceError = txInfo.call_trace.error_reason;
      const reason = callTraceError
        ? callTraceError
        : txInfo.stack_trace
          ? txInfo.stack_trace[0].error_reason
          : 'unknown error';
      const error = `Transaction reverted with reason: ${reason}`;
      return { info: [], warnings: [], errors: [error] };
    }

    // State diffs in the simulation are an array, so first we organize them by address. We skip
    // recording state changes for (1) the `queuedTransactions` mapping of the timelock, and
    // (2) the `proposal.executed` change of the governor, because this will be consistent across
    // all proposals and mainly add noise to the output
    if (!sim.transaction.transaction_info.state_diff) {
      const chainId = deps.chainConfig?.chainId ?? 1;
      if (chainId !== 1) {
        return {
          info: [
            'No state diff captured for this L2 simulation (this is common); rely on emitted logs + decoded calldata instead.',
          ],
          warnings: [],
          errors: [],
        };
      }

      return { info: [], warnings: ['State diff is empty'], errors: [] };
    }

    const stateDiffs = sim.transaction.transaction_info.state_diff.reduce(
      (diffs, diff) => {
        const addr = getAddress(diff.raw[0].address);
        // Check if this is a diff that should be filtered out
        const isGovernor = getAddress(addr) === deps.governor.address;
        const isProposalsVar =
          diff.soltype?.name === 'proposals' || diff.soltype?.name === '_proposals';
        const isTimelock = getAddress(addr) === deps.timelock.address;
        const isTimelockTimestamps = diff.soltype?.name === '_timestamps';
        const isQueuedTx = diff.soltype?.name.includes('queuedTransactions');
        const isExecutedSlot =
          diff.raw[0].original ===
            '0x0000000000000000000000000000000000000000000000000000000000000000' &&
          diff.raw[0].dirty ===
            '0x0000000000000000000000000000000000000000000000000000000000000100';

        const shouldSkipDiff =
          (isGovernor && isProposalsVar) ||
          (isGovernor && isExecutedSlot) ||
          (isTimelock && isQueuedTx) ||
          (isTimelock && isTimelockTimestamps);

        // Skip diffs as required and add the rest to our diffs object
        if (shouldSkipDiff) return diffs;
        if (!diffs[addr]) {
          diffs[addr] = [diff];
        } else {
          diffs[addr].push(diff);
        }
        return diffs;
      },
      {} as Record<string, StateDiff[]>,
    );

    // Return if no state diffs to show
    if (!Object.keys(stateDiffs).length)
      return { info: ['No state changes'], warnings: [], errors: [] };

    const executedCalls = storageCalls(sim.transaction.transaction_info.call_trace);

    // Parse state changes at each address
    // ETH balance changes are now handled by the checkEthBalanceChanges module
    for (const [address, diffs] of Object.entries(stateDiffs)) {
      const contract = sim.contracts.find((c) => getAddress(c.address) === address);
      const identifier = await getContractName(contract ?? { address }, deps.chainConfig?.chainId);
      info.push(identifier);
      const calls = executedCalls.filter((call) => call.storageAddress === address);
      const codeAddress = calls[0]?.codeAddress ?? address;
      const contractName = identifier.split(' at `')[0];
      const implementationInputs = calls
        .filter((call) => call.codeAddress === codeAddress)
        .map((call) => call.input);
      let layout: Awaited<ReturnType<typeof getVerifiedStorageLayout>> = null;
      if (
        diffs.some(
          (diff) => !diff.soltype && diff.raw.some((w) => /^0x[0-9a-fA-F]{64}$/.test(w.key)),
        )
      ) {
        try {
          const runtime =
            sim.contracts.find((c) => getAddress(c.address) === codeAddress)?.deployed_bytecode ??
            (await deps.publicClient?.getCode({
              address: codeAddress,
              blockNumber: BigInt(sim.transaction.block_number),
            }));
          if (runtime && /^0x[0-9a-fA-F]+$/.test(runtime)) {
            layout = await getVerifiedStorageLayout(
              codeAddress,
              deps.chainConfig.chainId,
              runtime as `0x${string}`,
            );
            // Library delegate calls keep this implementation's storage layout. A different
            // implementation in the same storage context is ambiguous, so leave its writes raw.
            if (
              layout &&
              calls.some(
                (call) =>
                  call.codeAddress !== codeAddress &&
                  !layout!.linkedLibraryAddresses.includes(call.codeAddress.toLowerCase()),
              )
            ) {
              layout = null;
            }
          }
        } catch {
          // Missing code or layout must not prevent reporting the raw writes.
          console.warn(
            `Storage layout unavailable for ${address} on chain ${deps.chainConfig?.chainId}`,
          );
        }
      }

      // Track processed state changes to deduplicate
      const processedChanges = new Set<string>();
      const formatRawValue = (value: unknown) => {
        if (typeof value === 'string') return value;
        return JSON.stringify(value);
      };

      // Parse each diff. A single diff may involve multiple storage changes, e.g. a proposal that
      // executes three transactions will show three state changes to the `queuedTransactions`
      // mapping within a single `diff` element. We always JSON.stringify the values so structs
      // (i.e. tuples) don't print as [object Object]
      for (const diff of diffs) {
        if (!diff.soltype) {
          // Fill missing Tenderly labels from a verified layout; otherwise retain raw writes.
          for (const w of diff.raw) {
            const oldVal = formatRawValue(w.original);
            const newVal = formatRawValue(w.dirty);
            const changeKey = `${w.key}:${oldVal}:${newVal}`;
            if (!processedChanges.has(changeKey)) {
              let decodedChanges = layout ? decodeStorageWrite(w, contractName, layout) : [];
              if (layout && !decodedChanges.length) {
                decodedChanges = decodeMappingWrite(w, contractName, layout, implementationInputs);
              }
              if (decodedChanges.length) {
                storageChanges.push(...decodedChanges);
                for (const change of decodedChanges) {
                  info.push(
                    `    \`${change.label}\`: \`${change.oldValue}\` → \`${change.newValue}\` (verified layout via ${change.storageDetails!.source})`,
                  );
                }
                info.push(`      Raw slot \`${w.key}\`: \`${oldVal}\` → \`${newVal}\``);
              } else {
                info.push(`    Slot \`${w.key}\` changed from \`${oldVal}\` to \`${newVal}\``);
              }
              processedChanges.add(changeKey);
            }
          }
        } else if (diff.soltype.simple_type) {
          // This is a simple type with a single changed value
          const oldVal = JSON.parse(JSON.stringify(diff.original));
          const newVal = JSON.parse(JSON.stringify(diff.dirty));
          const changeKey = `${diff.soltype.name}:${oldVal}:${newVal}`;
          if (!processedChanges.has(changeKey)) {
            info.push(`    \`${diff.soltype.name}\` changed from \`${oldVal}\` to \`${newVal}\``);
            processedChanges.add(changeKey);
          }
        } else if (/^mapping \((address|uint\d+) => uint\d+\)$/.test(diff.soltype.type)) {
          // This is a complex type like a mapping, which may have multiple changes. The diff.original
          // and diff.dirty fields can be strings or objects, and for complex types they are objects,
          // so we cast them as such

          // The original object can be null if the key was not present in the original state
          // Unsure if the same can happen to dirty, let's assume its possible to collect all keys
          const keys = Object.keys(diff.original || {}).concat(Object.keys(diff.dirty || {}));

          const original = diff.original as Record<string, string>;
          const dirty = diff.dirty as Record<string, string>;
          for (const k of keys) {
            const oldVal = formatRawValue(original && k in original ? original[k] : '');
            const newVal = formatRawValue(dirty && k in dirty ? dirty[k] : '');
            const changeKey = `${diff.soltype?.name}:${k}:${oldVal}:${newVal}`;
            if (!processedChanges.has(changeKey)) {
              info.push(
                `    \`${diff.soltype?.name}\` key \`${k}\` changed from \`${oldVal}\` to \`${newVal}\``,
              );
              processedChanges.add(changeKey);
            }
          }
        } else {
          // TODO arrays and nested mapping are currently not well supported -- find a transaction
          // that changes state of these types to inspect the Tenderly simulation response and
          // handle it accordingly. In the meantime we show a clearer fallback view of raw writes.
          const structuredType = diff.soltype?.type ?? 'unknown';
          const fallbackKey = `unsupported:${structuredType}`;
          if (!warningsSeen.has(fallbackKey)) {
            info.push(
              `    Structured diff fallback for type \`${structuredType}\`: displaying raw storage slot deltas.`,
            );
            warningsSeen.add(fallbackKey);
          }

          for (const w of diff.raw) {
            const oldVal = formatRawValue(w.original);
            const newVal = formatRawValue(w.dirty);
            const changeKey = `${w.key}:${oldVal}:${newVal}`;
            if (!processedChanges.has(changeKey)) {
              info.push(`      • Slot \`${w.key}\`: \`${oldVal}\` → \`${newVal}\``);
              processedChanges.add(changeKey);
            }
          }
        }
      }
    }

    return { info, warnings, errors: [], ...(storageChanges.length ? { storageChanges } : {}) };
  },
};
