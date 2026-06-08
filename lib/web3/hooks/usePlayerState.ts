'use client';

import { useAccount, useReadContract, useBalance } from 'wagmi';
import { erc20Abi } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { Address } from 'viem';
import { PaymentMethodKey } from '../constants/tokens';

export function usePlayerState(gameAddress?: Address) {
  const { address } = useAccount();

  // Native ETH balance (gas) on Base
  const { data: ethBalanceData, refetch: refetchEth } = useBalance({
    address,
    query: { enabled: !!address, refetchOnMount: true, refetchOnWindowFocus: true },
  });
  const ethBalance = ethBalanceData?.value;

  // Global Balances
  const { data: wildBalance, refetch: refetchWild } = useReadContract({
    address: addresses.wildToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: addresses.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  const { data: creditsBalance, refetch: refetchCredits } = useReadContract({
    address: addresses.gameCredits,
    abi: abis.credits,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  // Game-specific stats (if gameAddress is provided)
  const { data: playerInfo, refetch: refetchInfo } = useReadContract({
    address: gameAddress,
    abi: abis.crash, // BaseGame ABI works for these read functions
    functionName: 'getPlayerInfo',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  const { data: pendingBetId, refetch: refetchPending } = useReadContract({
    address: gameAddress,
    abi: abis.crash,
    functionName: 'pendingBetId',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  const { data: lastBetsData, refetch: refetchLastBets } = useReadContract({
    address: gameAddress,
    abi: abis.crash,
    functionName: 'lastBets',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!gameAddress, refetchOnMount: true, refetchOnWindowFocus: true },
  });

  const refetchAll = () => {
    refetchEth();
    refetchWild();
    refetchUsdc();
    refetchCredits();
    if (gameAddress) {
      refetchInfo();
      refetchPending();
      refetchLastBets();
    }
  };

  /** Balance (bigint | undefined) backing a given payment method. */
  const balanceForMethod = (method: PaymentMethodKey): bigint | undefined => {
    if (method === 'USDC') return usdcBalance as bigint | undefined;
    if (method === 'CREDITS') return creditsBalance as bigint | undefined;
    return wildBalance as bigint | undefined;
  };

  return {
    address,
    ethBalance,
    wildBalance,
    usdcBalance,
    creditsBalance,
    playerInfo,
    pendingBetId,
    lastBetsData,
    balanceForMethod,
    refetchAll,
  };
}