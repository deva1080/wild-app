'use client';

import React from 'react';
import { Address } from 'viem';
import { useRecentOutcomes } from '@/lib/web3/hooks/useRecentOutcomes';

export function RecentOutcomes({ 
  gameAddress, 
  renderOutcome 
}: { 
  gameAddress: Address;
  renderOutcome: (outcome: number, index: number) => React.ReactNode;
}) {
  const outcomes = useRecentOutcomes(gameAddress);

  if (outcomes.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1">
      <div className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase shrink-0">
        Recent
      </div>
      {outcomes.map((o, i) => (
        <div key={`${i}-${o}`} className="shrink-0 flex items-center justify-center">
          {renderOutcome(o, i)}
        </div>
      ))}
    </div>
  );
}
