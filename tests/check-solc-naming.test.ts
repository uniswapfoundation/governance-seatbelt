import { describe, expect, test } from 'bun:test';

describe('checkSolc naming', () => {
  test('uses async getContractName() helper (not Tenderly-only naming)', async () => {
    const source = await Bun.file('checks/check-solc.ts').text();

    expect(source).toMatch(
      /import\s+\{[^}]*getContractName[^}]*\}\s+from\s+['"]\.\.\/utils\/clients\/tenderly['"]/,
    );
    expect(source).not.toMatch(/getContractNameFromTenderly/);
    expect(source).toMatch(/await\s+getContractName\s*\(/);
  });
});
