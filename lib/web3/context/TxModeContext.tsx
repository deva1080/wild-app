'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useDelegatedPlay } from '../hooks/useDelegatedPlay';

export type TxMode = 'standard' | 'delegated';

const STORAGE_KEY = 'wc_tx_mode';

interface TxModeContextValue {
  mode: TxMode;
  isFastTx: boolean;
  authorizedPlays: bigint | undefined;
  toggleMode: () => Promise<void>;
  setMode: (m: TxMode) => void;
  renewFastTx: () => Promise<void>;
  refetchAuthorized: () => void;
}

const TxModeContext = createContext<TxModeContextValue | null>(null);

export function TxModeProvider({ children }: { children: React.ReactNode }) {
  // Fast TX is the default flow. A returning user's explicit choice is restored
  // from localStorage on mount.
  const [mode, setModeState] = useState<TxMode>('delegated');
  const { authorizedPlays: rawAuthorizedPlays, setupDelegatedPlay, refetchAuthorized } = useDelegatedPlay();
  const authorizedPlays = typeof rawAuthorizedPlays === 'bigint' ? rawAuthorizedPlays : undefined;

  const isFastTx = mode === 'delegated';

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'standard' || stored === 'delegated') setModeState(stored);
  }, []);

  const setMode = useCallback((m: TxMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  const renewFastTx = useCallback(async () => {
    await setupDelegatedPlay(BigInt(100));
  }, [setupDelegatedPlay]);

  const toggleMode = useCallback(async () => {
    if (mode === 'standard') {
      if (authorizedPlays !== undefined && authorizedPlays < 5n) {
        await renewFastTx();
      }
      setMode('delegated');
    } else {
      setMode('standard');
    }
  }, [mode, authorizedPlays, renewFastTx, setMode]);

  return (
    <TxModeContext.Provider
      value={{
        mode,
        isFastTx,
        authorizedPlays,
        toggleMode,
        setMode,
        renewFastTx,
        refetchAuthorized,
      }}
    >
      {children}
    </TxModeContext.Provider>
  );
}

export function useTxMode() {
  const ctx = useContext(TxModeContext);
  if (!ctx) throw new Error('useTxMode must be used within TxModeProvider');
  return ctx;
}
