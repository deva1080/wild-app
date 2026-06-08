'use client';

import { useAccount, useReadContract } from 'wagmi';
import { Address } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

/**
 * Reads referrer-specific stats from ReferalLogicV1.
 * Useful for showing level, weekly volume, commission rate, and progress.
 */
export function useReferrerStats() {
  const { address } = useAccount();

  const { data: level, refetch: refetchLevel } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'referrerLevel',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: weekVolume, refetch: refetchVolume } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'currentWeekVolume',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: lastEvaluationWeek } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'lastEvaluationWeek',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: maxLevel } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'MAX_LEVEL',
    query: { enabled: true },
  });

  const { data: minLevel } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'MIN_LEVEL',
    query: { enabled: true },
  });

  const { data: bpsDenominator } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'BPS_DENOMINATOR',
    query: { enabled: true },
  });

  const currentLevel = (level as number | undefined) ?? 0;
  const nextLevel = currentLevel + 1;

  const { data: currentLevelBps } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'levelToBps',
    args: [currentLevel],
    query: { enabled: true },
  });

  const { data: nextLevelThreshold } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'levelThreshold',
    args: [nextLevel],
    query: { enabled: typeof maxLevel === 'number' && nextLevel <= (maxLevel as number) },
  });

  const { data: currentLevelThreshold } = useReadContract({
    address: addresses.referalLogicV1 as Address,
    abi: abis.referalLogic,
    functionName: 'levelThreshold',
    args: [currentLevel],
    query: { enabled: currentLevel > 0 },
  });

  // Commission as percentage (e.g. 0.5%)
  const commissionPct =
    currentLevelBps !== undefined && bpsDenominator
      ? (Number(currentLevelBps as bigint) / Number(bpsDenominator as bigint)) * 100
      : 0;

  // Level-up progress as 0-1
  const levelProgress = (() => {
    if (!weekVolume || !nextLevelThreshold) return 0;
    const vol = Number(weekVolume as bigint);
    const threshold = Number(nextLevelThreshold as bigint);
    const prev = currentLevelThreshold ? Number(currentLevelThreshold as bigint) : 0;
    if (threshold <= prev) return 1;
    return Math.min((vol - prev) / (threshold - prev), 1);
  })();

  const refetchAll = () => {
    refetchLevel();
    refetchVolume();
  };

  return {
    level: currentLevel,
    maxLevel: (maxLevel as number | undefined) ?? 5,
    minLevel: (minLevel as number | undefined) ?? 1,
    weekVolumeUSD: weekVolume as bigint | undefined,
    lastEvaluationWeek: lastEvaluationWeek as bigint | undefined,
    commissionPct,
    currentLevelBps: currentLevelBps as bigint | undefined,
    nextLevelThreshold: nextLevelThreshold as bigint | undefined,
    levelProgress,
    refetchAll,
  };
}
