'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Sparkles } from 'lucide-react';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeKenoChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const MAX_PICKS = 10;
const TOTAL_NUMBERS = 40;
const DRAWN_COUNT = 20;

// Payout table (x100 basis) — mirrors the on-chain payoutTable set via setPayout()
const PAYOUT_TABLE: Record<number, Record<number, number>> = {
  1:  { 1: 192 },
  2:  { 2: 394 },
  3:  { 3: 831 },
  4:  { 3: 100, 4: 1335 },
  5:  { 4: 200, 5: 2760 },
  6:  { 5: 400, 6: 6000 },
  7:  { 5: 100, 6: 800, 7: 9700 },
  8:  { 6: 300, 7: 2000, 8: 10000 },
  9:  { 7: 500, 8: 3000, 9: 49000 },
  10: { 7: 200, 8: 800, 9: 4000, 10: 90000 },
};

function fmtMult(x100: number): string {
  const v = x100 / 100;
  return v >= 1000 ? `${(v / 1000).toFixed(0)}Kx` : `${v % 1 === 0 ? v : v.toFixed(2)}x`;
}

// RTP per pick count, computed exactly via hypergeometric probability against
// the PAYOUT_TABLE above (20 drawn from 40, picks numbers as listed). Varies
// significantly by how many numbers you pick — more picks = lower RTP.
const RTP_BY_PICKS: Record<number, number> = {
  1: 96.0, 2: 96.0, 3: 95.9, 4: 95.7, 5: 94.5,
  6: 92.9, 7: 89.4, 8: 85.4, 9: 84.7, 10: 78.9,
};

function decodeMask(mask: bigint): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < TOTAL_NUMBERS; i++) {
    if ((mask >> BigInt(i)) & 1n) set.add(i + 1);
  }
  return set;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KenoPage() {
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.kenoGame);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.kenoGame);
  const { playClick, playChip, playSfx, playFading } = useGameAudio('keno');
  // Handles for the in-flight result sound(s), so any action taken after a
  // result (quick pick, clear, new bet) cuts them off immediately instead of
  // letting a previous win/loss sound ring out underneath the next action.
  const resultSoundHandlesRef = useRef<{ stop: (fadeMs?: number) => void }[]>([]);
  const cutResultSounds = () => {
    resultSoundHandlesRef.current.forEach((h) => h.stop(0));
    resultSoundHandlesRef.current = [];
  };

  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  // Tile-by-tile reveal sweep (left→right, top→bottom = numbers 1..40 in
  // order) once a bet settles. `revealedCount` tiles are showing their final
  // hit/miss/drawn color; the rest still look idle until their turn.
  const [revealedCount, setRevealedCount] = useState(0);
  const revealStartedRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [animSpeed, setAnimSpeed] = useState<1 | 2 | 3>(1); // 1=slow 120ms/tile, 2=normal 20ms/tile, 3=instant (no sweep)
  const animSpeedRef = useRef<1 | 2 | 3>(1);
  const [showInfoModal, setShowInfoModal] = useState(false);

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

  // Tile-by-tile reveal sweep: numbers 1..40 flip in grid order (left→right,
  // top→bottom), each flip playing the same "card swap" sfx. Only once the
  // sweep finishes does the result sound (defaultResult + themed layer) and
  // the WIN/LOSS block fire — so nothing spoils the result ahead of the grid.
  useEffect(() => {
    if (result.state?.phase === 'result' && !revealStartedRef.current) {
      revealStartedRef.current = true;
      const won = result.state.payout > BigInt(0);

      if (animSpeedRef.current === 3) {
        // Fastest setting skips the sweep entirely — show the result instantly.
        setRevealedCount(TOTAL_NUMBERS);
        const handles = [playFading('defaultResult'), playFading(won ? 'coinRain' : 'card1')]
          .filter((h): h is { stop: (fadeMs?: number) => void } => h !== null);
        resultSoundHandlesRef.current = handles;
      } else {
        setRevealedCount(0);
        const stepMs = animSpeedRef.current === 1 ? 120 : 20;

        let i = 0;
        const tick = () => {
          i += 1;
          setRevealedCount(i);
          playSfx('card2');
          if (i < TOTAL_NUMBERS) {
            revealTimerRef.current = setTimeout(tick, stepMs);
          } else {
            const handles = [playFading('defaultResult'), playFading(won ? 'coinRain' : 'card1')]
              .filter((h): h is { stop: (fadeMs?: number) => void } => h !== null);
            resultSoundHandlesRef.current = handles;
          }
        };
        revealTimerRef.current = setTimeout(tick, stepMs);
      }
    }
    if (!result.state) {
      revealStartedRef.current = false;
      setRevealedCount(0);
      clearTimeout(revealTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.state]);

  useEffect(() => () => clearTimeout(revealTimerRef.current), []);

  const revealDone = isResult && revealedCount >= TOTAL_NUMBERS;

  const togglePick = (n: number) => {
    if (loading || isResult) return;
    playClick();
    cutResultSounds();
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

  const clearPicks = () => {
    playClick();
    cutResultSounds();
    if (result.state !== null) result.close();
    setPicks(new Set());
  };

  const quickPick = (count: number) => {
    playClick();
    cutResultSounds();
    if (result.state !== null) result.close();
    const shuffled = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5)
      .slice(0, count);
    setPicks(new Set(shuffled));
  };

  const handlePlay = async () => {
    if (numPicks === 0) return;
    if (bet.needsApproval) {
      try { await bet.approveSelectedToken(); } catch (e: unknown) { result.error(extractRevertReason(e)); }
      return;
    }
    playClick();
    cutResultSounds();
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
    if (isResult && revealedCount >= n) {
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

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-keno" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        {/* ── Reveal speed toggle ── */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/60 bg-zinc-900/70 p-0.5 ml-2 shrink-0">
          {([1, 2, 3] as const).map((lvl) => {
            const active = animSpeed === lvl;
            return (
              <button
                key={lvl}
                disabled={loading}
                onClick={() => { playClick(); setAnimSpeed(lvl); animSpeedRef.current = lvl; }}
                className={`px-2 py-1 rounded-md text-[11px] font-black tracking-tight transition-all disabled:cursor-not-allowed ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 shadow-[0_0_8px_rgba(200,146,10,0.4)]'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
                title={['Slow', 'Normal', 'Instant'][lvl - 1]}
              >
                {'›'.repeat(lvl)}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-hidden ml-2 border-l border-amber-400/20 pl-4">
          <RecentOutcomes
            gameAddress={addresses.games.kenoGame}
            // This ticker shows BetSettled events from every player on the
            // contract, not just this wallet — so "hits" can never be scored
            // against the *current* `picks` state (that's a different bet by
            // a different player most of the time). It used to do exactly
            // that, which is why the badges visibly changed every time you
            // adjusted your own picks. Each entry is rendered from its own
            // outcome only now, same as the other hard-to-summarize games
            // (slot/modernslot) do.
            renderOutcome={() => (
              <div className="h-6 px-1.5 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 bg-zinc-800 text-zinc-500 border-zinc-700">
                🎰
              </div>
            )}
          />
        </div>
        <GameInfoButton onClick={() => setShowInfoModal(true)} />

        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.kenoGame} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: number grid ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 p-2 sm:p-4 mx-2 sm:mx-4 my-2 sm:my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a] flex flex-col">

        {/* Ambient glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-80 h-48 rounded-full blur-3xl transition-colors duration-700"
            style={{
              background: revealDone && isWin  ? 'rgba(74,222,128,0.06)'
                        : revealDone && isLoss ? 'rgba(248,113,113,0.06)'
                        : 'rgba(200,146,10,0.04)',
            }}
          />
        </div>

        {/* Header row */}
        <div className="relative z-10 flex items-center justify-between px-2 sm:px-5 pt-2 sm:pt-3 pb-1 sm:pb-2 flex-shrink-0">
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
              onClick={clearPicks}
              className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
            >
              NEW GAME
            </button>
          )}
        </div>

        {/* Number grid & Payouts */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-1 sm:px-4 pb-2 sm:pb-4 gap-2 sm:gap-6">
          <div className="grid grid-cols-10 gap-1 sm:gap-1.5 w-full max-w-lg">
            {Array.from({ length: TOTAL_NUMBERS }, (_, i) => {
              const n = i + 1;
              const isPicked = picks.has(n);
              return (
                <button
                  key={n}
                  onClick={() => togglePick(n)}
                  disabled={loading || (!isPicked && numPicks >= MAX_PICKS && !isResult)}
                  className={`aspect-square rounded-lg border text-xs transition-all duration-150 disabled:cursor-not-allowed ${getCellStyle(n)}`}
                  style={{
                    ...(isPicked && !isResult ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined),
                    animation: isResult && revealedCount === n ? 'resultFadeIn 0.25s ease-out both' : undefined,
                  }}
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
                  const isCurrentHit = revealDone && hitCount === hits;
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

          {/* Result — centered, below the multiplier/payout info */}
          {revealDone && (
            <div
              className="absolute left-1/2 top-1/2 z-20 flex max-w-[calc(100%_-_24px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-amber-300/35 bg-black/85 px-5 py-4 text-center shadow-[0_12px_40px_rgba(0,0,0,0.8)] backdrop-blur-md"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              <span
                className="text-2xl font-black"
                style={{ color: resultColor, textShadow: `0 0 20px ${resultGlow}` }}
              >
                {resultLabel} · {hitCount} hit{hitCount !== 1 ? 's' : ''} / {DRAWN_COUNT} drawn
              </span>
              {isWin && resultPayout !== undefined && (
                <span className="text-3xl sm:text-4xl font-black text-green-300 tabular-nums">
                  +{fmtAmt(resultPayout)} {bet.meta.symbol}
                </span>
              )}
              <button
                onClick={clearPicks}
                className="mt-1 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all"
                style={{
                  color: '#debc6e',
                  borderColor: 'rgba(222,188,110,0.45)',
                  background: 'rgba(222,188,110,0.08)',
                  boxShadow: '0 0 12px rgba(222,188,110,0.2)',
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Legend (during result) */}
        {revealDone && (
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
      <div className="flex-shrink-0 p-1.5 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-amber-400/10">

            {/* BET AMOUNT */}
            <div className="p-2.5 sm:p-4 space-y-2 sm:space-y-3 border-r border-amber-400/10 sm:border-r-0">
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
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-2.5 sm:px-3 py-1.5 sm:py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-keno)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={loading} onClick={() => { playChip(); setAmount((v) => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6" /></svg>
                  </button>
                  <button disabled={loading} onClick={() => { playChip(); setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
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
                    <button key={v} disabled={loading} onClick={() => { playChip(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* QUICK PICKS */}
            <div className="p-2.5 sm:p-4 overflow-auto flex flex-col">
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
                      className="py-1 sm:py-1.5 rounded-lg text-xs font-bold border border-zinc-700/60 bg-zinc-800/30 text-zinc-300 hover:border-zinc-500 hover:text-white transition-all disabled:opacity-40"
                    >
                      Pick {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* PLAY */}
            <div className="col-span-2 sm:col-span-1 p-2 sm:p-4 flex items-center justify-center border-t border-amber-400/10 sm:border-t-0">
              <button
                onClick={handlePlay}
                disabled={loading || numPicks === 0 || bet.isApproving || bet.allowanceLoading}
                className="relative w-full h-full min-h-[62px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2 bg-[#0d0d0d]"
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
                  className="font-black text-2xl sm:text-3xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5))',
                  }}
                >
                  {bet.actionLabel('PLAY')}
                </span>
                {numPicks > 0 && (
                  <span className="hidden sm:block text-[10px] text-zinc-500 font-medium">
                    {numPicks} picks · {DRAWN_COUNT} drawn
                  </span>
                )}
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<Sparkles className="w-4 h-4" />}
        title="Keno"
        description={`Keno is a numbers-draw game: choose anywhere from 1 to ${MAX_PICKS} numbers out of a field of ${TOTAL_NUMBERS}, place your bet, and watch as ${DRAWN_COUNT} numbers are drawn at random from that same field. Your payout is determined entirely by how many of your chosen numbers ("hits") land among the ${DRAWN_COUNT} drawn — every pick count has its own independent payout table, so the number of numbers you choose changes both your odds of hitting and the multiplier you're chasing. Unlike most other games on this site, Keno's return-to-player is not flat across all bet configurations: it shifts meaningfully depending on how many numbers you pick, so the choice of pick count is itself a real strategic decision, not just a matter of taste.`}
        steps={[
          `Select between 1 and ${MAX_PICKS} numbers on the board from 1–${TOTAL_NUMBERS}, or let Quick Pick choose a random set for you.`,
          'Set your bet amount using the chip buttons or the input field.',
          `Press Play to lock in your numbers — ${DRAWN_COUNT} numbers are then drawn at random from the full 1–${TOTAL_NUMBERS} field.`,
          'The board reveals which of your picks were hit (drawn), which were missed, and which drawn numbers you did not pick.',
          'Your payout is read off the table for your exact pick count based on how many hits you landed; hit counts below the lowest paying tier for your pick count win nothing.',
        ]}
        sections={[
          {
            title: 'Payout & RTP Table (by Picks → Hits → Multiplier)',
            content: (
              <div className="space-y-2.5">
                {Object.entries(PAYOUT_TABLE).map(([picksStr, hitsTable]) => {
                  const picksNum = Number(picksStr);
                  return (
                    <div key={picksStr} className="flex items-start gap-2 text-xs border-b border-zinc-800/70 pb-1.5 last:border-0 last:pb-0">
                      <span className="text-zinc-400 font-bold w-20 shrink-0">
                        {picksStr} pick{picksStr !== '1' ? 's' : ''}
                        <span className="block text-[10px] text-zinc-500 font-normal">RTP {RTP_BY_PICKS[picksNum]}%</span>
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(hitsTable).map(([hits, mult]) => (
                          <span key={hits} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                            {hits} hit{hits !== '1' ? 's' : ''} <span className="text-amber-300 font-bold">{fmtMult(mult)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ),
          },
          {
            title: 'How RTP Changes With Pick Count',
            content: (
              <div className="text-xs text-zinc-300 space-y-2">
                <p>
                  Picking fewer numbers gives you a tighter, more favorable payout curve: 1–3 picks land at roughly <span className="text-amber-300 font-bold">95.9%–96.0%</span> RTP, about as close to break-even as this game gets. As you pick more numbers the table leans harder on rare, high-multiplier jackpots to balance the math, and the realistic return for an average player drops accordingly — 5 picks sit around <span className="text-amber-300 font-bold">94.5%</span>, 7 picks around <span className="text-amber-300 font-bold">89.4%</span>, and by 10 picks RTP falls all the way to roughly <span className="text-amber-300 font-bold">78.9%</span>.
                </p>
                <p>
                  In short: fewer picks means steadier, closer-to-fair value, while more picks means you are mathematically giving up a larger share of your stake in exchange for a shot at much bigger multipliers (up to 900x at 10 picks / 10 hits). Neither approach is wrong, but the table above makes the trade-off explicit rather than hidden.
                </p>
              </div>
            ),
          },
        ]}
        tip="Lower pick counts (1–4) keep RTP close to 96% with frequent small wins; higher pick counts (8–10) trade most of that value away for a chance at the rare top-tier multipliers — pick based on how much variance you actually want."
        rtp="78.9%–96.0% (varies by picks)"
      />
    </div>
  );
}
