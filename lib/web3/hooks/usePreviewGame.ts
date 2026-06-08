'use client';

import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { Address, Hex } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

export interface PreviewResult {
  payout: bigint;
  outcomes: bigint[];
}

export function usePreviewGame() {
  const publicClient = usePublicClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const preview = useCallback(async (
    gameAddress: Address,
    gameChoice: Hex,
    token: Address,
    amount: bigint,
    seed: bigint,
    useCredits = false
  ): Promise<PreviewResult | null> => {
    if (!publicClient) {
      setError('Public client not available');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await publicClient.readContract({
        address: addresses.gameRouter,
        abi: abis.router,
        functionName: 'previewGame',
        args: [gameAddress, gameChoice, token, amount, seed, useCredits],
      });

      const [payout, outcomes] = data as [bigint, bigint[]];
      const previewResult: PreviewResult = { payout, outcomes: [...outcomes] };
      setResult(previewResult);
      return previewResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { preview, result, loading, error, reset };
}
