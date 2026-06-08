'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Address, isAddress } from 'viem';
import { useSearchParams } from 'next/navigation';

const STORAGE_KEY = 'wc_referrer';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

interface ReferralContextValue {
  /** The referrer address to pass to playGame/playGameWithCredits. Zero address if none. */
  referrerAddress: Address;
  /** True if a valid referrer address is stored. */
  hasReferrer: boolean;
  /** Manually set a referrer (e.g. from a UI field). */
  setReferrer: (address: string) => void;
  /** Clear the stored referrer. */
  clearReferrer: () => void;
}

const ReferralContext = createContext<ReferralContextValue>({
  referrerAddress: ZERO_ADDRESS,
  hasReferrer: false,
  setReferrer: () => {},
  clearReferrer: () => {},
});

export function ReferralProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [referrerAddress, setReferrerAddress] = useState<Address>(ZERO_ADDRESS);

  // On mount: read from URL ?ref= param first, then fall back to localStorage
  useEffect(() => {
    const refParam = searchParams.get('ref');
    if (refParam && isAddress(refParam)) {
      localStorage.setItem(STORAGE_KEY, refParam.toLowerCase());
      setReferrerAddress(refParam as Address);
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isAddress(stored)) {
      setReferrerAddress(stored as Address);
    }
  }, [searchParams]);

  const setReferrer = useCallback((address: string) => {
    if (!isAddress(address)) return;
    const normalized = address as Address;
    localStorage.setItem(STORAGE_KEY, normalized.toLowerCase());
    setReferrerAddress(normalized);
  }, []);

  const clearReferrer = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setReferrerAddress(ZERO_ADDRESS);
  }, []);

  return (
    <ReferralContext.Provider
      value={{
        referrerAddress,
        hasReferrer: referrerAddress !== ZERO_ADDRESS,
        setReferrer,
        clearReferrer,
      }}
    >
      {children}
    </ReferralContext.Provider>
  );
}

export function useReferralContext() {
  return useContext(ReferralContext);
}
