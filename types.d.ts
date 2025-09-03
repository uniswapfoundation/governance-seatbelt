import type { Address, Block, Hex } from 'viem';
import type { ChainConfig } from './utils/clients/client';

// --- Call Trace Types ---
export interface CallTrace {
  from: string;
  to?: string;
  input: string;
  calls?: CallTrace[];
  type?: string;
  value?: string;
  error_reason?: string;
}

// Specific call type for calldata decoding with additional properties
export interface DecodedCall {
  from: string;
  to: string;
  input: string;
  value: string;
  calls?: DecodedCall[];
  function_name?: string;
  decoded_input?: Array<{
    soltype: { name: string; type: string };
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic decoded values can be any type
    value: any;
  }>;
  decoded_output?: Array<{
    soltype: { name: string; type: string };
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic decoded values can be any type
    value: any;
  }>;
}

// --- Simulation configurations ---
// TODO Consider refactoring to an enum instead of string.
export type GovernorType = 'oz' | 'bravo';

interface SimulationConfigBase {
  type: 'executed' | 'proposed' | 'new';
  daoName: string; // e.g. 'Compound' or 'Uniswap'
  governorAddress: Address; // address of the governor
  governorType: GovernorType;
}

export interface SimulationConfigExecuted extends SimulationConfigBase {
  type: 'executed';
  proposalId: BigNumberish; // ID of the executed proposal
}

export interface SimulationConfigProposed extends SimulationConfigBase {
  type: 'proposed';
  proposalId: BigNumberish; // ID of the executed proposal
}

export interface SimulationConfigNew extends SimulationConfigBase {
  type: 'new';
  targets: Address[];
  values: bigint[];
  signatures: `0x${string}`[];
  calldatas: `0x${string}`[];
  description: string;
}

export type SimulationConfig =
  | SimulationConfigExecuted
  | SimulationConfigProposed
  | SimulationConfigNew;

export type SimulationBlock = Pick<Block, 'number' | 'timestamp'>;

export interface SimulationBlocks {
  current: SimulationBlock;
  start: SimulationBlock | null;
  end: SimulationBlock | null;
}

export interface SimulationResult {
  sim: TenderlySimulation;
  proposal: ProposalEvent;
  deps: ProposalData;
  latestBlock: SimulationBlock;
  executor?: string; // Who executed the proposal (for executed proposals)
  proposalCreatedBlock?: SimulationBlock; // Block when proposal was created
  proposalExecutedBlock?: SimulationBlock; // Block when proposal was executed (for executed proposals)
  destinationSimulations?: Array<{
    chainId: number;
    bridgeType: string; // e.g., 'ArbitrumL1L2'
    status: 'success' | 'failure';
    error?: string; // Optional error message on failure
    sim?: TenderlySimulation; // Tenderly result for the destination sim
    l2Params?: ExtractedCrossChainMessage;
  }>;
  crossChainFailure?: boolean;
}

export interface SimulationData extends SimulationResult {
  config: SimulationConfig;
}

// TODO If adding support for a third governor, instead of hardcoding optional governor-specific
// fields, make this a union type of each governor's individual proposal type.
export interface ProposalStruct {
  id: bigint;
  proposer?: string;
  eta: bigint;
  startBlock?: bigint; // Compound governor
  startTime?: bigint; // OZ governor
  endBlock?: bigint; // Compound governor
  endTime?: bigint; // OZ governor
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  canceled: boolean;
  executed: boolean;
}

export interface ProposalEvent {
  id: bigint;
  proposalId: bigint;
  proposer: string;
  startBlock: bigint;
  endBlock: bigint;
  description: string;
  targets: string[];
  values: bigint[];
  signatures: string[];
  calldatas: string[];
}

export type Message = string;

export type CheckResult = {
  info: Message[];
  warnings: Message[];
  errors: Message[];
};

export interface ProposalData {
  // biome-ignore lint/suspicious/noExplicitAny: TODO: Properly type governor
  governor: any;
  // biome-ignore lint/suspicious/noExplicitAny: TODO: Properly type timelock
  timelock: any;
  // biome-ignore lint/suspicious/noExplicitAny: TODO: Properly type publicClient
  publicClient: any;
  chainConfig: ChainConfig;
  targets: string[];
  touchedContracts: string[];
}

export interface ProposalCheck {
  name: string;
  checkProposal(
    proposal: ProposalEvent,
    tx: TenderlySimulation,
    deps: ProposalData,
    l2Simulations?: {
      chainId: number;
      sim: TenderlySimulation;
    }[],
  ): Promise<CheckResult>;
}

export interface AllCheckResults {
  [checkId: string]: { name: string; result: CheckResult };
}

// --- Extracted Cross-Chain Message Type ---
export type BridgeType = 'ArbitrumL1L2' | 'OptimismL1L2';

/**
 * @notice Holds the parameters extracted from a source chain simulation
 * that are necessary to initiate a simulation on a destination chain via a bridge.
 */
export interface ExtractedCrossChainMessage {
  /** @notice Identifier for the type of bridge/messaging protocol used (e.g., 'ArbitrumL1L2'). */
  bridgeType: BridgeType;
  /** @notice The chain ID of the destination network. */
  destinationChainId: string;
  /** @notice The target contract address to be called on the destination chain. */
  l2TargetAddress: Address;
  /** @notice The encoded calldata to be used in the transaction on the destination chain. */
  l2InputData: Hex;
  /** @notice The native token value (as a string) to be sent with the transaction on the destination chain. */
  l2Value: string;
  /** @notice The address initiating the transaction on the destination chain (often a bridge contract or alias). Optional. */
  l2FromAddress?: Address;
}

// --- Tenderly types, Request ---
// Response from tenderly endpoint that encodes state data
export type StorageEncodingResponse = {
  stateOverrides: {
    // these keys are the contract addresses, all lower case
    [key: string]: {
      value: {
        // these are the slot numbers, as 32 byte hex strings
        [key: string]: string;
      };
    };
  };
};

type StateObject = {
  balance?: string;
  code?: string;
  storage?: Record<string, string>;
};

type ContractObject = {
  contractName: string;
  source: string;
  sourcePath: string;
  compiler: {
    name: 'solc';
    version: string;
  };
  networks: Record<
    string,
    {
      events?: Record<string, string>;
      links?: Record<string, string>;
      address: string;
      transactionHash?: string;
    }
  >;
};

export type TenderlyPayload = {
  network_id: '1' | '3' | '4' | '5' | '42' | '42161';
  block_number?: number;
  transaction_index?: number;
  from: string;
  to: string;
  input: string;
  gas: number;
  gas_price?: string;
  value?: string;
  simulation_type?: 'full' | 'quick';
  save?: boolean;
  save_if_fails?: boolean;
  state_objects?: Record<string, StateObject>;
  contracts?: ContractObject[];
  block_header?: {
    number?: string;
    timestamp?: string;
  };
  generate_access_list?: boolean;
};

// --- Tenderly types, Response ---
// NOTE: These type definitions were autogenerated using https://app.quicktype.io/, so are almost
// certainly not entirely accurate (and they have some interesting type names)

export interface TenderlySimulation {
  transaction: Transaction;
  simulation: Simulation;
  contracts: TenderlyContract[];
  generated_access_list: GeneratedAccessList[];
  asset_changes?: AssetChange[] | null;
  balance_changes?: BalanceChange[] | null;
}

interface AssetChange {
  token_info: {
    standard: string;
    type: 'Native' | string;
    symbol: string;
    name: string;
    logo: string;
    decimals: number;
    dollar_value: string;
  };
  type: string;
  from: string;
  to: string;
  amount: string;
  raw_amount: string;
  dollar_value: string;
}

interface BalanceChange {
  address: string;
  dollar_value: string;
  transfers: number[];
}

interface TenderlyContract {
  id: string;
  contract_id: string;
  balance: string;
  network_id: string;
  public: boolean;
  verified_by: string;
  verification_date: null;
  address: string;
  contract_name: string;
  ens_domain: null;
  type: string;
  evm_version: string;
  compiler_version: string;
  optimizations_used: boolean;
  optimization_runs: number;
  libraries: null;
  data: Data;
  creation_block: number;
  creation_tx: string;
  creator_address: string;
  created_at: Date;
  number_of_watches: null;
  language: string;
  in_project: boolean;
  number_of_files: number;
  standard?: string;
  standards?: string[];
  token_data?: TokenData;
}

interface Data {
  main_contract: number;
  contract_info: ContractInfo[];
  abi: ABI[];
  raw_abi: null;
}

interface ABI {
  type: ABIType;
  name: string;
  constant: boolean;
  anonymous: boolean;
  inputs: SoltypeElement[];
  outputs: Output[] | null;
}

interface SoltypeElement {
  name: string;
  type: SoltypeType;
  storage_location: StorageLocation;
  components: SoltypeElement[] | null;
  offset: number;
  index: string;
  indexed: boolean;
  simple_type?: Type;
}

interface Type {
  type: SimpleTypeType;
}

enum SimpleTypeType {
  Address = 'address',
  Bool = 'bool',
  Bytes = 'bytes',
  Slice = 'slice',
  String = 'string',
  Uint = 'uint',
}

enum StorageLocation {
  Calldata = 'calldata',
  Default = 'default',
  Memory = 'memory',
  Storage = 'storage',
}

enum SoltypeType {
  Address = 'address',
  Bool = 'bool',
  Bytes32 = 'bytes32',
  MappingAddressUint256 = 'mapping (address => uint256)',
  MappingUint256Uint256 = 'mapping (uint256 => uint256)',
  String = 'string',
  Tuple = 'tuple',
  TypeAddress = 'address[]',
  TypeTuple = 'tuple[]',
  Uint16 = 'uint16',
  Uint256 = 'uint256',
  Uint48 = 'uint48',
  Uint56 = 'uint56',
  Uint8 = 'uint8',
}

interface Output {
  name: string;
  type: SoltypeType;
  storage_location: StorageLocation;
  components: SoltypeElement[] | null;
  offset: number;
  index: string;
  indexed: boolean;
  simple_type?: SimpleType;
}

interface SimpleType {
  type: SimpleTypeType;
  nested_type?: Type;
}

enum ABIType {
  Constructor = 'constructor',
  Event = 'event',
  Function = 'function',
}

interface ContractInfo {
  id: number;
  path: string;
  name: string;
  source: string;
}

interface TokenData {
  symbol: string;
  name: string;
  decimals: number;
}

interface GeneratedAccessList {
  address: string;
  storage_keys: string[];
}

interface Simulation {
  id: string;
  project_id: string;
  owner_id: string;
  network_id: string;
  block_number: number;
  transaction_index: number;
  from: string;
  to: string;
  input: string;
  gas: number;
  gas_price: string;
  value: string;
  method: string;
  status: boolean;
  access_list: null;
  queue_origin: string;
  created_at: Date;
}

interface Transaction {
  hash: From;
  block_hash: string;
  block_number: number;
  from: From;
  gas: number;
  gas_price: number;
  gas_fee_cap: number;
  gas_tip_cap: number;
  cumulative_gas_used: number;
  gas_used: number;
  effective_gas_price: number;
  input: string;
  nonce: number;
  to: Address;
  index: number;
  value: string;
  access_list: null;
  status: boolean;
  addresses: string[];
  contract_ids: string[];
  network_id: string;
  function_selector: string;
  transaction_info: TransactionInfo;
  timestamp: Date;
  method: string;
  decoded_input: null;
}

interface TransactionInfo {
  contract_id: string;
  block_number: number;
  transaction_id: From;
  contract_address: From;
  method: string;
  parameters: null;
  intrinsic_gas: number;
  refund_gas: number;
  call_trace: CallTrace;
  stack_trace: null | StackTrace[];
  logs: Log[] | null;
  state_diff: StateDiff[];
  raw_state_diff: null;
  console_logs: null;
  created_at: Date;
  asset_changes: AssetChange[] | null;
  balance_changes: BalanceChange[] | null;
}

interface StackTrace {
  file_index: number;
  contract: string;
  name: string;
  line: number;
  error: string;
  error_reason: string;
  code: string;
  op: string;
  length: number;
}

interface Input {
  soltype: SoltypeElement | null;
  value: boolean | string;
}

interface Log {
  name: string | null;
  anonymous: boolean;
  inputs: Input[];
  raw: LogRaw;
}

interface LogRaw {
  address: string;
  topics: string[];
  data: string;
}

interface StateDiff {
  soltype: SoltypeElement | null;
  original: string | Record<string, string>;
  dirty: string | Record<string, string>;
  raw: RawElement[];
}

interface RawElement {
  address: string;
  key: string;
  original: string;
  dirty: string;
}

/**
 * Structured simulation report types
 */
export interface SimulationCheck {
  title: string;
  status: 'passed' | 'warning' | 'failed';
  details?: string;
  info?: string[];
  infoItems?: Array<{
    label: string;
    value: string;
    isCode?: boolean;
    isLink?: boolean;
    href?: string;
  }>;
}

export interface SimulationStateChange {
  contract: string;
  contractAddress?: string;
  key: string;
  oldValue: string;
  newValue: string;
}

export interface SimulationEvent {
  name: string;
  contract: string;
  contractAddress?: string;
  params: Array<{
    name: string;
    value: string;
    type: string;
  }>;
}

export interface SimulationCalldata {
  decoded: string;
  raw: string;
  links?: Array<{
    text: string;
    address: string;
    href: string;
  }>;
}

export interface StructuredSimulationReport {
  title: string;
  proposalText: string;
  status: 'success' | 'warning' | 'error';
  summary: string;
  checks: SimulationCheck[];
  stateChanges: SimulationStateChange[];
  events: SimulationEvent[];
  calldata?: SimulationCalldata;
  metadata: {
    proposalId: string;
    proposer: string;
    proposerIsPlaceholder?: boolean;
    governorAddress: string;
    executor?: string;
    simulationBlockNumber: string;
    simulationTimestamp: string;
    proposalCreatedAtBlockNumber: string;
    proposalCreatedAtTimestamp: string;
    proposalExecutedAtBlockNumber?: string;
    proposalExecutedAtTimestamp?: string;
  };
}

export interface GenerateReportsParams {
  governorType: GovernorType;
  blocks: SimulationBlocks;
  proposal: ProposalEvent;
  checks: AllCheckResults;
  outputDir: string;
  governorAddress: string;
  destinationSimulations?: SimulationResult['destinationSimulations'];
  destinationChecks?: Record<number, AllCheckResults>;
  executor?: string;
  proposalCreatedBlock?: SimulationBlock;
  proposalExecutedBlock?: SimulationBlock;
}

export interface WriteSimulationResultsJsonParams {
  governorType: GovernorType;
  blocks: SimulationBlocks;
  proposal: ProposalEvent;
  checks: AllCheckResults;
  markdownReport: string;
  governorAddress: string;
  outputPath: string;
  destinationSimulations?: SimulationResult['destinationSimulations'];
  executor?: string;
  proposalCreatedBlock?: SimulationBlock;
  proposalExecutedBlock?: SimulationBlock;
}

export interface FrontendData {
  proposalData: {
    id: string;
    targets: `0x${string}`[];
    values: bigint[] | string[];
    signatures: string[];
    calldatas: `0x${string}`[];
    description: string;
  };
  report: {
    status: 'success' | 'warning' | 'error';
    summary: string;
    markdownReport: string;
    structuredReport?: StructuredSimulationReport;
  };
}
