'use client';

import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { useWriteContractBase } from './useWriteContractBase';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { Address, erc20Abi, maxUint256 } from 'viem';

export function useDelegatedPlay() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContractBase();

  const { data: authorizedPlays, refetch: refetchAuthorized } = useReadContract({
    address: addresses.gameRouter,
    abi: abis.router,
    functionName: 'authorizedPlays',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  /**
   * Setup delegated play: approve GameRouter for max spending of the bet token
   * (skipped for credits) + authorize N plays on-chain.
   * @param token Token to approve. Pass null when betting with credits (no transfer).
   */
  const setupDelegatedPlay = async (plays: bigint, token: Address | null = addresses.wildToken) => {
    if (!address || !publicClient) throw new Error('Wallet no conectada');

    if (token) {
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, addresses.gameRouter],
      });

      if (allowance === 0n) {
        await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [addresses.gameRouter, maxUint256],
        });
      }
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
