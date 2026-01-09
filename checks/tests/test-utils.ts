import { zeroAddress, zeroHash } from 'viem';
import type { CallTrace, TenderlySimulation } from '../../types';

/**
 * Creates a type-safe mock TenderlySimulation object for testing
 * This replaces the unsafe type casting used in individual test files
 */
export function createMockSimulation(calls: CallTrace[]): TenderlySimulation {
  return {
    transaction: {
      hash: zeroHash,
      block_hash: zeroHash,
      block_number: 18000000,
      from: zeroAddress,
      gas: 21000,
      gas_price: 20000000000,
      gas_fee_cap: 20000000000,
      gas_tip_cap: 1000000000,
      gas_used: 21000,
      cumulative_gas_used: 21000,
      effective_gas_price: 20000000000,
      input: '0x',
      nonce: 0,
      to: zeroAddress,
      index: 0,
      value: '0',
      access_list: null,
      status: true,
      addresses: [],
      contract_ids: [],
      network_id: '1',
      function_selector: '0x',
      timestamp: new Date('2023-01-01T00:00:00Z'),
      method: 'unknown',
      decoded_input: null,
      transaction_info: {
        contract_id: 'mock_contract_id',
        block_number: 18000000,
        transaction_id: zeroHash,
        contract_address: zeroAddress,
        method: 'unknown',
        parameters: null,
        intrinsic_gas: 21000,
        refund_gas: 0,
        call_trace: {
          from: zeroAddress,
          to: zeroAddress,
          input: '0x',
          calls: calls || [],
        },
        stack_trace: null,
        logs: [],
        state_diff: [],
        raw_state_diff: null,
        console_logs: null,
        created_at: new Date('2023-01-01T00:00:00Z'),
        asset_changes: null,
        balance_changes: null,
      },
    },
    simulation: {
      id: 'mock_sim_id',
      project_id: 'mock_project_id',
      owner_id: 'mock_owner_id',
      network_id: '1',
      block_number: 18000000,
      transaction_index: 0,
      from: zeroAddress,
      to: zeroAddress,
      input: '0x',
      gas: 21000,
      gas_price: '20000000000',
      value: '0',
      method: 'unknown',
      status: true,
      access_list: null,
      queue_origin: 'api',
      created_at: new Date('2023-01-01T00:00:00Z'),
    },
    contracts: [],
    generated_access_list: [],
    asset_changes: null,
    balance_changes: null,
  };
}

/**
 * Creates a realistic mock simulation for testing with proper structure
 * Useful for testing complex nested scenarios
 */
export function createRealisticSimulation(calls: CallTrace[]): TenderlySimulation {
  return createMockSimulation(calls);
}
