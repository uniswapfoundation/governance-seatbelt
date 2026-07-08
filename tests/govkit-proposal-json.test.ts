import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { parseGovKitProposalJson, readGovKitProposalJson } from '../utils/govkit-proposal-json';
import { SchemaValidationError } from '../utils/validation/zod';

const GOVERNOR_ADDRESS = '0x408ED6354d4973f66138C91495F2f2FCbd8724C3';
const TEST_TARGET = '0x0000000000000000000000000000000000000123';

function validGovKitProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'new',
    daoName: 'Uniswap',
    description: 'GovKit exported proposal',
    governorAddress: GOVERNOR_ADDRESS,
    governorType: 'bravo',
    targets: [TEST_TARGET],
    values: [0],
    signatures: [''],
    calldatas: ['0x'],
    ...overrides,
  };
}

describe('GovKit proposal JSON parser', () => {
  it('reads a GovKit JSON fixture and converts values to bigint', () => {
    const config = readGovKitProposalJson(join(__dirname, 'fixtures', 'govkit-proposal.json'));

    expect(config).toEqual({
      type: 'new',
      daoName: 'Uniswap',
      description: 'GovKit exported proposal fixture',
      governorAddress: GOVERNOR_ADDRESS,
      governorType: 'bravo',
      targets: [
        '0x0000000000000000000000000000000000000123',
        '0x0000000000000000000000000000000000000456',
      ],
      values: [0n, 0n],
      signatures: ['', ''],
      calldatas: ['0x', '0x'],
    });
  });

  it('accepts the current GovKit numeric-zero example', () => {
    const config = parseGovKitProposalJson(
      validGovKitProposal({
        targets: [TEST_TARGET, '0x0000000000000000000000000000000000000456'],
        values: [0, 0],
        signatures: ['', ''],
        calldatas: ['0x', '0x'],
      }),
    );

    expect(config.values).toEqual([0n, 0n]);
  });

  it('rejects unsafe large JSON numbers and requires decimal strings instead', () => {
    const parseUnsafeValue = () =>
      parseGovKitProposalJson(
        validGovKitProposal({
          values: [1000000000000000000],
        }),
      );

    expect(parseUnsafeValue).toThrow(SchemaValidationError);
    expect(parseUnsafeValue).toThrow('large JSON numbers lose precision');
  });

  it('accepts large values as decimal strings', () => {
    const config = parseGovKitProposalJson(
      validGovKitProposal({
        values: ['1000000000000000000'],
      }),
    );

    expect(config.values).toEqual([1000000000000000000n]);
  });

  it('rejects mismatched proposal action arrays', () => {
    expect(() =>
      parseGovKitProposalJson(
        validGovKitProposal({
          values: [0, 0],
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it('rejects invalid addresses', () => {
    expect(() =>
      parseGovKitProposalJson(
        validGovKitProposal({
          targets: ['not-an-address'],
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it('rejects invalid calldata', () => {
    expect(() =>
      parseGovKitProposalJson(
        validGovKitProposal({
          calldatas: ['0xabc'],
        }),
      ),
    ).toThrow(SchemaValidationError);
  });
});
