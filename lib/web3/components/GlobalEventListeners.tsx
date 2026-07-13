'use client';

import { useEffect, useRef } from 'react';
import { usePublicClient } from 'wagmi';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { useQueryClient } from '@tanstack/react-query';
import { usePrivyWalletSync } from '../hooks/usePrivyWalletSync';

const GAME_CONTRACTS = [
  { address: addresses.games.crash, abi: abis.crash },
  { address: addresses.games.flip, abi: abis.flip },
  { address: addresses.games.rps, abi: abis.rps },
  { address: addresses.games.wheel, abi: abis.wheel },
] as const;

export function GlobalEventListeners() {
  usePrivyWalletSync();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();

  // Debounce timer to batch multiple near-simultaneous events into one refetch
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidate = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries();
    }, 400);
  };

  useEffect(() => {
    if (!publicClient) return;

    const unwatchers: (() => void)[] = [];

    // Router events
    for (const eventName of ['GamePlayed', 'GamePlayedWithCredits', 'GamePlayedDelegated'] as const) {
      try {
        const unwatch = publicClient.watchContractEvent({
          address: addresses.gameRouter,
          abi: abis.router,
          eventName,
          onLogs: invalidate,
          poll: true,
          pollingInterval: 4_000,
        });
        unwatchers.push(unwatch);
      } catch { /* unsupported event */ }
    }

    // Per-game events
    for (const game of GAME_CONTRACTS) {
      for (const eventName of ['BetPlaced', 'BetSettled', 'LivePayout', 'BetRefunded'] as const) {
        try {
          const unwatch = publicClient.watchContractEvent({
            address: game.address,
            abi: game.abi,
            eventName,
            onLogs: invalidate,
            poll: true,
            pollingInterval: 4_000,
          });
          unwatchers.push(unwatch);
        } catch { /* unsupported event */ }
      }
    }

    return () => {
      for (const unwatch of unwatchers) {
        try { unwatch(); } catch { /* cleanup */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient]);

  return null;
}
