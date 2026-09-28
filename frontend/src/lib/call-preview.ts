// Legacy report prose has no reliable argument boundaries. Abbreviate only long
// hex payloads and flat JSON hex arrays; preserve other arguments and their order.
export function formatCallPreview(call: string): string {
  return call.replace(/\["0x[\da-f]*"(?:,\s*"0x[\da-f]*")*\]|0x[\da-f]{97,}/gi, (value) => {
    if (value.startsWith('[')) {
      return value.length > 160 ? `${value.slice(0, 64)}…]` : value;
    }
    return `${value.slice(0, 18)}…${value.slice(-8)}`;
  });
}
