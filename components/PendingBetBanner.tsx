'use client';

import React, { useState } from 'react';
import { Address } from 'viem';
import { usePublicClient, useAccount } from 'wagmi';
import { useWriteContractBase } from '@/lib/web3/hooks/useWriteContractBase';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { abis } from '@/lib/web3/constants/abis';

interface Props {
  gameAddress: Address;
  betId: bigint;
  onSettled: () => void;
}

export function PendingBetBanner({ gameAddress, betId, onSettled }: Props) {
  const { settlePendingBet } = useGamePlay();
  const { writeContractAsync } = useWriteContractBase();
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [refunding, setRefunding] = useState(false);
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

  const handleRefund = async () => {
    if (!address || !publicClient) return;
    setRefunding(true);
    setError(null);
    try {
      const tx = await writeContractAsync({
        address: gameAddress,
        abi: abis.crash,
        functionName: 'refundBet',
        args: [betId],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 });
      onSettled();
    } catch (e: unknown) {
      setError(extractRevertReason(e));
    } finally {
      setRefunding(false);
    }
  };

  const busy = loading || refunding;

  return (
    <div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-amber-400 text-lg leading-none mt-0.5">&#x26A0;</span>
        <div>
          <p className="text-sm font-semibold text-amber-200">Pending unsettled bet</p>
          <p className="text-xs text-amber-300/70 mt-0.5">
            Bet ID <span className="font-mono font-bold">{betId.toString()}</span> is stuck.
            Settle it before playing again.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSettle}
          disabled={busy}
          className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold rounded-lg transition-colors"
        >
          {loading ? 'Settling...' : 'Settle Bet'}
        </button>
        <button
          onClick={handleRefund}
          disabled={busy}
          className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 text-sm font-bold rounded-lg transition-colors border border-zinc-600"
        >
          {refunding ? 'Refunding...' : 'Refund Bet'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2">{error}</p>
      )}
    </div>
  );
}
