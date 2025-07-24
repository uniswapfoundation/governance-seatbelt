import { encodeAbiParameters, keccak256, pad, trim } from 'viem';

/**
 * @notice Returns the storage slot for a Solidity mapping with uint keys, given the slot of the mapping itself
 * @dev Read more at https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
 * @param mappingSlot Mapping slot in storage
 * @param key Mapping key to find slot for
 * @returns Storage slot
 */
export function getSolidityStorageSlotUint(
  mappingSlot: `0x${string}`,
  key: bigint | `0x${string}`,
) {
  // this will also work for address types, since address and uints are encoded the same way
  const slot = pad(mappingSlot, { size: 32 });
  return trim(
    keccak256(
      encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [typeof key === 'string' ? BigInt(key) : key, BigInt(slot)],
      ),
    ),
  );
}

export function to32ByteHexString(val: bigint | `0x${string}`) {
  const bigIntVal = typeof val === 'string' ? BigInt(val) : val;
  return pad(`0x${bigIntVal.toString(16)}`) as `0x${string}`;
}
