'use client';

import React from 'react';
import { useAccount } from 'wagmi';
import { WalletButton } from '@/components/WalletButton';

export default function TransactionsPage() {
  const { address } = useAccount();

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-zinc-500">Connect your wallet to view history.</p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-black">Transactions</h1>
      <p className="text-sm text-zinc-500">
        Your recent bet history will appear here once you start playing.
      </p>

      <div className="border border-zinc-200 rounded-xl p-8 text-center bg-zinc-50">
        <p className="text-zinc-400 text-sm">No transactions yet.</p>
        <p className="text-zinc-400 text-xs mt-1">Play a game and results will show up here.</p>
      </div>
    </div>
  );
}