'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Info } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeSlotChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHIP_VALUES = ['1', '5', '10', '50', '100'];

// Symbols: 0=Cherry 1=Lemon 2=Orange 3=Grape 4=Bell 5=Diamond
const SYMBOLS = [
  { label: '🍒', name: 'Cherry',  mult: 1,    color: '#ef4444' },
  { label: '🍋', name: 'Lemon',   mult: 2,    color: '#eab308' },
  { label: '🍊', name: 'Orange',  mult: 5,    color: '#f97316' },
  { label: '🍇', name: 'Grape',   mult: 20,   color: '#a855f7' },
  { label: '🔔', name: 'Bell',    mult: 200,  color: '#f59e0b' },
  { label: '💎', name: 'Diamond', mult: 2525, color: '#38bdf8' },
];

// Mirrors contracts/newGames/Slot.sol:
// TOTAL_WEIGHT = 99999 and cumulative thresholds [35000,62000,82000,93000,98000,99999].
// Therefore symbol weights are [35000, 27000, 20000, 11000, 5000, 1999].
const SLOT_TOTAL_WEIGHT = 99999;
const SLOT_SYMBOL_WEIGHTS = [35000, 27000, 20000, 11000, 5000, 1999];

const fmtPct = (v: number) => `${(v * 100).toFixed(4)}%`;
const SLOT_PROB_STATS = SYMBOLS.map((sym, i) => {
  const pItem = SLOT_SYMBOL_WEIGHTS[i] / SLOT_TOTAL_WEIGHT;
  const pPayline = pItem ** 3; // 3 iguales en una línea
  return {
    ...sym,
    pItem,
    pPayline,
    // This is an expectation, not "at least one line" probability.
    expectedHitsPerSpin: pPayline * 5, // 5 paylines
  };
});

// Paylines as cell indices [col0-row, col1-row, col2-row] → cell = row*3+col
// grid is row-major: cell(row,col) = grid[row*3+col]
const PAYLINES: [number, number, number][] = [
  [0, 1, 2],   // top horizontal    row0
  [3, 4, 5],   // middle horizontal row1
  [6, 7, 8],   // bottom horizontal row2
  [0, 4, 8],   // diagonal ↘
  [6, 4, 2],   // diagonal ↗
];

const PAYLINE_LABELS = ['Top', 'Mid', 'Bot', '↘', '↗'];

const CELL_H = 86; // px height of one reel symbol cell

function unpackGrid(packed: bigint): number[] {
  const grid: number[] = [];
  for (let i = 0; i < 9; i++) {
    grid.push(Number((packed >> BigInt(i * 3)) & 7n));
  }
  return grid;
}

function evaluatePaylines(grid: number[]): { lineIdx: number; symbol: number; mult: number }[] {
  const wins: { lineIdx: number; symbol: number; mult: number }[] = [];
  for (let i = 0; i < PAYLINES.length; i++) {
    const [a, b, c] = PAYLINES[i];
    if (grid[a] === grid[b] && grid[b] === grid[c]) {
      wins.push({ lineIdx: i, symbol: grid[a], mult: SYMBOLS[grid[a]].mult });
    }
  }
  return wins;
}

const rndSym = () => Math.floor(Math.random() * SYMBOLS.length);

// ── Reel ───────────────────────────────────────────────────────────────────────
// A single vertical reel showing 3 symbols. Scrolls downward forever while
// `spinning`, then eases to a stop showing `final` (top, mid, bottom).

function Reel({
  reelIndex,
  spinning,
  final,
  winRows,
}: {
  reelIndex: number;
  spinning: boolean;
  final: number[] | null;
  winRows: number[];
}) {
  const finalKey = final ? final.join('-') : '';

  const [mode, setMode] = useState<'idle' | 'spin' | 'land'>('idle');
  const [strip, setStrip] = useState<number[]>(() => [
    (reelIndex) % SYMBOLS.length,
    (reelIndex + 2) % SYMBOLS.length,
    (reelIndex + 4) % SYMBOLS.length,
  ]);
  const [ty, setTy] = useState(0);
  const rafRef = useRef(0);

  // Spinning loop: build a duplicated random strip and let CSS scroll it.
  useEffect(() => {
    if (spinning && !finalKey) {
      cancelAnimationFrame(rafRef.current);
      const base = Array.from({ length: 6 }, rndSym);
      setStrip([...base, ...base]); // duplicated → seamless -50% loop
      setTy(0);
      setMode('spin');
    }
  }, [spinning, finalKey, reelIndex]);

  // Landing: scroll through fillers and ease to the final 3 symbols (at top).
  useEffect(() => {
    if (!finalKey || !final) return;
    cancelAnimationFrame(rafRef.current);

    const N = 14 + reelIndex * 5; // fillers (more on later reels → longer spin)
    const fillers = Array.from({ length: N }, rndSym);
    const s = [final[0], final[1], final[2], ...fillers];
    setStrip(s);
    setMode('land');

    const startTy = -(N * CELL_H); // showing the bottom fillers
    const targetTy = 0;            // showing the final 3 at the top
    const dur = 750 + reelIndex * 350;
    const startT = performance.now();
    setTy(startTy);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startT) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setTy(startTy + (targetTy - startTy) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [finalKey, reelIndex]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-amber-400/15 bg-[#070707]"
      style={{ width: CELL_H + 14, height: CELL_H * 3 }}
    >
      {/* Strip */}
      <div
        className="will-change-transform"
        style={{
          transform: mode === 'spin' ? undefined : `translateY(${ty}px)`,
          animation:
            mode === 'spin'
              ? `reelDown ${(0.42 + reelIndex * 0.06).toFixed(2)}s linear infinite`
              : undefined,
        }}
      >
        {strip.map((s, i) => (
          <div
            key={i}
            className="flex items-center justify-center"
            style={{ height: CELL_H }}
          >
            <span className="select-none leading-none" style={{ fontSize: CELL_H * 0.5 }}>
              {SYMBOLS[s].label}
            </span>
          </div>
        ))}
      </div>

      {/* Depth shading: fade top & bottom + inner shadow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(7,7,7,0.95), transparent 20%, transparent 80%, rgba(7,7,7,0.95))',
          boxShadow: 'inset 0 0 24px rgba(0,0,0,0.7)',
        }}
      />

      {/* Win highlights on landed rows */}
      {winRows.map((r) => (
        <div
          key={r}
          className="pointer-events-none absolute left-1 right-1 rounded-lg border border-amber-400/70"
          style={{
            top: r * CELL_H + 3,
            height: CELL_H - 6,
            background: 'rgba(222,188,110,0.14)',
            boxShadow:
              'inset 0 0 18px rgba(222,188,110,0.3), 0 0 14px rgba(222,188,110,0.25)',
            animation: 'resultFadeIn 0.3s ease-out both',
          }}
        />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SlotPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.slotGame);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.slotGame);
  const { playClick, playChip } = useGameAudio('slot');

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [landedAll, setLandedAll] = useState(false);
  const [showPaytableModal, setShowPaytableModal] = useState(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase    = result.state?.phase ?? 'idle';
  const resultPayout   = result.state?.phase === 'result' ? result.state.payout    : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet  : undefined;

  const isResult = resultPhase === 'result';
  const isError  = resultPhase === 'error';
  // For slots: any payout > 0 is a win (partial returns are still wins)
  const isWin    = isResult && resultPayout !== undefined && resultPayout > BigInt(0);
  const isLoss   = isResult && (resultPayout === undefined || resultPayout === BigInt(0));

  const packed = isResult
    ? BigInt(result.state?.phase === 'result' ? (result.state.outcomes?.[0] ?? 0) : 0)
    : null;
  const finalGrid = packed !== null ? unpackGrid(packed) : null;
  const winLines  = finalGrid ? evaluatePaylines(finalGrid) : [];
  const winCells  = new Set(winLines.flatMap(({ lineIdx }) => PAYLINES[lineIdx]));

  // Per-reel final symbols [top, mid, bottom] for column `col`
  const reelsFinal =
    isResult && finalGrid
      ? [0, 1, 2].map((col) => [finalGrid[col], finalGrid[col + 3], finalGrid[col + 6]])
      : null;

  // Reveal result text / highlights only once all reels have landed.
  useEffect(() => {
    if (isResult) {
      setLandedAll(false);
      const id = setTimeout(() => setLandedAll(true), 750 + 2 * 350 + 250);
      return () => clearTimeout(id);
    }
    setLandedAll(false);
  }, [isResult, packed?.toString()]);

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…'  :
    resultPhase === 'settling'       ? 'Spinning…'    : '';

  const resultColor = isWin ? '#4ade80' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)';

  const showResult = isResult && landedAll;

  const handlePlay = async () => {
    if (!address) return;
    playClick();
    if (result.state !== null) result.close();
    setLoading(true);
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.slotGame); return; }
      const gameChoice = encodeSlotChoice();
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  const spinning = loading && !isResult;

  // ── Wallet gate ──────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex gap-2 opacity-30">
          {[0, 1, 2].map((c) => (
            <div key={c} className="flex flex-col gap-1.5 rounded-xl bg-zinc-900 border border-zinc-700 p-1.5">
              {[c, c + 2, c + 4].map((s, r) => (
                <div key={r} className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center text-3xl">
                  {SYMBOLS[s % SYMBOLS.length].label}
                </div>
              ))}
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
          Slots
        </h1>
        <p className="text-zinc-400 text-center max-w-xs">
          Classic 3×3 slot. Match 3 symbols across 5 paylines to win.
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
          <linearGradient id="gold-icon-grad-slot" x1="0" y1="0" x2="1" y2="1">
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
            gameAddress={addresses.games.slotGame}
            renderOutcome={(o) => {
              const g = unpackGrid(BigInt(o));
              const wins = evaluatePaylines(g);
              const bg = wins.length > 0
                ? 'bg-amber-400/10 text-amber-300 border-amber-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700';
              return (
                <div className={`h-6 px-1.5 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 ${bg}`}>
                  {wins.length > 0 ? `${wins.length}W` : '·'}
                </div>
              );
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowPaytableModal(true)}
          className="h-8 w-8 rounded-lg border border-amber-400/30 bg-zinc-900/70 text-amber-300 hover:bg-zinc-800/80 hover:border-amber-400/60 transition-colors flex items-center justify-center"
          aria-label="Show pay table info"
          title="Pay table info"
        >
          <Info className="w-4 h-4" />
        </button>
        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.slotGame} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: slot reels ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex items-center justify-center border border-amber-400/25 bg-[#0a0a0a]">

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-72 h-72 rounded-full blur-3xl transition-colors duration-700"
            style={{
              background: isWin  ? 'rgba(74,222,128,0.08)'
                        : isLoss ? 'rgba(248,113,113,0.06)'
                        : 'rgba(200,146,10,0.05)',
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-5">

          {/* Reel cabinet */}
          <div
            className="relative flex gap-2 p-3 rounded-2xl border border-amber-400/25 bg-[#0d0d0d]"
            style={{
              boxShadow: isWin
                ? '0 0 36px rgba(222,188,110,0.25), inset 0 0 24px rgba(222,188,110,0.06)'
                : 'inset 0 0 30px rgba(0,0,0,0.6)',
            }}
          >
            {[0, 1, 2].map((col) => (
              <Reel
                key={col}
                reelIndex={col}
                spinning={spinning}
                final={reelsFinal ? reelsFinal[col] : null}
                winRows={landedAll ? [0, 1, 2].filter((r) => winCells.has(r * 3 + col)) : []}
              />
            ))}
          </div>

          {/* Status while spinning / waiting */}
          {loading && spinLabel && !showResult && (
            <p className="text-amber-300/40 text-xs font-medium animate-pulse tracking-widest uppercase">
              {spinLabel}
            </p>
          )}

          {/* Result */}
          {showResult && (
            <div
              className="flex flex-col items-center gap-1"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              {isWin ? (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-3xl font-black"
                      style={{ color: resultColor, textShadow: `0 0 24px ${resultGlow}` }}
                    >
                      WIN
                    </span>
                    <div className="flex gap-1">
                      {winLines.map(({ lineIdx, symbol }) => (
                        <span
                          key={lineIdx}
                          className="text-xs font-bold px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 text-amber-300"
                        >
                          {PAYLINE_LABELS[lineIdx]} {SYMBOLS[symbol].label}
                        </span>
                      ))}
                    </div>
                  </div>
                  {resultPayout !== undefined && (
                    <p className="text-base font-bold text-green-300">
                      +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                    </p>
                  )}
                </>
              ) : (
                <span
                  className="text-2xl font-black"
                  style={{ color: resultColor }}
                >
                  NO WIN
                  {resultTotalBet !== undefined && (
                    <span className="ml-2 text-base text-zinc-500 font-medium">
                      −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {!loading && !isResult && (
            <p className="text-zinc-700 text-xs tracking-widest uppercase">
              3 reels · 5 paylines
            </p>
          )}
        </div>

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
          <div className="grid grid-cols-2">

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
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-slot)" strokeWidth={2} />
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

            {/* SPIN */}
            <div className="p-4 border-l border-amber-400/10 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading}
                className="relative w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2 bg-[#0d0d0d]"
                style={{
                  border: '3px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  boxShadow: loading
                    ? 'none'
                    : '0 0 24px rgba(222,188,110,0.25), 0 0 60px rgba(222,188,110,0.08), inset 0 0 20px rgba(222,188,110,0.04)',
                }}
              >
                <span
                  className="font-black text-3xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5))',
                  }}
                >
                  SPIN
                </span>
                <span className="text-[10px] text-zinc-500 font-medium">5 paylines</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      {showPaytableModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-amber-400/30 bg-[#121212] shadow-[0_0_40px_rgba(0,0,0,0.65)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-400/15">
              <h3
                className="text-sm font-black uppercase tracking-widest"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >
                Pay Table
              </h3>
              <button
                type="button"
                onClick={() => setShowPaytableModal(false)}
                className="px-2 py-1 rounded border border-zinc-700 text-xs text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-zinc-300">
                Probabilidades basadas en `Slot.sol` (pesos on-chain). Un payline de símbolo ocurre cuando salen 3 iguales en una línea.
              </div>

              <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/50 p-2">
                <p className="text-[11px] text-zinc-400 uppercase tracking-widest mb-2">Symbol Odds</p>
                <div className="space-y-1.5">
                  {SLOT_PROB_STATS.map((s) => (
                    <div key={s.name} className="grid grid-cols-[1.2fr_0.9fr_1fr_0.8fr] gap-2 items-center text-[11px] rounded border border-zinc-800 px-2 py-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <span className="text-base leading-none">{s.label}</span>
                        <span style={{ color: s.color }}>{s.name}</span>
                      </div>
                      <div className="text-zinc-300 tabular-nums" title="Probabilidad de salir en una celda">
                        Item {fmtPct(s.pItem)}
                      </div>
                      <div className="text-amber-300 tabular-nums" title="Probabilidad de 3 iguales en una línea">
                        Linea {fmtPct(s.pPayline)}
                      </div>
                      <div className="text-zinc-400 tabular-nums text-right">
                        {s.mult}x
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/50 p-2">
                <p className="text-[11px] text-zinc-400 uppercase tracking-widest mb-1">Paylines</p>
                <div className="grid grid-cols-5 gap-1.5 text-[11px]">
                  {PAYLINE_LABELS.map((label, i) => (
                    <div key={label} className="text-center rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 py-0.5">
                      {label} {PAYLINES[i].map((cell) => cell.toString()).join('-')}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 mt-2">
                  Nota: la columna "Linea" es por cada payline individual. El slot evalua 5 paylines por spin.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
