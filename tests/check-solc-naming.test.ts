import { describe, expect, test } from 'bun:test';

describe('checkSolc naming', () => {
  test('uses async getContractName() helper (not Tenderly-only naming)', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    expect(source).toMatch(
      /import\s+\{[^}]*getContractName[^}]*\}\s+from\s+['"]\.\.\/utils\/clients\/tenderly['"]/,
    );
    expect(source).not.toMatch(/getContractNameFromTenderly/);
    // Ensure checkSolc doesn't label contracts using Tenderly-only `contract_name` fields.
    expect(source).not.toMatch(/contract\.contract_name/);
    expect(source).toMatch(/await\s+getContractName\s*\(/);
  });
});
