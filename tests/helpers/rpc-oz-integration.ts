import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import solc from 'solc';
import {
  http,
  type Abi,
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  zeroAddress,
} from 'viem';
import { mainnet } from 'viem/chains';
import { simulateNew } from '../../utils/clients/tenderly';

/** Real OZ 4.7 contracts, local EVM, production draft/encoding/trace path. Only explorer HTTP is doubled. */
export async function verifyOzDraft() {
  const client = createPublicClient({ chain: mainnet, transport: http(process.env.RPC_URL) });
  const wallet = createWalletClient({ chain: mainnet, transport: http(process.env.RPC_URL) });
  const [account] = await wallet.getAddresses();
  const sources: Record<string, { content: string }> = {
    'Governance.sol': {
      content: `pragma solidity ^0.8.0;
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
contract Token is ERC20Votes {
 constructor() ERC20("Token", "TOK") ERC20Permit("Token") { _mint(msg.sender, 1000000 ether); }
}
contract Governance is Governor, GovernorCountingSimple, GovernorVotes, GovernorTimelockControl {
 constructor(IVotes token, TimelockController timelock) Governor("Integration") GovernorVotes(token) GovernorTimelockControl(timelock) {}
 function votingDelay() public pure override returns(uint256) { return 1; }
 function votingPeriod() public pure override returns(uint256) { return 3; }
 function quorum(uint256) public pure override returns(uint256) { return 0; }
 function state(uint256 id) public view override(Governor, GovernorTimelockControl) returns(ProposalState) { return super.state(id); }
 function supportsInterface(bytes4 id) public view override(Governor, GovernorTimelockControl) returns(bool) { return super.supportsInterface(id); }
 function _execute(uint256 id, address[] memory t, uint256[] memory v, bytes[] memory c, bytes32 d) internal override(Governor, GovernorTimelockControl) { super._execute(id,t,v,c,d); }
 function _cancel(address[] memory t, uint256[] memory v, bytes[] memory c, bytes32 d) internal override(Governor, GovernorTimelockControl) returns(uint256) { return super._cancel(t,v,c,d); }
 function _executor() internal view override(Governor, GovernorTimelockControl) returns(address) { return super._executor(); }
}
contract Target { uint256 public value; function set(uint256 next) external { value = next; } }
`,
    },
  };
  const settings = {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
  };
  const compiled = JSON.parse(
    solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), {
      import: (path: string) => {
        const content = readFileSync(`node_modules/${path}`, 'utf8');
        sources[path] = { content };
        return { contents: content };
      },
    }),
  );
  assert.deepEqual(
    compiled.errors?.filter((e: { severity: string }) => e.severity === 'error') ?? [],
    [],
  );
  const records = new Map<string, { name: string; file: string }>();
  async function deploy(file: string, name: string, args: unknown[] = []): Promise<Address> {
    const contract = compiled.contracts[file][name];
    const receipt = await client.waitForTransactionReceipt({
      hash: await wallet.deployContract({
        account,
        abi: contract.abi as Abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
        args,
      }),
    });
    assert.ok(receipt.contractAddress);
    records.set(receipt.contractAddress.toLowerCase(), { file, name });
    return receipt.contractAddress;
  }
  const token = await deploy('Governance.sol', 'Token');
  const timelockFile = '@openzeppelin/contracts/governance/TimelockController.sol';
  const timelock = await deploy(timelockFile, 'TimelockController', [0n, [], [zeroAddress]]);
  const governor = await deploy('Governance.sol', 'Governance', [token, timelock]);
  const target = await deploy('Governance.sol', 'Target');
  await client.request({ method: 'anvil_mine' as never, params: ['0x80'] as never });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (request, init) => {
    const url = new URL(
      typeof request === 'string' ? request : request instanceof URL ? request : request.url,
    );
    const record = records.get(url.searchParams.get('address')?.toLowerCase() ?? '');
    if (
      url.hostname === 'api.etherscan.io' &&
      record &&
      url.searchParams.get('action') === 'getsourcecode'
    ) {
      return Response.json({
        status: '1',
        result: [
          {
            SourceCode: `{${JSON.stringify({ language: 'Solidity', sources, settings })}}`,
            CompilerVersion: solc.version().split('.Emscripten')[0],
            ContractName: record.name,
            ContractFileName: record.file,
          },
        ],
      });
    }
    return previousFetch(request, init);
  }) as typeof fetch;
  try {
    const config = {
      type: 'new' as const,
      daoName: 'LocalOZ',
      governorType: 'oz' as const,
      governorAddress: governor,
      targets: [target],
      values: [0n],
      signatures: [''],
      calldatas: [
        encodeFunctionData({
          abi: compiled.contracts['Governance.sol'].Target.abi as Abi,
          functionName: 'set',
          args: [42n],
        }),
      ],
      description: 'Set value to 42',
    };
    const result = await simulateNew(config);
    assert.equal(result.sim.provider, 'rpc');
    assert.equal(result.sim.transaction.status, true);
    assert.ok(
      result.sim.transaction.transaction_info.state_diff.some((change) =>
        change.raw.some(
          (raw) => raw.address.toLowerCase() === target.toLowerCase() && BigInt(raw.dirty) === 42n,
        ),
      ),
    );
    const failed = await simulateNew({ ...config, calldatas: ['0xdeadbeef' as Hex] });
    assert.equal(failed.sim.transaction.status, false);
    assert.equal(
      await client.readContract({
        address: target,
        abi: compiled.contracts['Governance.sol'].Target.abi as Abi,
        functionName: 'value',
      }),
      0n,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
}
