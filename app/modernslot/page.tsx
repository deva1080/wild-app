'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Gem } from 'lucide-react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeSlotChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { abis } from '@/lib/web3/constants/abis';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

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
  cellH,
}: {
  reelIndex: number;
  rows: number;
  spinning: boolean;
  final: number[] | null;
  finalWild: number[] | null;
  active: boolean;
  reelInWin: boolean;
  winRows: number[];
  cellH: number;
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

    const startTy = -(N * cellH);
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
        style={{ width: cellH, height: cellH * rows }}
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
            <div key={i} className="flex items-center justify-center" style={{ height: cellH }}>
              <span className="leading-none select-none" style={{ fontSize: cellH * 0.46 }}>
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
                  top: r * cellH + 2,
                  height: cellH - 4,
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
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(GAME_ADDRESS);
  const result = useGameResultFlow();
  const bet = useBetController(GAME_ADDRESS);
  const { playClick, playChip, playRandom, playSfx } = useGameAudio('modernslot');

  const { data: reelsData } = useReadContract({ address: GAME_ADDRESS, abi: abis.modernSlot, functionName: 'REELS' });
  const { data: rowsData }  = useReadContract({ address: GAME_ADDRESS, abi: abis.modernSlot, functionName: 'ROWS' });

  const reels = typeof reelsData === 'number' ? reelsData : 5;
  const rows  = typeof rowsData  === 'number' ? rowsData  : 3;
  const cells = reels * rows;

  const [amount, setAmount]     = useState('1');
  const [loading, setLoading]   = useState(false);
  const [landedAll, setLandedAll] = useState(false);
  const [showPaytableModal, setShowPaytableModal] = useState(false);
  const [cellH, setCellH] = useState(CELL_H);
  const resultAudioKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const update = () => {
      if (window.innerWidth < 640) {
        // Fit every reel inside both the horizontal and vertical mobile viewport.
        const horizontalSpace = window.innerWidth - 16 - 16 - 16 - (reels - 1) * 4;
        const verticalSpace = Math.min(300, Math.max(190, window.innerHeight * 0.42)) - 16;
        const byWidth = Math.floor(horizontalSpace / reels);
        const byHeight = Math.floor(verticalSpace / rows);
        setCellH(Math.min(CELL_H, Math.max(36, Math.min(byWidth, byHeight))));
      } else {
        setCellH(CELL_H);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [reels, rows]);

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

  useEffect(() => {
    if (!active || packedOutcome === null) return;
    const audioKey = packedOutcome.toString();
    if (resultAudioKeyRef.current === audioKey) return;
    resultAudioKeyRef.current = audioKey;

    if (isWin) {
      const isBigWin =
        globalMult > 1n ||
        winEntries.some(({ length, ways }) => length >= 5 || ways >= 3) ||
        (win !== undefined && betAmt !== undefined && win >= betAmt * 10n);
      if (isBigWin) playSfx('winBig');
      else playRandom(['winSmall', 'winSmallAlt']);
      return;
    }

    playSfx('defaultResult');
  }, [active, packedOutcome, isWin, globalMult, winEntries, win, betAmt, playRandom, playSfx]);

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…'  :
    resultPhase === 'settling'       ? 'Spinning…'    : '';

  const resultColor = isWin ? '#4ade80' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)';

  const handlePlay = async () => {
    if (bet.needsApproval) {
      try { await bet.approveSelectedToken(); } catch (e: unknown) { result.error(extractRevertReason(e)); }
      return;
    }
    playClick();
    resultAudioKeyRef.current = null;
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

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-mslot" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
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
        <GameInfoButton onClick={() => setShowPaytableModal(true)} />
        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={GAME_ADDRESS} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: reels ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 p-2 sm:px-0 sm:py-4 mx-2 sm:mx-4 my-2 sm:my-3 rounded-2xl flex items-center justify-center border border-amber-400/25 bg-[#0a0a0a]">

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
          className="relative z-10 flex max-w-full gap-1 sm:gap-2 p-2 sm:p-3 rounded-2xl border border-amber-400/25 bg-[#0d0d0d]"
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
                cellH={cellH}
              />
            );
          })}
        </div>

        {/* Status / result */}
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center">
          {loading && spinLabel && (
            <p className="rounded-full border border-amber-400/25 bg-black/75 backdrop-blur-md px-4 py-2 text-amber-200/80 text-xs font-medium animate-pulse tracking-widest uppercase shadow-xl">
              {spinLabel}
            </p>
          )}

          {active && (
            <div
              className="pointer-events-auto flex max-w-[calc(100%_-_24px)] flex-col items-center gap-1.5 rounded-xl border border-amber-300/35 bg-black/80 px-4 py-3 text-center shadow-[0_12px_40px_rgba(0,0,0,0.75)] backdrop-blur-md"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              {isWin ? (
                <div className="flex flex-col items-center gap-1">
                  <span
                    className="text-xl font-black tracking-widest"
                    style={{ color: resultColor, textShadow: `0 0 24px ${resultGlow}` }}
                  >
                    WIN
                  </span>
                  {win !== undefined && (
                    <span
                      className="text-4xl sm:text-5xl font-black text-green-300 tabular-nums"
                      style={{ textShadow: `0 0 28px ${resultGlow}` }}
                    >
                      +{fmtAmt(win)} <span className="text-xl sm:text-2xl text-green-400/75">{bet.meta.symbol}</span>
                    </span>
                  )}
                </div>
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
            <p className="absolute bottom-2 rounded-full bg-black/55 px-3 py-1 text-zinc-500 text-[10px] sm:text-xs tracking-widest uppercase backdrop-blur-sm">
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
      <div className="flex-shrink-0 p-1.5 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y divide-amber-400/10 sm:divide-y-0 sm:divide-x sm:divide-amber-400/10">

            {/* BET AMOUNT */}
            <div className="p-2.5 sm:p-4 space-y-2 sm:space-y-3">
              <p
                className="text-xs sm:text-sm font-black uppercase tracking-widest"
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
                <CircleDollarSign className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" stroke="url(#gold-icon-grad-mslot)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-lg sm:text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                      className={`py-0.5 sm:py-1 rounded text-[11px] sm:text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* SPIN */}
            <div className="p-2 sm:p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading || bet.isApproving || bet.allowanceLoading}
                className="relative w-full h-full min-h-[62px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2 bg-[#0d0d0d]"
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
                  {bet.actionLabel('SPIN')}
                </span>
                <span className="hidden sm:block text-[10px] text-zinc-500 font-medium">ways to win</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showPaytableModal}
        onClose={() => setShowPaytableModal(false)}
        icon={<Gem className="w-4 h-4" />}
        title="Modern Slot"
        description={`Modern Slot runs on a ${reels}×${rows} grid using a "ways-to-win" engine rather than fixed paylines: instead of needing symbols on a specific line, the game scans each of the six payable symbols (Cherry, Lemon, Orange, Grape, Bell, Diamond) independently across the reels starting from reel 0, counting how many cells in each consecutive reel contain that symbol (or a WILD substituting for it), and stops counting at the first reel with zero matches. A seventh symbol, WILD ("⭐"), substitutes for any of the six payable symbols when forming a match and additionally carries its own per-cell multiplier of x2, x3, or x5, with respective odds of 70%, 25%, and 5% per WILD landed. Every WILD multiplier present anywhere on the grid is multiplied together into a single global multiplier, which is then applied to the entire win, capped at ${MAX_GLOBAL_MULT.toString()}x — so a grid with two or three WILDs showing higher multipliers can turn an ordinary line win into a dramatically larger payout.`}
        steps={[
          'Place your bet amount, then press Spin to send the wager on-chain.',
          `The ${reels} reels spin independently and land on a ${reels}×${rows} grid of symbols, revealed reel by reel.`,
          'For each payable symbol, the game counts consecutive matches starting at reel 0 (treating WILD as a match for any symbol) and stops at the first reel with no match; 3 or more consecutive matching reels forms a win for that symbol.',
          'Each qualifying symbol pays bet × base value × length factor × ways, where "ways" is the product of how many matching cells appear in each counted reel.',
          'Any WILD cells on the grid each carry their own x2/x3/x5 multiplier; all WILD multipliers present are multiplied together into one global multiplier (capped) and applied to your total win before it is credited.',
        ]}
        sections={[
          {
            title: 'Pay Table (Contract)',
            content: (
              <div>
                <p className="text-xs text-zinc-300 mb-2 leading-relaxed">
                  Each payable symbol has a base value and a length factor that scales the payout depending on how many consecutive reels (from reel 0) it matches across — longer streaks pay disproportionately more, not just linearly. The base values and per-length multipliers actually wired into this page are listed below for all six payable symbols.
                </p>
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
              </div>
            ),
          },
          {
            title: 'WILD Mechanics & Global Multiplier',
            content: (
              <div className="text-xs text-zinc-300 space-y-2 leading-relaxed">
                <p>
                  WILD ("⭐") is the seventh symbol on the grid. It substitutes for any of the six payable symbols when the engine counts consecutive matches, so a WILD sitting in the reel-2 column can extend or even create a winning streak for whichever symbol benefits most. Independently of substitution, every WILD cell also rolls its own multiplier:
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-0.5 rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 font-mono">x2 · 70%</span>
                  <span className="px-2 py-0.5 rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 font-mono">x3 · 25%</span>
                  <span className="px-2 py-0.5 rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 font-mono">x5 · 5%</span>
                </div>
                <p>
                  All WILD multipliers present anywhere on the grid in a single spin are multiplied together (not added) into one global multiplier, which is applied once to the total win across every winning symbol, capped at {MAX_GLOBAL_MULT.toString()}x. A single WILD landing its rare x5 roll is a meaningful boost; two or three WILDs stacking together can compound far beyond any individual symbol's base payout.
                </p>
              </div>
            ),
          },
        ]}
        tip="WILD multipliers stack multiplicatively across the whole grid — landing two or three WILDs can push your payout far past a single symbol win. This is a high-variance game: most spins land no qualifying 3+ streak, but WILD-heavy grids can deliver outsized wins relative to the bet."
        rtp="~97% (5×3 default)"
      />
    </div>
  );
}
