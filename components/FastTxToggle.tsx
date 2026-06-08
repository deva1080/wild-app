'use client';

import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

/**
 * Marketing-style CTA for Fast TX (delegated play). When active it shows a
 * prominent amber "Turbo" pill; when off it nudges the user to enable it.
 */
export function FastTxToggle({ disabled = false }: { disabled?: boolean }) {
  const { isFastTx, toggleMode, authorizedPlays } = useTxMode();
  const [busy, setBusy] = useState(false);

  const remaining = authorizedPlays !== undefined ? Number(authorizedPlays) : undefined;

  const handleClick = async () => {
    setBusy(true);
    try {
      await toggleMode();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      data-tour="fast-tx"
      title={isFastTx ? 'Fast TX on — play instantly without signing each round' : 'Enable Fast TX to play without signing every round'}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black tracking-wide transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
        isFastTx
          ? 'text-[#1a0e00]'
          : 'text-amber-300 bg-[#161616] border border-amber-400/30 hover:border-amber-400/60'
      }`}
      style={isFastTx ? {
        background: 'linear-gradient(20deg, #debc6e, #8c6825)',
        boxShadow: '0 0 14px rgba(222,188,110,0.35)',
      } : undefined}
    >
      <Zap className={`w-3.5 h-3.5 ${busy ? 'animate-pulse' : ''}`} fill={isFastTx ? '#1a0e00' : 'none'} />
      {isFastTx ? (
        <span className="flex items-center gap-1">
          TURBO
          {remaining !== undefined && (
            <span className="px-1 rounded bg-black/20 text-[10px] tabular-nums">{remaining}</span>
          )}
        </span>
      ) : (
        <span>⚡ Activate Turbo</span>
      )}
    </button>
  );
}
