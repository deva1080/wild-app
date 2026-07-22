'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { PaymentMethodKey } from '../constants/tokens';

const STORAGE_KEY = 'wc_bet_method';
const FUN_BALANCE_KEY = 'wc_fun_balance';
const DEFAULT_FUN_BALANCE = 1_000n * 10n ** 18n;

interface BetTokenContextValue {
  method: PaymentMethodKey;
  setMethod: (m: PaymentMethodKey) => void;
  funBalance: bigint;
  settleFunBet: (stake: bigint, payout: bigint) => void;
}

const BetTokenContext = createContext<BetTokenContextValue>({
  method: 'USDC',
  setMethod: () => {},
  funBalance: DEFAULT_FUN_BALANCE,
  settleFunBet: () => {},
});

function isValidMethod(value: string | null): value is PaymentMethodKey {
  return value === 'WILD' || value === 'USDC' || value === 'CREDITS' || value === 'FUN';
}

export function BetTokenProvider({ children }: { children: React.ReactNode }) {
  const [method, setMethodState] = useState<PaymentMethodKey>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isValidMethod(stored) ? stored : 'USDC';
  });
  const [funBalance, setFunBalance] = useState(() => {
    const storedFunBalance = localStorage.getItem(FUN_BALANCE_KEY);
    if (storedFunBalance !== null) {
      try {
        return BigInt(storedFunBalance);
      } catch {
        localStorage.removeItem(FUN_BALANCE_KEY);
      }
    }
    return DEFAULT_FUN_BALANCE;
  });

  const setMethod = useCallback((m: PaymentMethodKey) => {
    setMethodState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  useEffect(() => {
    localStorage.setItem(FUN_BALANCE_KEY, funBalance.toString());
  }, [funBalance]);

  const settleFunBet = useCallback((stake: bigint, payout: bigint) => {
    setFunBalance((current) => current >= stake ? current - stake + payout : current);
  }, []);

  return (
    <BetTokenContext.Provider value={{ method, setMethod, funBalance, settleFunBet }}>
      {children}
    </BetTokenContext.Provider>
  );
}

export function useBetTokenContext() {
  return useContext(BetTokenContext);
}
