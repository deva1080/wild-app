'use client';

import React, { useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeKenoChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const MAX_PICKS = 10;
const TOTAL_NUMBERS = 40;
const DRAWN_COUNT = 20;

// Payout table (x100 basis) — mirrors contract _initDefaultPayouts
const PAYOUT_TABLE: Record<number, Record<number, number>> = {
  1:  { 1: 268 },
  2:  { 2: 1152 },
  3:  { 2: 192, 3: 4416 },
  4:  { 2: 96, 3: 480, 4: 9600 },
  5:  { 3: 288, 4: 1152, 5: 48000 },
  6:  { 3: 192, 4: 672, 5: 9600, 6: 192000 },
  7:  { 4: 288, 5: 1920, 6: 38400, 7: 672000 },
  8:  { 5: 960, 6: 9600, 7: 192000, 8: 1920000 },
  9:  { 5: 480, 6: 4800, 7: 48000, 8: 480000, 9: 4800000 },
  10: { 5: 192, 6: 1920, 7: 19200, 8: 192000, 9: 1920000, 10: 9600000 },
};

function fmtMult(x100: number): string {
  const v = x100 / 100;
  return v >= 1000 ? `${(v / 1000).toFixed(0)}Kx` : `${v % 1 === 0 ? v : v.toFixed(2)}x`;
}

function decodeMask(mask: bigint): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < TOTAL_NUMBERS; i++) {
    if ((mask >> BigInt(i)) & 1n) set.add(i + 1);
  }
  return set;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KenoPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.kenoGame);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.kenoGame);

  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const numPicks = picks.size;

  const resultPhase    = result.state?.phase ?? 'idle';
  const resultPayout   = result.state?.phase === 'result' ? result.state.payout    : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet  : undefined;

  const isResult = resultPhase === 'result';
  const isError  = resultPhase === 'error';
  const isWin    = isResult && resultPayout !== undefined && resultTotalBet !== undefined && resultPayout > resultTotalBet;
  const isLoss   = isResult && (resultPayout === undefined || resultPayout === BigInt(0));

  const drawMask = isResult
    ? BigInt(result.state?.phase === 'result' ? (result.state.outcomes?.[0] ?? 0) : 0)
    : 0n;
  const drawnNumbers = isResult ? decodeMask(drawMask) : new Set<number>();
  const hitNumbers   = isResult ? new Set([...picks].filter((n) => drawnNumbers.has(n))) : new Set<number>();
  const hitCount     = hitNumbers.size;

  const resultColor = isWin ? '#4ade80' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)';
  const resultLabel = isWin ? 'WIN' : 'LOSS';

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…'  :
    resultPhase === 'waiting-settle' ? 'Confirming…'   :
    resultPhase === 'settling'       ? 'Drawing…'      : '';

  const togglePick = (n: number) => {
    if (loading || isResult) return;
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(n)) {
        next.delete(n);
      } else if (next.size < MAX_PICKS) {
        next.add(n);
      }
      return next;
    });
  };

  const clearPicks = () => setPicks(new Set());

  const quickPick = (count: number) => {
    const shuffled = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5)
      .slice(0, count);
    setPicks(new Set(shuffled));
  };

  const handlePlay = async () => {
    if (!address || numPicks === 0) return;
    if (result.state !== null) {
      result.close();
      return;
    }
    setLoading(true);
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.kenoGame); return; }
      const gameChoice = encodeKenoChoice([...picks], 1);
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Number cell state ─────────────────────────────────────────────────────

  function getCellStyle(n: number): string {
    if (isResult) {
      const isPick  = picks.has(n);
      const isDrawn = drawnNumbers.has(n);
      if (isPick && isDrawn)  return 'bg-amber-400 text-[#1a1205] border-amber-300 scale-105 shadow-[0_0_10px_rgba(222,188,110,0.7)] font-black';
      if (isPick && !isDrawn) return 'bg-red-500/20 text-red-400 border-red-500/40 font-bold';
      if (!isPick && isDrawn) return 'bg-zinc-700 text-zinc-300 border-zinc-600 font-medium';
      return 'bg-transparent text-zinc-700 border-zinc-800/50';
    }
    if (picks.has(n)) {
      return 'border-transparent text-[#1a1205] font-black scale-105';
    }
    return 'bg-zinc-800/40 text-zinc-400 border-zinc-700/60 hover:border-zinc-500 hover:text-zinc-300 font-medium';
  }

  // ── Wallet gate ──────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="grid grid-cols-10 gap-1 opacity-20 select-none pointer-events-none">
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center text-xs text-zinc-400 font-bold">
              {i + 1}
            </div>
          ))}
        </div>
        <h1
          className="text-[42px] font-black uppercase tracking-tight"
          style={{
            background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85))',
          }}
        >
          Keno
        </h1>
        <p className="text-zinc-400 text-center max-w-xs">
          Pick up to 10 numbers from 1–40. Match the 20 drawn balls to win.
        </p>
        <WalletButton />
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-keno" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={loading} />
        <div className="flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes
            gameAddress={addresses.games.kenoGame}
            renderOutcome={(o) => {
              const mask = BigInt(o);
              const drawn = decodeMask(mask);
              const hits = [...picks].filter((n) => drawn.has(n)).length;
              const bg = hits > 0
                ? 'bg-amber-400/10 text-amber-300 border-amber-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700';
              return (
                <div className={`h-6 px-1.5 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 ${bg}`}>
                  {hits > 0 ? `${hits}H` : '—'}
                </div>
              );
            }}
          />
        </div>
        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.kenoGame} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: number grid ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a] flex flex-col">

        {/* Ambient glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-80 h-48 rounded-full blur-3xl transition-colors duration-700"
            style={{
              background: isWin  ? 'rgba(74,222,128,0.06)'
                        : isLoss ? 'rgba(248,113,113,0.06)'
                        : 'rgba(200,146,10,0.04)',
            }}
          />
        </div>

        {/* Header row */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-black uppercase tracking-widest"
              style={{
                background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {numPicks === 0
                ? 'Pick 1–10 numbers'
                : `${numPicks} / ${MAX_PICKS} picked`}
            </span>
            {isResult && (
              <span
                className="text-sm font-black"
                style={{ color: resultColor, textShadow: `0 0 20px ${resultGlow}` }}
              >
                {resultLabel} · {hitCount} hit{hitCount !== 1 ? 's' : ''} / {DRAWN_COUNT} drawn
                {isWin && resultPayout !== undefined && (
                  <span className="ml-2 text-green-300">+{fmtAmt(resultPayout)} {bet.meta.symbol}</span>
                )}
              </span>
            )}
            {loading && spinLabel && (
              <span className="text-amber-300/40 text-xs font-medium animate-pulse tracking-widest uppercase">
                {spinLabel}
              </span>
            )}
          </div>

          {!isResult && (
            <div className="flex gap-2">
              <button
                disabled={loading}
                onClick={clearPicks}
                className="text-[10px] font-bold text-zinc-500 hover:text-red-400 border border-zinc-700 hover:border-red-500/40 rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                CLEAR
              </button>
            </div>
          )}
          {isResult && (
            <button
              onClick={() => { result.close(); clearPicks(); }}
              className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
            >
              NEW GAME
            </button>
          )}
        </div>

        {/* Number grid & Payouts */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-4 gap-6">
          <div className="grid grid-cols-10 gap-1.5 w-full max-w-lg">
            {Array.from({ length: TOTAL_NUMBERS }, (_, i) => {
              const n = i + 1;
              const isPicked = picks.has(n);
              return (
                <button
                  key={n}
                  onClick={() => togglePick(n)}
                  disabled={loading || (!isPicked && numPicks >= MAX_PICKS && !isResult)}
                  className={`aspect-square rounded-lg border text-xs transition-all duration-150 disabled:cursor-not-allowed ${getCellStyle(n)}`}
                  style={isPicked && !isResult ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                >
                  {n}
                </button>
              );
            })}
          </div>

          {/* Payouts */}
          <div className="min-h-[32px] flex items-center justify-center">
            {numPicks > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {Object.entries(PAYOUT_TABLE[numPicks] ?? {}).map(([hitsStr, mult]) => {
                  const hits = Number(hitsStr);
                  const isCurrentHit = isResult && hitCount === hits;
                  return (
                    <div
                      key={hits}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors border ${
                        isCurrentHit
                          ? 'bg-amber-400/20 border-amber-400/50 text-amber-300 shadow-[0_0_10px_rgba(222,188,110,0.2)]'
                          : 'bg-zinc-900/80 border-amber-400/20 text-zinc-400'
                      }`}
                    >
                      <span className="font-medium">{hits} Hits</span>
                      <span className={`font-black ${isCurrentHit ? 'text-amber-300' : 'text-zinc-200'}`}>
                        {fmtMult(mult)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-zinc-600 text-xs uppercase tracking-widest font-medium">Select numbers to see payouts</p>
            )}
          </div>
        </div>

        {/* Legend (during result) */}
        {isResult && (
          <div className="relative z-10 flex items-center justify-center gap-4 pb-3 text-[10px] font-medium text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> Hit
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/40 inline-block" /> Missed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-zinc-700 inline-block" /> Drawn
            </span>
          </div>
        )}

        {/* Error overlay */}
        {isError && result.state?.phase === 'error' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20"
            style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
          >
            <p className="text-red-400 font-bold text-sm">{result.state.message}</p>
            <button onClick={() => result.close()} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-3">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p
                className="text-sm font-black uppercase tracking-widest"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >
                Bet Amount
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-keno)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={loading} onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6" /></svg>
                  </button>
                  <button disabled={loading} onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[...CHIP_VALUES, ...(bet.balanceWei ? ['MAX'] : [])].map((v) => {
                  const val = v === 'MAX' ? bet.maxAmount : v;
                  const active = amount === val;
                  return (
                    <button key={v} disabled={loading} onClick={() => setAmount(val)}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* QUICK PICKS */}
            <div className="p-4 border-x border-amber-400/10 overflow-auto flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <p
                  className="text-sm font-black uppercase tracking-widest"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                  }}
                >
                  Quick Pick
                </p>
              </div>

              <div className="flex-1 flex flex-col justify-center">
                <div className="grid grid-cols-2 gap-1.5">
                  {[1, 3, 5, 7, 8, 10].map((count) => (
                    <button
                      key={count}
                      disabled={loading}
                      onClick={() => quickPick(count)}
                      className="py-1.5 rounded-lg text-xs font-bold border border-zinc-700/60 bg-zinc-800/30 text-zinc-300 hover:border-zinc-500 hover:text-white transition-all disabled:opacity-40"
                    >
                      Pick {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* PLAY */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading || numPicks === 0}
                className="relative w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2 bg-[#0d0d0d]"
                style={{
                  border: '3px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  boxShadow: loading || numPicks === 0
                    ? 'none'
                    : '0 0 24px rgba(222,188,110,0.25), 0 0 60px rgba(222,188,110,0.08), inset 0 0 20px rgba(222,188,110,0.04)',
                }}
              >
                <span
                  className="font-black text-4xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5))',
                  }}
                >
                  PLAY
                </span>
                {numPicks > 0 && (
                  <span className="text-[10px] text-zinc-500 font-medium">
                    {numPicks} picks · {DRAWN_COUNT} drawn
                  </span>
                )}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
