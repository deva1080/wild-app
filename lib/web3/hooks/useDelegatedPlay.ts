'use client';

import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { erc20Abi, maxUint256 } from 'viem';

export function useDelegatedPlay() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: authorizedPlays, refetch: refetchAuthorized } = useReadContract({
    address: addresses.gameRouter,
    abi: abis.router,
    functionName: 'authorizedPlays',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  /**
   * Setup delegated play: approve GameRouter for max spending + authorize N plays on-chain.
   */
  const setupDelegatedPlay = async (plays: bigint) => {
    if (!address || !publicClient) throw new Error('Wallet no conectada');

    const allowance = await publicClient.readContract({
      address: addresses.wildToken,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, addresses.gameRouter],
    });

    if (allowance === 0n) {
      await writeContractAsync({
        address: addresses.wildToken,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.gameRouter, maxUint256],
      });
    }

    await writeContractAsync({
      address: addresses.gameRouter,
      abi: abis.router,
      functionName: 'authorizePlays',
      args: [plays],
    });

    await refetchAuthorized();
  };

  /**
   * Revoke all remaining delegated play authorization.
   */
  const revokePlays = async () => {
    if (!address) throw new Error('Wallet no conectada');

    await writeContractAsync({
      address: addresses.gameRouter,
      abi: abis.router,
      functionName: 'revokePlays',
      args: [],
    });

    await refetchAuthorized();
  };

  return {
    authorizedPlays,
    setupDelegatedPlay,
    revokePlays,
    refetchAuthorized,
  };
}
