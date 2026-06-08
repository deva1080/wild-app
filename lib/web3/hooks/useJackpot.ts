'use client';

import { useReadContract } from 'wagmi';
import { Address } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

/**
 * Reads JackpotVault state for both WILD and USDC pools.
 */
export function useJackpot() {
  const { data: wildBalance, refetch: refetchWild } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'jackpotBalance',
    args: [addresses.wildToken as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'jackpotBalance',
    args: [addresses.usdc as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: wildActive } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'isActive',
    args: [addresses.wildToken as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: usdcActive } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'isActive',
    args: [addresses.usdc as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: wildMaxPayout } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'maxPayout',
    args: [addresses.wildToken as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: usdcMaxPayout } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'maxPayout',
    args: [addresses.usdc as Address],
    query: { refetchInterval: 15_000 },
  });

  const { data: wildMinBalance } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'minJackpotBalance',
    args: [addresses.wildToken as Address],
  });

  const { data: usdcMinBalance } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'minJackpotBalance',
    args: [addresses.usdc as Address],
  });

  const { data: contributionBps } = useReadContract({
    address: addresses.jackpotVault as Address,
    abi: abis.jackpotVault,
    functionName: 'contributionBps',
  });

  // Progress towards activation (0-1)
  const wildProgress = (() => {
    if (!wildBalance || !wildMinBalance) return 0;
    const bal = Number(wildBalance as bigint);
    const min = Number(wildMinBalance as bigint);
    if (min === 0) return 1;
    return Math.min(bal / min, 1);
  })();

  const usdcProgress = (() => {
    if (!usdcBalance || !usdcMinBalance) return 0;
    const bal = Number(usdcBalance as bigint);
    const min = Number(usdcMinBalance as bigint);
    if (min === 0) return 1;
    return Math.min(bal / min, 1);
  })();

  const refetchAll = () => {
    refetchWild();
    refetchUsdc();
  };

  return {
    wild: {
      balance: wildBalance as bigint | undefined,
      isActive: wildActive as boolean | undefined,
      maxPayout: wildMaxPayout as bigint | undefined,
      minBalance: wildMinBalance as bigint | undefined,
      progress: wildProgress,
    },
    usdc: {
      balance: usdcBalance as bigint | undefined,
      isActive: usdcActive as boolean | undefined,
      maxPayout: usdcMaxPayout as bigint | undefined,
      minBalance: usdcMinBalance as bigint | undefined,
      progress: usdcProgress,
    },
    contributionBps: contributionBps as bigint | undefined,
    refetchAll,
  };
}
