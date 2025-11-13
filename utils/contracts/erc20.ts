import { type Address, erc20Abi, erc20Abi_bytes32, getAddress, getContract } from 'viem';
import { publicClient } from '../clients/client';

const SAI = '0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359';

export function erc20(address: Address) {
  const tokenAddress = getAddress(address);
  const abi = tokenAddress === SAI ? erc20Abi_bytes32 : erc20Abi;
  return getContract({ abi, address: tokenAddress, client: publicClient });
}

export async function fetchTokenMetadata(address: Address) {
  const tokenAddress = getAddress(address);
  const abi = tokenAddress === SAI ? erc20Abi_bytes32 : erc20Abi;
  const contract = { abi, address: tokenAddress } as const;

  const [name, symbol, decimals] = await publicClient.multicall({
    contracts: [
      { ...contract, functionName: 'name' },
      { ...contract, functionName: 'symbol' },
      { ...contract, functionName: 'decimals' },
    ],
  });

  return {
    name: name.result,
    symbol: symbol.result,
    decimals: decimals.result,
  };
}
