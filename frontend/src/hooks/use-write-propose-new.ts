import { DEFAULT_GOVERNOR_ADDRESS, GOVERNOR_ABI } from '@/config';
import { parseWeb3Error } from '@/lib/errors';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { useSimulationResults } from './use-simulation-results';

const HIGH_GAS_LIMIT = BigInt(10000000); // 10M gas limit for complex governance operations
const TOAST_ID = 'proposal-tx'; // Consistent toast ID for updates

/**
 * Hook for creating a new proposal
 */
export function useWriteProposeNew() {
  const publicClient = usePublicClient();
  const { chain } = useAccount();
  const { data: simulationData } = useSimulationResults();
  const { writeContractAsync, isPending: isPendingConfirmation } = useWriteContract();

  // Get block explorer URL from connected chain, fallback to Etherscan
  const getExplorerTxUrl = (hash: string) => {
    const baseUrl = chain?.blockExplorers?.default?.url || 'https://etherscan.io';
    return `${baseUrl}/tx/${hash}`;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!publicClient) throw new Error('Public client not found');
      if (!simulationData) throw new Error('Simulation data not found');

      const { proposalData } = simulationData;

      // Clear any existing toasts and show initial state
      toast.dismiss();
      toast.loading('Waiting for wallet signature...', { id: TOAST_ID });

      const hash = await writeContractAsync({
        address: DEFAULT_GOVERNOR_ADDRESS,
        abi: GOVERNOR_ABI,
        functionName: 'propose',
        args: [
          proposalData.targets,
          proposalData.values.map((value) => BigInt(value)),
          proposalData.signatures,
          proposalData.calldatas,
          proposalData.description,
        ],
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
      toast.success('Proposal created successfully!', {
        id: TOAST_ID,
        description: `Transaction confirmed in block ${data.receipt.blockNumber}.`,
        duration: 8000, // Show success for 8 seconds to give time to click the link
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
