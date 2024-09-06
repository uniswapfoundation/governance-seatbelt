/**
 * @notice Sample simulation configuration file for the arb lm distribution proposal.
 */
 import { SimulationConfigNew } from '../types'
 import { Interface } from '@ethersproject/abi'
 import L1BaseCrossChainMessenger from '../utils/abis/L1BaseCrossChainMessenger.json' assert { type: 'json' }
 import L2CrossChainAccount from '../utils/abis/L2CrossChainAccount.json' assert { type: 'json' }
 import v3FactoryAbi from '../utils/abis/v3FactoryAbi.json' assert { type: 'json' }
 import { formatEther, parseUnits } from 'ethers/lib/utils'
 
 // Get interfaces to facilitate encoding the calls we want to execute.
 const BaseInbox = new Interface(L1BaseCrossChainMessenger)
 const baseInboxAddress = '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa'
 
 const l2AccountForwarder = new Interface(L2CrossChainAccount)
 const l2AccountForwarderAddress = '0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9'

 const v3FactoryInterface = new Interface(v3FactoryAbi)
 const v3FactoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'
 
 const timelockAliasAddress = '0x2BAD8182C09F50c8318d769245beA52C32Be46CD'
 
 // get encoded function calls
 const bps2Enable = v3FactoryInterface.encodeFunctionData('enableFeeAmount', [200, 4])
 const bps3Enable = v3FactoryInterface.encodeFunctionData('enableFeeAmount', [300, 6])
 const bps4Enable = v3FactoryInterface.encodeFunctionData('enableFeeAmount', [400, 8])

 console.log({bps2Enable, bps3Enable, bps4Enable})

 const bps2EnableForward = l2AccountForwarder.encodeFunctionData('forward', [v3FactoryAddress, bps2Enable])
 const bps3EnableForward = l2AccountForwarder.encodeFunctionData('forward', [v3FactoryAddress, bps3Enable])
 const bps4EnableForward = l2AccountForwarder.encodeFunctionData('forward', [v3FactoryAddress, bps4Enable])
 
 console.log({bps2EnableForward, bps3EnableForward, bps4EnableForward})

 const calldataTest = BaseInbox.encodeFunctionData('sendMessage', [
     // _target
     l2AccountForwarderAddress,
     // _msg
     bps4EnableForward,
     // _minGasLimit 
     1000000
   ])

console.log({calldataTest})
 // call bps4
 const call1 = {
   target: baseInboxAddress,
   calldata: calldataTest,
   value: 0,
   signature: '',
 }

 console.log({call1})

// call bps3
 const call2 = {
    target: baseInboxAddress,
    calldata: BaseInbox.encodeFunctionData('sendMessage', [
        // _target
        l2AccountForwarderAddress,
        // _msg
        bps3EnableForward,
        // _minGasLimit 
        1000000
        ]),
    value: 0,
    signature: '',
}

// call bps3
 const call3 = {
    target: baseInboxAddress,
    calldata: BaseInbox.encodeFunctionData('sendMessage', [
        // _target
        l2AccountForwarderAddress,
        // _msg
        bps2EnableForward,
        // _minGasLimit 
        1000000
    ]),
    value: 0,
    signature: '',
    }

 const calls = [call1, call2, call3]
 
 export const config: SimulationConfigNew = {
   type: 'new',
   daoName: 'Uniswap',
   governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
   governorType: 'bravo',
   targets: calls.map(item => item.target), // Array of targets to call.
   values: calls.map(item => item.value), // Array of values with each call.
   signatures: calls.map(item => item.signature), // Array of function signatures. Leave empty if generating calldata with ethers like we do here.
   calldatas: calls.map(item => item.calldata), // Array of encoded calldatas.
   description: 'test',
 }
 