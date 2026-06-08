'use client';

import React, { useEffect, useState } from 'react';
import { useLivePayouts } from '@/lib/web3/hooks/useLivePayouts';
import { addresses } from '@/lib/web3/constants/addresses';

const TOKEN_SYMBOLS: Record<string, string> = {
  [addresses.wildToken.toLowerCase()]: 'WILD',
};

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatPayout(raw: string): string {
  const n = parseFloat(raw);
  if (n >= 1_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

function TimeAgo({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const s = Math.floor((now - timestamp) / 1000);
  const label = s < 5 ? 'now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  return <span>{label}</span>;
}

export function LiveFeed() {
  const { feed } = useLivePayouts();
  const wins = feed.filter((e) => e.payout > 0n);

  return (
    <aside className="border border-amber-400/25 rounded-lg bg-[#1a1a1a] p-2.5 space-y-2 overflow-hidden">
      <div className="flex items-center gap-2 px-1">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <p className="text-[10px] font-bold tracking-widest text-amber-200/80">LIVE WINS</p>
      </div>

      <div className="space-y-1.5 overflow-hidden">
        {wins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-amber-400/25 border-t-amber-400/80 animate-spin" />
            <p className="text-[11px] text-zinc-500 text-center leading-snug">
              Listening for wins…
            </p>
          </div>
        ) : (
          wins.map((entry) => {
            const symbol = TOKEN_SYMBOLS[entry.currency.toLowerCase()] ?? 'TOKEN';
            const amount = formatPayout(entry.payoutFormatted);
            const big = parseFloat(entry.payoutFormatted) >= 50;

            return (
              <div
                key={entry.id}
                className={`text-[11px] bg-[#111111] rounded-md px-2 py-1.5 border transition-colors ${
                  big
                    ? 'border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.08)]'
                    : 'border-amber-500/15'
                }`}
                style={{ animation: 'liveFeedSlideIn 0.3s ease-out' }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-amber-200/70 font-semibold truncate">{entry.gameName}</span>
                  <span className={`font-semibold whitespace-nowrap ${big ? 'text-green-400' : 'text-green-400/80'}`}>
                    +{amount}{' '}
                    <span className="text-[9px] opacity-50">{symbol}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-zinc-500 font-mono text-[10px]">{truncateAddress(entry.player)}</span>
                  <span className="text-zinc-600 text-[10px]">
                    <TimeAgo timestamp={entry.timestamp} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
