'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useDelegatedPlay } from '../hooks/useDelegatedPlay';

export type TxMode = 'standard' | 'delegated';

interface TxModeContextValue {
  mode: TxMode;
  isFastTx: boolean;
  authorizedPlays: bigint | undefined;
  toggleMode: () => void;
  setMode: (m: TxMode) => void;
  renewFastTx: () => Promise<void>;
  refetchAuthorized: () => void;
}

const TxModeContext = createContext<TxModeContextValue | null>(null);

export function TxModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<TxMode>('standard');
  const { authorizedPlays: rawAuthorizedPlays, setupDelegatedPlay, refetchAuthorized } = useDelegatedPlay();
  const authorizedPlays = typeof rawAuthorizedPlays === 'bigint' ? rawAuthorizedPlays : undefined;

  const isFastTx = mode === 'delegated';

  const toggleMode = useCallback(() => {
    setModeState((prev) => (prev === 'standard' ? 'delegated' : 'standard'));
  }, []);

  const setMode = useCallback((m: TxMode) => {
    setModeState(m);
  }, []);

  const renewFastTx = useCallback(async () => {
    await setupDelegatedPlay(BigInt(100));
  }, [setupDelegatedPlay]);

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
