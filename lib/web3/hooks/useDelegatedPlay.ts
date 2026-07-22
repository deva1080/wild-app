'use client';

import { useAccount, useReadContract } from 'wagmi';
import { useWriteContractBase } from './useWriteContractBase';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

export function useDelegatedPlay() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContractBase();

  const { data: authorizedPlays, refetch: refetchAuthorized } = useReadContract({
    address: addresses.gameRouter,
    abi: abis.router,
    functionName: 'authorizedPlays',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  /** Authorize N delegated plays. Token approval is handled explicitly by the game PLAY button. */
  const setupDelegatedPlay = async (plays: bigint) => {
    if (!address) throw new Error('Wallet no conectada');

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
