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
