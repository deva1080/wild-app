'use client';

import React from 'react';
import { formatEther, formatUnits } from 'viem';
import { useJackpot } from '@/lib/web3/hooks/useJackpot';

function ProgressBar({ value, active }: { value: number; active?: boolean }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000"
        style={{
          width: `${Math.round(value * 100)}%`,
          background: active
            ? 'linear-gradient(90deg, #debc6e, #f0d080)'
            : 'linear-gradient(90deg, #6b7280, #9ca3af)',
        }}
      />
    </div>
  );
}

function PoolCard({
  label,
  balance,
  maxPayout,
  isActive,
  progress,
  decimals,
  symbol,
}: {
  label: string;
  balance?: bigint;
  maxPayout?: bigint;
  isActive?: boolean;
  progress: number;
  decimals: number;
  symbol: string;
}) {
  const fmt = (v?: bigint) =>
    v !== undefined
      ? Number(decimals === 18 ? formatEther(v) : formatUnits(v, decimals)).toLocaleString('en-US', {
          maximumFractionDigits: 2,
        })
      : '—';

  return (
    <div
      className="flex-1 rounded-xl p-3 flex flex-col gap-2 relative overflow-hidden"
      style={{
        background: '#111111',
        border: isActive
          ? '1px solid rgba(222,188,110,0.3)'
          : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {isActive && (
        <div className="absolute -right-6 -top-6 w-16 h-16 bg-[#debc6e]/10 rounded-full blur-xl" />
      )}
      <div className="flex items-center justify-between relative z-10">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
        {isActive ? (
          <span className="text-[9px] font-black text-[#debc6e] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#debc6e]/10 border border-[#debc6e]/20">
            LIVE
          </span>
        ) : (
          <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider">
            accumulating
          </span>
        )}
      </div>
      <div className="relative z-10">
        <span
          className="text-lg font-black tabular-nums leading-none"
          style={
            isActive
              ? {
                  background: 'linear-gradient(20deg, #debc6e, #f0d080)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }
              : { color: '#71717a' }
          }
        >
          {fmt(balance)}
        </span>
        <span className="text-xs font-bold text-zinc-600 ml-1">{symbol}</span>
      </div>
      {!isActive && (
        <div className="relative z-10 space-y-1">
          <ProgressBar value={progress} active={false} />
          <span className="text-[9px] text-zinc-700">
            {Math.round(progress * 100)}% to activation
          </span>
        </div>
      )}
      {maxPayout !== undefined && isActive && (
        <div className="text-[9px] text-zinc-600 relative z-10">
          Max prize: {fmt(maxPayout)} {symbol}
        </div>
      )}
    </div>
  );
}

export function JackpotWidget() {
  const { wild, usdc } = useJackpot();

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 mb-2">
        <svg
          className="w-3.5 h-3.5 text-[#debc6e]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
          Jackpot
        </span>
      </div>
      <div className="flex gap-2">
        <PoolCard
          label="WILD"
          balance={wild.balance}
          maxPayout={wild.maxPayout}
          isActive={wild.isActive}
          progress={wild.progress}
          decimals={18}
          symbol="WILD"
        />
        <PoolCard
          label="USDC"
          balance={usdc.balance}
          maxPayout={usdc.maxPayout}
          isActive={usdc.isActive}
          progress={usdc.progress}
          decimals={6}
          symbol="USDC"
        />
      </div>
    </div>
  );
}
