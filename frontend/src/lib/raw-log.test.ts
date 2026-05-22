import { describe, expect, it } from 'bun:test';
import { encodeEventTopics, getAddress, parseAbi } from 'viem';
import { formatRawLogFromJson } from './raw-log';

const MYSTERY_EVENT_ABI = parseAbi(['event MysteryEvent(address indexed account)']);

describe('formatRawLogFromJson', () => {
  it('keeps raw logs visible', () => {
    const account = getAddress('0x2222222222222222222222222222222222222222');
    const rawLog = JSON.stringify({
      raw: {
        topics: encodeEventTopics({
          abi: MYSTERY_EVENT_ABI,
          eventName: 'MysteryEvent',
          args: { account },
        }),
        data: '0x1234',
      },
    });

    const formatted = formatRawLogFromJson(rawLog);

    expect(formatted).toContain('RawLog(topic0: 0x');
    expect(formatted).toContain('topic1: 0x');
    expect(formatted).toContain(account.slice(2).toLowerCase());
    expect(formatted).toContain('data: 0x1234)');
  });

  it('keeps malformed raw logs visible', () => {
    expect(formatRawLogFromJson('not json')).toBe('Undecoded log: not json');
  });
});
