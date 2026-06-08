'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useBlockNumber } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';

interface TxActivityContextValue {
  /** True while a bet/tx flow is in progress (drives per-block balance polling). */
  isTxActive: boolean;
  /** Mark the start of a tx flow. */
  beginTx: () => void;
  /** Mark the end of a tx flow. Keeps polling briefly to catch late settlement. */
  endTx: () => void;
  /** Force an immediate refresh of all on-chain reads (balances, pending bets, etc.). */
  refreshBalances: () => void;
}

const TxActivityContext = createContext<TxActivityContextValue>({
  isTxActive: false,
  beginTx: () => {},
  endTx: () => {},
  refreshBalances: () => {},
});

// How long to keep polling per-block after a tx flow ends, to absorb RPC lag
// where the new balance/state isn't indexed at the exact settle block.
const COOLDOWN_MS = 8000;

export function TxActivityProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [activeCount, setActiveCount] = useState(0);
  const [coolingDown, setCoolingDown] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watching = activeCount > 0 || coolingDown;

  const refreshBalances = useCallback(() => {
    // Invalidate active wagmi reads so balances and game state update everywhere
    // (header, account page, game pages) at once. Exclude the block-number query
    // to avoid a self-triggering refetch loop while watching.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey?.[0];
        return typeof key === 'string' && key !== 'blockNumber';
      },
    });
  }, [queryClient]);

  const beginTx = useCallback(() => {
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current);
      cooldownTimer.current = null;
    }
    setCoolingDown(false);
    setActiveCount((c) => c + 1);
  }, []);

  const endTx = useCallback(() => {
    setActiveCount((c) => Math.max(0, c - 1));
    setCoolingDown(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => {
      setCoolingDown(false);
      cooldownTimer.current = null;
    }, COOLDOWN_MS);
    // Immediate refresh on completion.
    refreshBalances();
  }, [refreshBalances]);

  // Watch new blocks only while a tx flow is active (or cooling down) to avoid
  // hammering the RPC when idle.
  const { data: blockNumber } = useBlockNumber({ watch: watching });

  useEffect(() => {
    if (!watching || blockNumber === undefined) return;
    refreshBalances();
  }, [blockNumber, watching, refreshBalances]);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  return (
    <TxActivityContext.Provider value={{ isTxActive: watching, beginTx, endTx, refreshBalances }}>
      {children}
    </TxActivityContext.Provider>
  );
}

export function useTxActivity() {
  return useContext(TxActivityContext);
}
