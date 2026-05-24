'use client';

import { useReadContract, useReadContracts } from 'wagmi';
import type { Abi } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

export interface WheelConfig {
  configId: number;
  multipliers: bigint[];
  weightRanges: bigint[];
  maxMultiplier: bigint;
  gameId: number;
  segmentCount: number;
}

export interface TokenConfig {
  minBet: bigint;
  maxBet: bigint;
}

export function useWheelConfig(configId: number = 0) {
  const { data: configsCount } = useReadContract({
    address: addresses.games.wheel,
    abi: abis.wheel as Abi,
    functionName: 'configsCount',
  });

  const { data: configData, isLoading: isLoadingConfig } = useReadContract({
    address: addresses.games.wheel,
    abi: abis.wheel as Abi,
    functionName: 'gameConfigs',
    args: [configId],
  });

  const { data: tokenInfo, isLoading: isLoadingToken } = useReadContract({
    address: addresses.games.wheel,
    abi: abis.wheel as Abi,
    functionName: 'supportedTokenInfo',
    args: [addresses.wildToken],
  });

  const config: WheelConfig | null = configData ? {
    configId,
    multipliers: (configData as { multipliers: bigint[] }).multipliers,
    weightRanges: (configData as { weightRanges: bigint[] }).weightRanges,
    maxMultiplier: (configData as { maxMultiplier: bigint }).maxMultiplier,
    gameId: Number((configData as { gameId: number }).gameId),
    segmentCount: (configData as { multipliers: bigint[] }).multipliers.length,
  } : null;

  const tokenConfig: TokenConfig | null = tokenInfo ? {
    minBet: (tokenInfo as [bigint, bigint])[0],
    maxBet: (tokenInfo as [bigint, bigint])[1],
  } : null;

  return {
    config,
    tokenConfig,
    configsCount: configsCount ? Number(configsCount) : 0,
    isLoading: isLoadingConfig || isLoadingToken,
  };
}

export function useAllWheelConfigs() {
  const { data: configsCount } = useReadContract({
    address: addresses.games.wheel,
    abi: abis.wheel as Abi,
    functionName: 'configsCount',
  });

  const count = configsCount ? Number(configsCount) : 0;
  
  const configCalls = Array.from({ length: count }, (_, i) => ({
    address: addresses.games.wheel as `0x${string}`,
    abi: abis.wheel as Abi,
    functionName: 'gameConfigs' as const,
    args: [i] as const,
  }));

  const { data: configsData, isLoading } = useReadContracts({
    contracts: configCalls,
  });

  const configs: WheelConfig[] = configsData
    ? configsData
        .filter((r) => r.status === 'success' && r.result)
        .map((r, i) => {
          const data = r.result as { multipliers: bigint[]; weightRanges: bigint[]; maxMultiplier: bigint; gameId: number };
          return {
            configId: i,
            multipliers: data.multipliers,
            weightRanges: data.weightRanges,
            maxMultiplier: data.maxMultiplier,
            gameId: Number(data.gameId),
            segmentCount: data.multipliers.length,
          };
        })
    : [];

  return { configs, isLoading, count };
}
