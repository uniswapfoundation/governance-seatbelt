function hasRawLog(value: unknown): value is { raw: { topics: unknown[]; data?: unknown } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'raw' in value &&
    typeof value.raw === 'object' &&
    value.raw !== null &&
    'topics' in value.raw &&
    Array.isArray(value.raw.topics)
  );
}

export function formatRawLogFromJson(rawJson: string) {
  try {
    const log: unknown = JSON.parse(rawJson);
    if (!hasRawLog(log)) return `Undecoded log: ${rawJson}`;

    const fields = log.raw.topics
      .filter((topic): topic is string => typeof topic === 'string')
      .map((topic, index) => `topic${index}: ${topic}`);

    if (typeof log.raw.data === 'string') fields.push(`data: ${log.raw.data}`);

    return fields.length ? `RawLog(${fields.join(', ')})` : `Undecoded log: ${rawJson}`;
  } catch {
    return `Undecoded log: ${rawJson}`;
  }
}
