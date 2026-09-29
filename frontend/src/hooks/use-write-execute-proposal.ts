import { DEFAULT_GOVERNOR_ADDRESS, GOVERNOR_ABI, wagmiConfig } from '@/config';
import { parseWeb3Error } from '@/lib/errors';
import { buildExecuteArgsFromSimulationData } from '@/lib/write-actions';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useSimulationResults } from './use-simulation-results';

const HIGH_GAS_LIMIT = BigInt(10000000); // 10M gas limit for complex governance operations
const TOAST_ID = 'execute-tx'; // Consistent toast ID for updates

/**
 * Hook for executing a queued proposal
 */
export function useWriteExecuteProposal() {
  const chain = wagmiConfig.chains[0];
  const publicClient = usePublicClient({ chainId: chain.id });
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: simulationData } = useSimulationResults();
  const { writeContractAsync, isPending: isPendingConfirmation } = useWriteContract();

  // Use the same network for submission and receipt links.
  const getExplorerTxUrl = (hash: string) => {
    const baseUrl = chain?.blockExplorers?.default?.url || 'https://etherscan.io';
    return `${baseUrl}/tx/${hash}`;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!publicClient) throw new Error('Public client not found');
      if (!simulationData) throw new Error('Simulation data not found');

      const args = buildExecuteArgsFromSimulationData(simulationData);

      // Clear any existing toasts and show initial state
      toast.dismiss();
      if (walletChainId !== chain.id) {
        toast.loading(`Switch to ${chain.name} in your wallet...`, { id: TOAST_ID });
        await switchChainAsync({ chainId: chain.id });
      }
      toast.loading('Waiting for wallet signature...', { id: TOAST_ID });

      const hash = await writeContractAsync({
        address: DEFAULT_GOVERNOR_ADDRESS,
        chainId: chain.id,
        abi: GOVERNOR_ABI,
        functionName: 'execute',
        args,
        gas: HIGH_GAS_LIMIT,
      });

      // Update toast for transaction confirmation
      toast.loading('Transaction submitted - waiting for confirmation...', {
        id: TOAST_ID,
        description: `Transaction hash: ${hash}`,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Check if transaction was successful
      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted', { cause: receipt });
      }

      return { hash, receipt };
    },
    onSuccess: (data) => {
      const explorerUrl = getExplorerTxUrl(data.hash);
      const explorerName = chain?.blockExplorers?.default?.name || 'Explorer';
      toast.success('Proposal executed successfully!', {
        id: TOAST_ID,
        description: `Transaction confirmed in block ${data.receipt.blockNumber}.`,
        duration: 8000,
        action: {
          label: `View on ${explorerName}`,
          onClick: () => window.open(explorerUrl, '_blank'),
        },
      });
    },
    onError: (error) => {
      toast.error('Transaction failed', {
        id: TOAST_ID,
        description: parseWeb3Error(error as Error),
      });
    },
  });

  return {
    ...mutation,
    isPendingConfirmation,
  };
}
