'use client';

import { useWatchContractEvent } from 'wagmi';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { useQueryClient } from '@tanstack/react-query';
import { usePrivyWalletSync } from '../hooks/usePrivyWalletSync';
import { Address } from 'viem';

const allGames: { address: Address; abi: typeof abis.crash }[] = [
  { address: addresses.games.crash, abi: abis.crash },
  { address: addresses.games.flip, abi: abis.flip },
  { address: addresses.games.rps, abi: abis.rps },
  { address: addresses.games.wheel, abi: abis.wheel },
];

function useWatchGameEvents(game: { address: Address; abi: typeof abis.crash }, queryClient: ReturnType<typeof useQueryClient>) {
  useWatchContractEvent({
    address: game.address,
    abi: game.abi,
    eventName: 'BetPlaced',
    onLogs() {
      queryClient.invalidateQueries();
    },
  });

  useWatchContractEvent({
    address: game.address,
    abi: game.abi,
    eventName: 'BetSettled',
    onLogs() {
      queryClient.invalidateQueries();
    },
  });
}

export function GlobalEventListeners() {
  usePrivyWalletSync();
  const queryClient = useQueryClient();

  useWatchContractEvent({
    address: addresses.gameRouter,
    abi: abis.router,
    eventName: 'GamePlayed',
    onLogs() {
      queryClient.invalidateQueries();
    },
  });

  useWatchContractEvent({
    address: addresses.gameRouter,
    abi: abis.router,
    eventName: 'GamePlayedWithCredits',
    onLogs() {
      queryClient.invalidateQueries();
    },
  });

  useWatchContractEvent({
    address: addresses.gameRouter,
    abi: abis.router,
    eventName: 'GamePlayedDelegated',
    onLogs() {
      queryClient.invalidateQueries();
    },
  });

  useWatchGameEvents(allGames[0], queryClient);
  useWatchGameEvents(allGames[1], queryClient);
  useWatchGameEvents(allGames[2], queryClient);
  useWatchGameEvents(allGames[3], queryClient);

  return null;
}