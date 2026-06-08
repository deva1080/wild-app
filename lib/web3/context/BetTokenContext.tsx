'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { PaymentMethodKey } from '../constants/tokens';

const STORAGE_KEY = 'wc_bet_method';

interface BetTokenContextValue {
  method: PaymentMethodKey;
  setMethod: (m: PaymentMethodKey) => void;
}

const BetTokenContext = createContext<BetTokenContextValue>({
  method: 'WILD',
  setMethod: () => {},
});

function isValidMethod(value: string | null): value is PaymentMethodKey {
  return value === 'WILD' || value === 'USDC' || value === 'CREDITS';
}

export function BetTokenProvider({ children }: { children: React.ReactNode }) {
  const [method, setMethodState] = useState<PaymentMethodKey>('WILD');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidMethod(stored)) setMethodState(stored);
  }, []);

  const setMethod = useCallback((m: PaymentMethodKey) => {
    setMethodState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  return (
    <BetTokenContext.Provider value={{ method, setMethod }}>
      {children}
    </BetTokenContext.Provider>
  );
}

export function useBetTokenContext() {
  return useContext(BetTokenContext);
}
