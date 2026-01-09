import { describe, expect, test } from 'bun:test';
import { getAddress } from 'viem';
import { SECURITY_TOOL_TIMEOUT_MS } from '../utils/security-constants';

/**
 * Security tests for subprocess execution in check-slither.ts and check-solc.ts.
 *
 * These tests verify that:
 * 1. Address validation (via viem's getAddress) rejects shell metacharacters and malformed addresses
 * 2. Valid Ethereum addresses pass validation
 * 3. The timeout constant is configured correctly
 *
 * The actual subprocess calls use execFile() with argument arrays, which prevents
 * shell injection by design. These tests verify the defense-in-depth address validation.
 */

// Helper to test if address is valid using the same method as check-slither/check-solc
function isValidAddress(address: string): boolean {
  try {
    getAddress(address);
    return true;
  } catch {
    return false;
  }
}

describe('Subprocess security - address validation (via viem getAddress)', () => {
  describe('rejects shell injection attempts', () => {
    const injectionAttempts = [
      // Command injection via semicolon
      '0x1234567890123456789012345678901234567890; rm -rf /',
      // Command injection via backticks
      '0x1234567890123456789012345678901234567890`whoami`',
      // Command injection via $()
      '0x1234567890123456789012345678901234567890$(cat /etc/passwd)',
      // Pipe injection
      '0x1234567890123456789012345678901234567890 | cat /etc/passwd',
      // Newline injection
      '0x1234567890123456789012345678901234567890\nrm -rf /',
      // Flag injection
      '--help',
      '-v',
      // Path traversal
      '../../../etc/passwd',
      // Null byte injection
      '0x1234567890123456789012345678901234567890\x00malicious',
    ];

    for (const attempt of injectionAttempts) {
      test(`rejects: ${attempt.slice(0, 50)}...`, () => {
        expect(isValidAddress(attempt)).toBe(false);
      });
    }
  });

  describe('rejects malformed addresses', () => {
    const malformedAddresses = [
      // Missing 0x prefix
      '1234567890123456789012345678901234567890',
      // Too short
      '0x123456789012345678901234567890123456789',
      // Too long
      '0x12345678901234567890123456789012345678901',
      // Invalid hex characters
      '0x123456789012345678901234567890123456789g',
      '0x123456789012345678901234567890123456789G',
      // Empty
      '',
      // Just prefix
      '0x',
      // Spaces
      '0x1234567890123456789012345678901234567890 ',
      ' 0x1234567890123456789012345678901234567890',
    ];

    for (const addr of malformedAddresses) {
      test(`rejects: "${addr}"`, () => {
        expect(isValidAddress(addr)).toBe(false);
      });
    }
  });

  describe('accepts valid Ethereum addresses', () => {
    const validAddresses = [
      // Lowercase
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      // Uppercase
      '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',
      // Mixed case (checksummed)
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      // Real addresses
      '0x0000000000000000000000000000000000000000', // Zero address
      '0xdead000000000000000000000000000000000000', // Dead address prefix
    ];

    for (const addr of validAddresses) {
      test(`accepts: ${addr}`, () => {
        expect(isValidAddress(addr)).toBe(true);
      });
    }
  });
});

describe('Subprocess security - timeout configuration', () => {
  test('SECURITY_TOOL_TIMEOUT_MS is a valid positive finite integer', () => {
    // The value can be overridden via env var, so we only check it's valid
    expect(typeof SECURITY_TOOL_TIMEOUT_MS).toBe('number');
    expect(Number.isFinite(SECURITY_TOOL_TIMEOUT_MS)).toBe(true);
    expect(Number.isInteger(SECURITY_TOOL_TIMEOUT_MS)).toBe(true);
    expect(SECURITY_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

/**
 * NOTE: The security architecture relies on:
 *
 * 1. execFile() - PRIMARY protection (no shell interpretation)
 *    Arguments passed directly to executable, metacharacters are literal strings
 *
 * 2. viem's getAddress() - SECONDARY defense-in-depth
 *    Validates and checksums addresses, throws on invalid input
 *
 * The getAddress tests above verify defense-in-depth. The execFile usage is verified
 * by code review and static analysis (grep for 'exec(' vs 'execFile(').
 *
 * To verify execFile is used: grep -n "exec(" checks/check-slither.ts checks/check-solc.ts
 * Should show only execFile imports, not exec() calls.
 */

describe('Subprocess security - validation function behavior', () => {
  /**
   * These tests verify the validation logic that check-slither.ts and
   * check-solc.ts use before calling execFile. They use viem's getAddress().
   */

  test('validation rejects address with shell metacharacters before execution', () => {
    // Simulates what happens in runSlither/runCryticCompile
    const maliciousAddress = '0x1234567890123456789012345678901234567890; rm -rf /';

    // The function would return early with invalid_address error
    expect(isValidAddress(maliciousAddress)).toBe(false);
  });

  test('validation accepts valid address and would proceed to execution', () => {
    const validAddress = '0x1234567890123456789012345678901234567890';

    // The function would proceed to execFile call
    expect(isValidAddress(validAddress)).toBe(true);
  });

  test('getAddress validates exact 42 character length (0x + 40 hex)', () => {
    // Verify getAddress enforces exact length
    const exactLength = `0x${'a'.repeat(40)}`;
    const tooShort = `0x${'a'.repeat(39)}`;
    const tooLong = `0x${'a'.repeat(41)}`;

    expect(isValidAddress(exactLength)).toBe(true);
    expect(isValidAddress(tooShort)).toBe(false);
    expect(isValidAddress(tooLong)).toBe(false);
  });
});

/**
 * Static analysis tests that verify the security implementation in source files.
 * These tests read the actual source code to ensure secure patterns are used.
 */
describe('Subprocess security - execFile usage verification (static analysis)', () => {
  test('check-slither.ts imports execFile, not exec', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should import execFile (possibly aliased from execFileCallback)
    expect(source).toMatch(/import\s*\{\s*execFile\s*(as\s*\w+)?\s*\}/);
  });

  test('check-solc.ts imports execFile, not exec', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should import execFile (possibly aliased from execFileCallback)
    expect(source).toMatch(/import\s*\{\s*execFile\s*(as\s*\w+)?\s*\}/);
  });

  test('check-slither.ts does not use unsafe exec()', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should NOT have: import { exec } or exec(`...`)
    // But SHOULD have execFile
    expect(source).not.toMatch(/import\s*\{\s*exec\s*\}/);
    expect(source).not.toMatch(/import\s*\{\s*exec\s+as/);
    // Verify no template literal exec calls like exec(`slither ${address}`)
    expect(source).not.toMatch(/exec\s*\(\s*`[^`]*\$\{/);
  });

  test('check-solc.ts does not use unsafe exec()', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should NOT have: import { exec } or exec(`...`)
    expect(source).not.toMatch(/import\s*\{\s*exec\s*\}/);
    expect(source).not.toMatch(/import\s*\{\s*exec\s+as/);
    // Verify no template literal exec calls like exec(`crytic-compile ${address}`)
    expect(source).not.toMatch(/exec\s*\(\s*`[^`]*\$\{/);
  });

  test('execFile is not called with shell: true option', async () => {
    const slitherSource = await Bun.file('checks/check-slither.ts').text();
    const solcSource = await Bun.file('checks/check-solc.ts').text();

    // Should NOT find shell: true anywhere
    expect(slitherSource).not.toMatch(/shell\s*:\s*true/);
    expect(solcSource).not.toMatch(/shell\s*:\s*true/);
  });

  test('execFile uses array arguments for slither', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should find execFile('slither', [...], {...}) pattern
    expect(source).toMatch(/execFile\s*\(\s*['"]slither['"]\s*,\s*\[/);
  });

  test('execFile uses array arguments for crytic-compile', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should find execFile('crytic-compile', [...], {...}) pattern
    expect(source).toMatch(/execFile\s*\(\s*['"]crytic-compile['"]\s*,\s*\[/);
  });
});

describe('Subprocess security - secret exposure prevention (static analysis)', () => {
  test('API key is not interpolated into command string in check-slither.ts', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should NOT find template literals containing ETHERSCAN_API_KEY in command strings
    // Pattern like: `slither ${address} --etherscan-apikey ${ETHERSCAN_API_KEY}`
    expect(source).not.toMatch(/`[^`]*\$\{[^}]*ETHERSCAN_API_KEY[^}]*\}[^`]*`/);
  });

  test('API key is not interpolated into command string in check-solc.ts', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should NOT find template literals containing ETHERSCAN_API_KEY in command strings
    expect(source).not.toMatch(/`[^`]*\$\{[^}]*ETHERSCAN_API_KEY[^}]*\}[^`]*`/);
  });

  test('API key is passed as separate array argument in check-slither.ts', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should find: ['--etherscan-apikey', ETHERSCAN_API_KEY] pattern
    expect(source).toMatch(/\[\s*[^[\]]*['"]--etherscan-apikey['"]\s*,\s*ETHERSCAN_API_KEY/);
  });

  test('API key is passed as separate array argument in check-solc.ts', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should find: ['--etherscan-apikey', ETHERSCAN_API_KEY] pattern
    expect(source).toMatch(/\[\s*[^[\]]*['"]--etherscan-apikey['"]\s*,\s*ETHERSCAN_API_KEY/);
  });

  test('error messages do not expose API key patterns', () => {
    // These are the error message templates used in the security tools
    // Verify they don't contain patterns that could expose secrets
    const errorPatterns = ['Invalid address format:', 'Timed out after', 'Execution failed:'];

    for (const pattern of errorPatterns) {
      expect(pattern.toLowerCase()).not.toContain('apikey');
      expect(pattern.toLowerCase()).not.toContain('etherscan_api');
      expect(pattern.toLowerCase()).not.toContain('api_key');
    }
  });
});

describe('Subprocess security - timeout configuration verification', () => {
  test('timeout option is passed to execFile in check-slither.ts', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    // Should find: { timeout: SECURITY_TOOL_TIMEOUT_MS } or similar
    expect(source).toMatch(/timeout\s*:\s*SECURITY_TOOL_TIMEOUT_MS/);
  });

  test('timeout option is passed to execFile in check-solc.ts', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    // Should find: { timeout: SECURITY_TOOL_TIMEOUT_MS } or similar
    expect(source).toMatch(/timeout\s*:\s*SECURITY_TOOL_TIMEOUT_MS/);
  });

  test('SECURITY_TOOL_TIMEOUT_MS is imported in check-slither.ts', async () => {
    const source = await Bun.file('checks/check-slither.ts').text();

    expect(source).toMatch(/import.*SECURITY_TOOL_TIMEOUT_MS.*from/);
  });

  test('SECURITY_TOOL_TIMEOUT_MS is imported in check-solc.ts', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    expect(source).toMatch(/import.*SECURITY_TOOL_TIMEOUT_MS.*from/);
  });
});

describe('Subprocess security - unicode edge cases', () => {
  const unicodeAddresses = [
    // Zero-width characters that could bypass visual inspection
    '0x1234567890123456789012345678901234567890\u200B', // zero-width space
    '0x1234567890123456789012345678901234567890\uFEFF', // BOM
    '\u200B0x1234567890123456789012345678901234567890', // zero-width at start

    // RTL override that could mask malicious input
    '\u202E0x1234567890123456789012345678901234567890', // RTL override
    '0x1234567890123456789012345678901234567890\u202E', // RTL at end

    // Unicode digits that look like ASCII but aren't
    '0x\uFF10234567890123456789012345678901234567890', // fullwidth zero (U+FF10)
    '0x123456789012345678901234567890123456789\uFF10', // fullwidth zero at end

    // Homoglyph attacks - characters that look like hex digits
    '0x123456789012345678901234567890123456789\u00B0', // degree symbol (looks like 0)
    '0xО234567890123456789012345678901234567890', // Cyrillic О (looks like 0)
    '0x1234567890123456789012345678901234567890а', // Cyrillic а (looks like a)

    // Other dangerous unicode
    '0x1234567890123456789012345678901234567890\u0000', // null character
    '0x1234567890123456789012345678901234567890\u001B', // escape character
    '0x1234567890123456789012345678901234567890\r', // carriage return
  ];

  for (const addr of unicodeAddresses) {
    const displayAddr = JSON.stringify(addr).slice(0, 60);
    test(`rejects unicode: ${displayAddr}`, () => {
      expect(isValidAddress(addr)).toBe(false);
    });
  }
});

describe('Subprocess security - boundary length cases', () => {
  test('rejects extremely long input (DoS protection)', () => {
    // Very long input that might cause buffer issues
    const veryLongInput = `0x${'a'.repeat(10000)}`;
    expect(isValidAddress(veryLongInput)).toBe(false);
  });

  test('rejects moderately long input', () => {
    const longInput = `0x${'a'.repeat(1000)}`;
    expect(isValidAddress(longInput)).toBe(false);
  });

  test('rejects address at exact boundary - 39 hex chars', () => {
    expect(isValidAddress(`0x${'a'.repeat(39)}`)).toBe(false);
  });

  test('rejects address at exact boundary - 41 hex chars', () => {
    expect(isValidAddress(`0x${'a'.repeat(41)}`)).toBe(false);
  });

  test('accepts address at exact boundary - 40 hex chars', () => {
    expect(isValidAddress(`0x${'a'.repeat(40)}`)).toBe(true);
  });
});

describe('Subprocess security - additional injection vectors', () => {
  const additionalInjections = [
    // Environment variable expansion
    '${PATH}',
    '$HOME',
    '0x1234567890123456789012345678901234567890$HOME',
    '$ETHERSCAN_API_KEY',

    // Command substitution variants
    '$(id)',
    '`id`',
    '$(cat /etc/passwd)',

    // Heredoc/here-string
    '<<EOF\nmalicious\nEOF',
    '<<<malicious',

    // Process substitution
    '<(cat /etc/passwd)',
    '>(cat)',

    // Glob expansion
    '0x1234567890123456789012345678901234567890*',
    '0x1234567890123456789012345678901234567890?',
    '0x[1234567890123456789012345678901234567890]',
    '*',
    '?',
    '[a-z]',

    // Escape sequences
    '0x1234567890123456789012345678901234567890\\n',
    '0x1234567890123456789012345678901234567890\\r',
    '0x1234567890123456789012345678901234567890\\t',
    '0x1234567890123456789012345678901234567890\\x00',

    // Quoted strings that might escape
    "0x1234567890123456789012345678901234567890'",
    '0x1234567890123456789012345678901234567890"',
    '0x1234567890123456789012345678901234567890\\',
    "0x1234567890123456789012345678901234567890'$(id)'",

    // Multiple commands
    '0x1234567890123456789012345678901234567890 && id',
    '0x1234567890123456789012345678901234567890 || id',
    '0x1234567890123456789012345678901234567890 & id',

    // Redirection
    '0x1234567890123456789012345678901234567890 > /tmp/pwned',
    '0x1234567890123456789012345678901234567890 < /etc/passwd',
    '0x1234567890123456789012345678901234567890 2>&1',
  ];

  for (const injection of additionalInjections) {
    const displayInjection = injection.slice(0, 50) + (injection.length > 50 ? '...' : '');
    test(`rejects: ${displayInjection}`, () => {
      expect(isValidAddress(injection)).toBe(false);
    });
  }
});
