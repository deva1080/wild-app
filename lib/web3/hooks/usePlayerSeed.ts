'use client';

import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { Address } from 'viem';
import { abis } from '../constants/abis';

/**
 * Hook for the provably-fair player seed system.
 *
 * Players can set an on-chain seed that gets incorporated into the
 * random number generation, ensuring they can influence (but not
 * predict) outcomes.
 */
export function usePlayerSeed(gameAddress: Address) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: currentSeed, refetch: refetchSeed } = useReadContract({
    address: gameAddress,
    abi: abis.crash,
    functionName: 'playerSeeds',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const setSeed = async (newSeed: bigint) => {
    if (!address) throw new Error('Wallet no conectada');

    const tx = await writeContractAsync({
      address: gameAddress,
      abi: abis.crash,
      functionName: 'setPlayerSeed',
      args: [newSeed],
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
    }

    await refetchSeed();
    return tx;
  };

  return {
    currentSeed: currentSeed as bigint | undefined,
    setSeed,
    refetchSeed,
  };
}
