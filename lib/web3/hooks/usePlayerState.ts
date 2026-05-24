'use client';

import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { Address } from 'viem';

export function usePlayerState(gameAddress?: Address) {
  const { address } = useAccount();

  // Global Balances
  const { data: wildBalance, refetch: refetchWild } = useReadContract({
    address: addresses.wildToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: creditsBalance, refetch: refetchCredits } = useReadContract({
    address: addresses.gameCredits,
    abi: abis.credits,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Game-specific stats (if gameAddress is provided)
  const { data: playerInfo, refetch: refetchInfo } = useReadContract({
    address: gameAddress,
    abi: abis.crash, // BaseGame ABI works for these read functions
    functionName: 'getPlayerInfo',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress },
  });

  const { data: pendingBetId, refetch: refetchPending } = useReadContract({
    address: gameAddress,
    abi: abis.crash,
    functionName: 'pendingBetId',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress },
  });

  const { data: lastBetsData, refetch: refetchLastBets } = useReadContract({
    address: gameAddress,
    abi: abis.crash,
    functionName: 'lastBets',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress },
  });

  const refetchAll = () => {
    refetchWild();
    refetchCredits();
    if (gameAddress) {
      refetchInfo();
      refetchPending();
      refetchLastBets();
    }
  };

  return {
    address,
    wildBalance,
    creditsBalance,
    playerInfo,
    pendingBetId,
    lastBetsData,
    refetchAll,
  };
}