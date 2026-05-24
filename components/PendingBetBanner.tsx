'use client';

import React, { useState } from 'react';
import { Address } from 'viem';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';

interface Props {
  gameAddress: Address;
  betId: bigint;
  onSettled: () => void;
}

export function PendingBetBanner({ gameAddress, betId, onSettled }: Props) {
  const { settlePendingBet } = useGamePlay();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSettle = async () => {
    setLoading(true);
    setError(null);
    try {
      await settlePendingBet(gameAddress);
      onSettled();
    } catch (e: unknown) {
      setError(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-amber-400 text-lg leading-none mt-0.5">⚠</span>
        <div>
          <p className="text-sm font-semibold text-amber-200">Pending unsettled bet</p>
          <p className="text-xs text-amber-300/70 mt-0.5">
            Bet ID <span className="font-mono font-bold">{betId.toString()}</span> is stuck.
            Settle it before playing again.
          </p>
        </div>
      </div>

      <button
        onClick={handleSettle}
        disabled={loading}
        className="w-full py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold rounded-lg transition-colors"
      >
        {loading ? 'Settling...' : 'Settle Pending Bet'}
      </button>

      {error && (
        <p className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2">{error}</p>
      )}
    </div>
  );
}
