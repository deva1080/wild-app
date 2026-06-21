'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Info } from 'lucide-react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeSlotChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { abis } from '@/lib/web3/constants/abis';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const GAME_ADDRESS = addresses.games.modernSlotGame;

// 0=Cherry 1=Lemon 2=Orange 3=Grape 4=Bell 5=Diamond 6=WILD
const SYMBOLS = [
  { emoji: '🍒', name: 'Cherry',  color: '#ef4444', base: 2 },
  { emoji: '🍋', name: 'Lemon',   color: '#eab308', base: 5 },
  { emoji: '🍊', name: 'Orange',  color: '#f97316', base: 12 },
  { emoji: '🍇', name: 'Grape',   color: '#a855f7', base: 40 },
  { emoji: '🔔', name: 'Bell',    color: '#f59e0b', base: 150 },
  { emoji: '💎', name: 'Diamond', color: '#38bdf8', base: 600 },
  { emoji: '⭐', name: 'WILD',    color: '#debc6e', base: 0 },
];

const WILD = 6;
const MIN_MATCH = 3;
const MAX_GLOBAL_MULT = 1000n;
const PAY_FACTORS: Record<number, number> = { 3: 1, 4: 5, 5: 20, 6: 60, 7: 150 };

// Reel layout / timing
const CELL_H = 68; // px per reel cell
const LAND_BASE = 650;
const LAND_STAGGER = 180;

const rndSym = () => Math.floor(Math.random() * 7); // includes WILD for variety

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mirrors contract _decodeWildMult: encoded 1→x2, 2→x3, 3→x5, else 0.
function decodeWildMult(encoded: number): number {
  if (encoded === 1) return 2;
  if (encoded === 2) return 3;
  if (encoded === 3) return 5;
  return 0;
}

/**
 * Unpack the BetSettled outcomes[0] packed grid.
 * Per cell (5 bits): bits[0..2] = symbol (0-6), bits[3..4] = encoded wild mult.
 * This is the SAME data the contract emits in ModernSlotSpun, but it arrives
 * in the monolithic settle tx so it is always in sync with the payout.
 */
function unpackOutcome(packed: bigint, cells: number): { grid: number[]; wildMult: number[] } {
  const grid: number[] = [];
  const wildMult: number[] = [];
  for (let i = 0; i < cells; i++) {
    const chunk = Number((packed >> BigInt(i * 5)) & 0x1fn);
    grid.push(chunk & 0x7);
    wildMult.push(decodeWildMult(chunk >> 3));
  }
  return { grid, wildMult };
}

// Mirrors contract: product of all WILD cell multipliers, capped at MAX_GLOBAL_MULT.
function computeGlobalMult(wildMult: number[]): bigint {
  let g = 1n;
  for (const wm of wildMult) {
    if (wm > 1) {
      g *= BigInt(wm);
      if (g >= MAX_GLOBAL_MULT) return MAX_GLOBAL_MULT;
    }
  }
  return g;
}

interface WinEntry { symbol: number; length: number; ways: number }

function evaluateWins(grid: number[], reels: number, rows: number): WinEntry[] {
  const wins: WinEntry[] = [];
  for (let s = 0; s < 6; s++) {
    let ways = 1;
    let length = 0;
    for (let reel = 0; reel < reels; reel++) {
      let count = 0;
      for (let row = 0; row < rows; row++) {
        const cell = grid[reel * rows + row];
        if (cell === s || cell === WILD) count++;
      }
      if (count === 0) break;
      ways *= count;
      length++;
    }
    if (length >= MIN_MATCH) wins.push({ symbol: s, length, ways });
  }
  return wins;
}

// ── Reel ───────────────────────────────────────────────────────────────────────
// A vertical reel of `rows` cells. Scrolls downward while `spinning`, then eases
// to a stop showing `final` ([top..bottom]). Light effects (glow boxes + WILD
// badges) only render once `active` (all reels landed).

function MReel({
  reelIndex,
  rows,
  spinning,
  final,
  finalWild,
  active,
  reelInWin,
  winRows,
}: {
  reelIndex: number;
  rows: number;
  spinning: boolean;
  final: number[] | null;
  finalWild: number[] | null;
  active: boolean;
  reelInWin: boolean;
  winRows: number[];
}) {
  const finalKey = final ? final.join('-') : '';

  const [mode, setMode] = useState<'idle' | 'spin' | 'land'>('idle');
  const [strip, setStrip] = useState<number[]>(() =>
    Array.from({ length: rows }, (_, r) => (reelIndex * rows + r) % 6),
  );
  const [ty, setTy] = useState(0);
  const rafRef = useRef(0);

  // Spinning loop: duplicated random strip scrolled by CSS.
  useEffect(() => {
    if (spinning && !finalKey) {
      cancelAnimationFrame(rafRef.current);
      const base = Array.from({ length: rows * 2 }, rndSym);
      setStrip([...base, ...base]);
      setTy(0);
      setMode('spin');
    }
  }, [spinning, finalKey, reelIndex, rows]);

  // Landing: scroll through fillers and ease onto the final symbols (at top).
  useEffect(() => {
    if (!finalKey || !final) return;
    cancelAnimationFrame(rafRef.current);

    const N = 12 + reelIndex * 4;
    const fillers = Array.from({ length: N }, rndSym);
    setStrip([...final, ...fillers]);
    setMode('land');

    const startTy = -(N * CELL_H);
    const dur = LAND_BASE + reelIndex * LAND_STAGGER;
    const startT = performance.now();
    setTy(startTy);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startT) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setTy(startTy * (1 - e));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [finalKey, reelIndex, rows]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const showWin = active && reelInWin;
  const dim = active && !reelInWin;

  return (
    <div
      className="relative rounded-xl p-1 transition-all duration-300"
      style={{
        opacity: dim ? 0.35 : 1,
        background: showWin ? 'rgba(222,188,110,0.06)' : 'transparent',
        boxShadow: showWin
          ? '0 0 0 1px rgba(222,188,110,0.35), 0 0 18px rgba(222,188,110,0.12)'
          : 'none',
        transform: showWin ? 'scale(1.04)' : 'scale(1)',
      }}
    >
      <div
        className="relative overflow-hidden rounded-lg border border-amber-400/12 bg-[#070707]"
        style={{ width: CELL_H, height: CELL_H * rows }}
      >
        {/* Strip */}
        <div
          className="will-change-transform"
          style={{
            transform: mode === 'spin' ? undefined : `translateY(${ty}px)`,
            animation:
              mode === 'spin'
                ? `reelDown ${(0.4 + reelIndex * 0.05).toFixed(2)}s linear infinite`
                : undefined,
          }}
        >
          {strip.map((s, i) => (
            <div key={i} className="flex items-center justify-center" style={{ height: CELL_H }}>
              <span className="leading-none select-none" style={{ fontSize: CELL_H * 0.46 }}>
                {SYMBOLS[s].emoji}
              </span>
            </div>
          ))}
        </div>

        {/* Depth shading */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(7,7,7,0.92), transparent 22%, transparent 78%, rgba(7,7,7,0.92))',
            boxShadow: 'inset 0 0 18px rgba(0,0,0,0.7)',
          }}
        />

        {/* Light effects on landed cells (win glow + WILD badge) */}
        {active &&
          final &&
          final.map((sym, r) => {
            const isWinCell = winRows.includes(r);
            const isWild = sym === WILD;
            if (!isWinCell && !isWild) return null;
            const color = SYMBOLS[sym]?.color ?? '#debc6e';
            const wm = finalWild?.[r] ?? 0;
            return (
              <div
                key={r}
                className="pointer-events-none absolute left-0.5 right-0.5 rounded-lg border"
                style={{
                  top: r * CELL_H + 2,
                  height: CELL_H - 4,
                  borderColor: isWild ? 'rgba(222,188,110,0.7)' : `${color}66`,
                  background: isWild ? 'rgba(222,188,110,0.12)' : `${color}1f`,
                  boxShadow: isWild
                    ? '0 0 16px rgba(222,188,110,0.45)'
                    : `0 0 14px ${color}55, inset 0 0 12px ${color}30`,
                  animation: 'resultFadeIn 0.3s ease-out both',
                }}
              >
                {isWild && wm > 0 && (
                  <span
                    className="absolute -top-1 -right-1 text-[9px] font-black px-1 py-0.5 rounded-full leading-none"
                    style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a1205' }}
                  >
                    ×{wm}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ModernSlotPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(GAME_ADDRESS);
  const result = useGameResultFlow();
  const bet = useBetController(GAME_ADDRESS);

  const { data: reelsData } = useReadContract({ address: GAME_ADDRESS, abi: abis.modernSlot, functionName: 'REELS' });
  const { data: rowsData }  = useReadContract({ address: GAME_ADDRESS, abi: abis.modernSlot, functionName: 'ROWS' });

  const reels = typeof reelsData === 'number' ? reelsData : 5;
  const rows  = typeof rowsData  === 'number' ? rowsData  : 3;
  const cells = reels * rows;

  const [amount, setAmount]     = useState('1');
  const [loading, setLoading]   = useState(false);
  const [landedAll, setLandedAll] = useState(false);
  const [showPaytableModal, setShowPaytableModal] = useState(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase = result.state?.phase ?? 'idle';
  const isResult    = resultPhase === 'result';
  const isError     = resultPhase === 'error';

  const win    = result.state?.phase === 'result' ? result.state.payout   : undefined;
  const betAmt = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const isWin  = isResult && win !== undefined && win > 0n;
  const isLoss = isResult && (win === undefined || win === 0n);

  // Unpack the grid + wild multipliers from the packed outcome (outcomes[0]).
  const packedOutcome =
    result.state?.phase === 'result' && result.state.outcomes.length > 0
      ? result.state.outcomes[0]
      : null;
  const unpacked     = packedOutcome !== null ? unpackOutcome(packedOutcome, cells) : null;
  const realGrid     = unpacked?.grid     ?? null;
  const realWildMult = unpacked?.wildMult ?? null;
  const globalMult   = realWildMult ? computeGlobalMult(realWildMult) : 1n;
  const winEntries   = realGrid ? evaluateWins(realGrid, reels, rows) : [];
  const winReels = new Set(winEntries.flatMap((w) => Array.from({ length: w.length }, (_, i) => i)));

  // Only cells whose symbol matches a winning combination (or is WILD substituting it)
  const winCells = new Set<number>();
  if (realGrid) {
    for (const { symbol, length } of winEntries) {
      for (let reel = 0; reel < length; reel++) {
        for (let row = 0; row < rows; row++) {
          const cellIdx = reel * rows + row;
          const sym = realGrid[cellIdx];
          if (sym === symbol || sym === WILD) winCells.add(cellIdx);
        }
      }
    }
  }

  // Per-reel final symbols / wild mults ([top..bottom] for each reel column)
  const reelsFinal =
    isResult && realGrid
      ? Array.from({ length: reels }, (_, reel) =>
          Array.from({ length: rows }, (_, row) => realGrid[reel * rows + row]),
        )
      : null;
  const reelsFinalWild =
    isResult && realWildMult
      ? Array.from({ length: reels }, (_, reel) =>
          Array.from({ length: rows }, (_, row) => realWildMult[reel * rows + row]),
        )
      : null;

  // Reveal light effects / result text once every reel has landed.
  useEffect(() => {
    if (isResult) {
      setLandedAll(false);
      const id = setTimeout(
        () => setLandedAll(true),
        LAND_BASE + (reels - 1) * LAND_STAGGER + 250,
      );
      return () => clearTimeout(id);
    }
    setLandedAll(false);
  }, [isResult, packedOutcome?.toString(), reels]);

  const active = isResult && landedAll;
  const spinning = loading && !isResult;

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…'  :
    resultPhase === 'settling'       ? 'Spinning…'    : '';

  const resultColor = isWin ? '#4ade80' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)';

  const handlePlay = async () => {
    if (!address) return;
    if (result.state !== null) {
      result.close();
      return;
    }
    setLoading(true);
    try {
      if (pendingBetId) { result.stuck(pendingBetId, GAME_ADDRESS); return; }
      const gameChoice = encodeSlotChoice();
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  const payLengths = [3, 4, 5, 6, 7].filter((l) => l <= reels);

  // ── Wallet gate ────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex gap-2 opacity-30">
          {Array.from({ length: 5 }, (_, r) => (
            <div key={r} className="flex flex-col gap-1.5">
              {Array.from({ length: 3 }, (_, row) => (
                <div key={row} className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-2xl select-none">
                  {SYMBOLS[(r * 3 + row) % 6].emoji}
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
          Modern Slots
        </h1>
        <p className="text-zinc-400 text-center max-w-sm">
          {reels}×{rows} ways-to-win with WILD multipliers. Match 3+ symbols left-to-right.
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
          <linearGradient id="gold-icon-grad-mslot" x1="0" y1="0" x2="1" y2="1">
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
            gameAddress={GAME_ADDRESS}
            renderOutcome={() => {
              return (
                <div className="h-6 px-1.5 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 bg-zinc-800 text-zinc-500 border-zinc-700">
                  🎰
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
          <PendingBetBanner gameAddress={GAME_ADDRESS} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: reels ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex flex-col items-center justify-center border border-amber-400/25 bg-[#0a0a0a] gap-4 py-4">

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-[28rem] h-56 rounded-full blur-3xl transition-colors duration-500"
            style={{
              background: isWin  ? 'rgba(74,222,128,0.07)'
                        : isLoss ? 'rgba(248,113,113,0.05)'
                        : loading ? 'rgba(222,188,110,0.05)'
                        : 'rgba(200,146,10,0.03)',
            }}
          />
        </div>

        {/* Reel cabinet */}
        <div
          className="relative z-10 flex gap-2 p-3 rounded-2xl border border-amber-400/25 bg-[#0d0d0d]"
          style={{
            boxShadow: isWin
              ? '0 0 44px rgba(222,188,110,0.2), inset 0 0 24px rgba(222,188,110,0.05)'
              : loading
              ? '0 0 20px rgba(222,188,110,0.07), inset 0 0 30px rgba(0,0,0,0.6)'
              : 'inset 0 0 30px rgba(0,0,0,0.6)',
          }}
        >
          {Array.from({ length: reels }, (_, reel) => {
            const winRows = active
              ? Array.from({ length: rows }, (_, r) => r).filter((r) => winCells.has(reel * rows + r))
              : [];
            return (
              <MReel
                key={`${reel}-${rows}`}
                reelIndex={reel}
                rows={rows}
                spinning={spinning}
                final={reelsFinal ? reelsFinal[reel] : null}
                finalWild={reelsFinalWild ? reelsFinalWild[reel] : null}
                active={active}
                reelInWin={winReels.has(reel)}
                winRows={winRows}
              />
            );
          })}
        </div>

        {/* Status / result */}
        <div className="relative z-10 flex flex-col items-center gap-2 min-h-[52px]">
          {loading && spinLabel && (
            <p className="text-amber-300/40 text-xs font-medium animate-pulse tracking-widest uppercase">
              {spinLabel}
            </p>
          )}

          {active && (
            <div
              className="flex flex-col items-center gap-1.5"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              {isWin ? (
                <>
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <span
                      className="text-3xl font-black"
                      style={{ color: resultColor, textShadow: `0 0 24px ${resultGlow}` }}
                    >
                      WIN
                    </span>
                    {globalMult > 1n && (
                      <span
                        className="text-lg font-black px-2 py-0.5 rounded-lg"
                        style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a1205' }}
                      >
                        ×{globalMult.toString()} WILD
                      </span>
                    )}
                    {win !== undefined && (
                      <span className="text-base font-bold text-green-300">
                        +{fmtAmt(win)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {winEntries.map((w, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 text-amber-300"
                      >
                        {SYMBOLS[w.symbol].emoji} {w.length}× · {w.ways} ways
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <span className="text-xl font-black" style={{ color: resultColor }}>
                  NO WIN
                  {betAmt !== undefined && (
                    <span className="ml-2 text-sm text-zinc-500 font-medium">
                      −{fmtAmt(betAmt)} {bet.meta.symbol}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {!isResult && !loading && (
            <p className="text-zinc-700 text-xs tracking-widest uppercase">
              {reels}×{rows} ways-to-win · WILD ×2/3/5 multipliers
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
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-mslot)" strokeWidth={2} />
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

            {/* SPIN */}
            <div className="p-4 border-l border-amber-400/10 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading}
                className="relative w-full h-full rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center bg-[#0d0d0d]"
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
                Pay Table (Contract)
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
                WILD (`⭐`) sustituye todos los símbolos y su multiplicador global es producto de todos los WILD (cap {MAX_GLOBAL_MULT.toString()}x).
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {SYMBOLS.slice(0, 6).map((sym) => (
                  <div key={sym.name} className="rounded-lg border border-zinc-700/70 bg-zinc-900/50 p-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold flex items-center gap-1.5">
                        <span className="text-base leading-none">{sym.emoji}</span>
                        <span style={{ color: sym.color }}>{sym.name}</span>
                      </span>
                      <span className="text-zinc-500">base {sym.base}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {payLengths.map((length) => (
                        <span
                          key={`${sym.name}-${length}`}
                          className="text-[11px] px-2 py-0.5 rounded border border-amber-400/20 bg-amber-400/10 text-amber-300"
                        >
                          {length === 7 ? '7+' : length}R: {sym.base * (PAY_FACTORS[length] ?? PAY_FACTORS[7])}x
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">
                Formula: `(bet * payout(symbol,length) * ways) / payDenom`, luego se aplica `globalMultiplier` de WILD.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
