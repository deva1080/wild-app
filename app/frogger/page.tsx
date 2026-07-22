'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { CircleDollarSign, Footprints } from 'lucide-react';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeCrashChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const TILE_SIZE = 46;
const TILE_GAP = 8;

// Baseline tile counts per row (1 croc/row), bottom row first, narrowing
// toward the top. With 2 crocs/row each row gets +1 tile (see buildSteps).
const BASE_TILES = [5, 5, 4, 4, 3, 3, 2];
const STEP_LABELS = ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6', 'Step 7'];

// Fair odds for "1-in-N survives" with `crocs` traps hidden among `tiles`
// lily pads: mult = tiles / (tiles - crocs). No house edge baked in here —
// matches the original fixed-odds table this replaced.
function buildSteps(crocs: 1 | 2) {
  return BASE_TILES.map((base, i) => {
    const tiles = base + (crocs - 1);
    const multBps = Math.round((tiles / (tiles - crocs)) * 100);
    return {
      label: STEP_LABELS[i],
      multBps,
      display: (multBps / 100).toFixed(2) + 'x',
      tiles,
      crocs,
    };
  });
}

type TileKind = 'idle' | 'selected' | 'unselected' | 'safe' | 'path' | 'frog' | 'croc';
type RowReveal = { crocs: number[]; frog: number };

// ── Lily pad tile ────────────────────────────────────────────────────────────
function Tile({ kind, onClick }: { kind: TileKind; onClick?: () => void }) {
  const size = TILE_SIZE;

  if (kind === 'croc') {
    return (
      <div
        className="rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(160deg, #ef4444, #b91c1c)',
          border: '2px solid rgba(0,0,0,0.25)',
          boxShadow: '0 0 16px rgba(239,68,68,0.4)',
          animation: 'tileBite 0.45s ease-in-out, resultFadeIn 0.3s ease-out both',
        }}
      >
        <span className="text-2xl select-none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>🐊</span>
      </div>
    );
  }

  if (kind === 'safe' || kind === 'path' || kind === 'frog') {
    return (
      <div
        className="rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(160deg, #debc6e, #8c6825)',
          border: kind === 'safe' ? '2px solid rgba(0,0,0,0.2)' : '2px solid rgba(255,255,255,0.85)',
          boxShadow: kind === 'safe' ? 'none' : '0 0 14px rgba(222,188,110,0.6)',
          animation: 'resultFadeIn 0.3s ease-out both',
        }}
      >
        {kind === 'frog' && <span className="text-xl select-none">🐸</span>}
      </div>
    );
  }

  if (kind === 'selected') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl flex items-center justify-center flex-shrink-0 cursor-pointer"
        style={{
          width: size,
          height: size,
          background: 'transparent',
          border: '2px solid #debc6e',
          boxShadow: '0 0 14px rgba(222,188,110,0.6)',
        }}
      >
        <span className="text-xl select-none">🐸</span>
      </button>
    );
  }

  // 'unselected' (current row, clickable) and 'idle' (future row, inert) —
  // styled like Keno's empty cells: flat, outlined, no fill.
  const clickable = kind === 'unselected';
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${clickable ? 'cursor-pointer hover:border-amber-300/50' : ''}`}
      style={{
        width: size,
        height: size,
        background: 'transparent',
        border: '2px solid rgba(255,255,255,0.12)',
      }}
    />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FroggerPage() {
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.crash);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.crash);
  const { playClick, playChip, playSfx } = useGameAudio('frogger');

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [currentStep, setCurrentStep] = useState(0); // 0 = not started, 1–7 = on that step
  const [gameOver, setGameOver] = useState<'win' | 'loss' | null>(null);
  // How many crocs hide in each row. Only changeable before a run starts.
  const [crocCount, setCrocCount] = useState<1 | 2>(1);
  // Which lily pad the player has picked for the current row. The pick is
  // cosmetic — the contract result is independent of it — but it decides
  // where the croc shows up on a loss, and which tile traces the frog's path.
  const [selectedTile, setSelectedTile] = useState(0);
  // Let-it-ride stake: once a run is going, each jump wagers exactly what the
  // previous jump paid out. null = no run in progress (use the typed `amount`).
  const [stakeWei, setStakeWei] = useState<bigint | null>(null);
  // Sum of every payout collected so far in the current run (shown on the
  // game-over overlay, not just the most recent jump's payout).
  const [totalWon, setTotalWon] = useState<bigint>(0n);
  // Per-row reveal once that row has been played.
  const [rowReveal, setRowReveal] = useState<Record<number, RowReveal>>({});
  // The amount the player typed before starting the run, restored on reset.
  const baseAmountRef = useRef('1');
  const inFlightRef = useRef(false);
  // Prevents double-processing the same result state (React StrictMode runs
  // effects twice in dev, and waitForDelegatedTx can call settled() a second
  // time via its receipt fallback if result.close() was called mid-flight).
  const resultHandledRef = useRef(false);

  const STEPS = useMemo(() => buildSteps(crocCount), [crocCount]);

  // Auto-shrink the pyramid to whatever space the card actually has, so it
  // always fits on screen with no scroll instead of clipping or overflowing.
  const towerCardRef = useRef<HTMLDivElement>(null);
  const towerGroupRef = useRef<HTMLDivElement>(null);
  const [towerScale, setTowerScale] = useState(1);

  useEffect(() => {
    const card = towerCardRef.current;
    const group = towerGroupRef.current;
    if (!card || !group) return;
    const BREATHING_ROOM = 32; // px of padding to keep around the scaled pyramid
    const recompute = () => {
      const availW = card.clientWidth - BREATHING_ROOM * 2;
      const availH = card.clientHeight - BREATHING_ROOM * 2;
      const natW = group.offsetWidth;
      const natH = group.offsetHeight;
      if (!availW || !availH || !natW || !natH) return;
      setTowerScale(Math.min(1, availW / natW, availH / natH));
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(card);
    ro.observe(group);
    recompute();
    return () => ro.disconnect();
  }, []);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase = result.state?.phase ?? 'idle';
  const isSpinning = loading;
  const isProcessing = isSpinning || ['placing', 'waiting-settle', 'settling'].includes(resultPhase);
  const isActive = currentStep > 0;
  const isComplete = currentStep >= STEPS.length;

  const spinLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  // The step the player is about to play (0-indexed into STEPS array)
  const stepIdx = Math.min(currentStep, STEPS.length - 1);
  const nextStep = STEPS[stepIdx];

  // Pre-select a random lily pad whenever a new row becomes active (or the
  // row layout changes because crocs/row was adjusted before starting).
  useEffect(() => {
    const tiles = STEPS[Math.min(currentStep, STEPS.length - 1)].tiles;
    setSelectedTile(Math.floor(Math.random() * tiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, crocCount]);

  // What kind of tile to render at row r, tile index i.
  const tileKind = (r: number, i: number): TileKind => {
    const reveal = rowReveal[r];
    if (reveal) {
      if (reveal.crocs.includes(i)) return 'croc';
      if (i === reveal.frog) return r === currentStep - 1 && gameOver !== 'loss' ? 'frog' : 'path';
      return 'safe';
    }
    if (r === currentStep && !gameOver) {
      return i === selectedTile ? 'selected' : 'unselected';
    }
    return 'idle';
  };

  // Handle result — process ONCE per bet. Do NOT call result.close() here.
  // Keeping the result state open (resolvedRef stays true inside
  // useGameResultFlow) prevents waitForDelegatedTx from calling settled() a
  // second time via its receipt fallback. result.close() is called by
  // handlePlay at the start of the next jump, at which point the async
  // waitForDelegatedTx chain has already fully exited.
  useEffect(() => {
    if (result.state?.phase !== 'result') return;
    if (resultHandledRef.current) return; // guard StrictMode double-run
    resultHandledRef.current = true;

    const payout = result.state.payout;
    const hasWon = payout > 0n;

    // Reveal this row: the player's pick decides where the croc lands on a
    // loss (they jumped right into it); on a win it stays safe and the rest
    // of this row's croc(s) are placed randomly among the other tiles.
    const tiles = STEPS[stepIdx].tiles;
    const crocsNeeded = STEPS[stepIdx].crocs;
    const sel = selectedTile;
    const crocs = new Set<number>();
    if (!hasWon) crocs.add(sel);
    while (crocs.size < crocsNeeded) {
      const idx = Math.floor(Math.random() * tiles);
      if (idx === sel) continue;
      crocs.add(idx);
    }
    setRowReveal((prev) => ({ ...prev, [stepIdx]: { crocs: Array.from(crocs), frog: sel } }));

    if (hasWon) {
      const reachesMaxStep = currentStep + 1 >= STEPS.length;
      playSfx('jump');
      if (reachesMaxStep) playSfx('coinRain');
      setTotalWon((prev) => prev + payout);
      setStakeWei(payout); // let it ride: next jump wagers exactly what you just won
      setAmount(fmtAmt(payout));
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length));
      if (reachesMaxStep) setGameOver('win');
    } else {
      playSfx('loss');
      setGameOver('loss');
      setStakeWei(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.state]);

  const handlePlay = async () => {
    if (inFlightRef.current || isProcessing || !!gameOver || isComplete) return;
    if (bet.needsApproval) {
      try { await bet.approveSelectedToken(); } catch (e: unknown) { result.error(extractRevertReason(e)); }
      return;
    }
    playClick();
    inFlightRef.current = true;
    resultHandledRef.current = false; // arm for the next result
    // Close any previous result now that waitForDelegatedTx is long gone.
    if (result.state !== null) result.close();
    setGameOver(null);
    setLoading(true);
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.crash); return; }
      // First jump of a fresh run: remember the typed amount so reset can restore it.
      if (stakeWei === null) baseAmountRef.current = amount;
      // Let it ride: once a run is going, wager the exact (unrounded) payout from
      // the previous jump rather than the rounded display string in `amount`.
      const playAmountStr = stakeWei !== null ? formatUnits(stakeWei, bet.decimals) : amount;
      const choice = encodeCrashChoice(BigInt(nextStep.multBps), 1);
      await bet.play(choice, playAmountStr, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  const handleReset = () => {
    playClick();
    if (result.state !== null) result.close();
    setCurrentStep(0);
    setGameOver(null);
    setStakeWei(null);
    setTotalWon(0n);
    setRowReveal({});
    setAmount(baseAmountRef.current);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Global gradient defs */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="frog-gold-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      <style>{`
        @keyframes tileBite {
          0%   { transform: rotate(0deg) scale(1); }
          30%  { transform: rotate(-10deg) scale(1.08); }
          60%  { transform: rotate(8deg) scale(0.94); }
          100% { transform: rotate(0deg) scale(1); }
        }
      `}</style>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes
            gameAddress={addresses.games.crash}
            renderOutcome={(o) => {
              const mult = (o / 100).toFixed(2);
              const isGood = o >= 200;
              return (
                <div className={`px-2 py-0.5 rounded-md font-bold text-[10px] mx-0.5 whitespace-nowrap
                  ${isGood ? 'text-green-400 bg-green-400/10' : 'text-zinc-400 bg-zinc-800'}`}>
                  {mult}x
                </div>
              );
            }}
          />
        </div>
        <GameInfoButton onClick={() => setShowInfoModal(true)} />
        <FastTxToggle disabled={isProcessing} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.crash} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: pyramid ── */}
      <div ref={towerCardRef} className="flex-1 relative overflow-hidden min-h-0 mx-2 sm:mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a] flex items-center justify-center">

        {/* Subtle radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-80 rounded-full bg-amber-500/4 blur-3xl" />
        </div>

        {/* Pyramid: row 0 (5 pads, 1.25x) at the bottom up to row 6 (2 pads, 2x) at the top */}
        <div
          ref={towerGroupRef}
          className="relative z-10 flex flex-col-reverse items-center gap-2 flex-shrink-0"
          style={{ transform: `scale(${towerScale})` }}
        >
          {STEPS.map((step, r) => (
            <div key={r} className="flex items-center gap-3">
              <div className="flex items-center justify-center" style={{ gap: TILE_GAP }}>
                {Array.from({ length: step.tiles }).map((_, i) => (
                  <Tile key={i} kind={tileKind(r, i)} onClick={() => { playClick(); setSelectedTile(i); }} />
                ))}
              </div>
              <div className="flex flex-col items-end w-12 flex-shrink-0">
                <span className="text-[11px] font-mono font-bold text-zinc-500 tabular-nums">
                  {step.display}
                </span>
                <span className="text-[9px] text-red-400/70 font-bold tracking-wide">
                  🐊×{step.crocs}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Spinning overlay */}
        {isProcessing && spinLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 backdrop-blur-sm z-20 rounded-2xl">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'rgba(222,188,110,0.6)', borderTopColor: 'transparent' }} />
              <p className="text-amber-300/70 text-sm font-medium tracking-widest uppercase animate-pulse">
                {spinLabel}
              </p>
            </div>
          </div>
        )}

        {/* Game-over overlay */}
        {gameOver && !isProcessing && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-20 rounded-2xl"
            style={{
              background: gameOver === 'win'
                ? 'radial-gradient(ellipse at center, rgba(34,197,94,0.15) 0%, transparent 70%)'
                : 'radial-gradient(ellipse at center, rgba(239,68,68,0.15) 0%, transparent 70%)',
              animation: 'resultFadeIn 0.35s ease-out both',
            }}
          >
            <div className={`text-6xl font-black tracking-tight ${gameOver === 'win' ? 'text-green-400' : 'text-red-400'}`}
              style={{ textShadow: gameOver === 'win' ? '0 0 40px rgba(74,222,128,0.6)' : '0 0 40px rgba(248,113,113,0.6)' }}>
              {gameOver === 'win' ? 'MAX WIN!' : 'CROC GOT YOU!'}
            </div>
            {gameOver === 'win' && totalWon > 0n && (
              <p className="mt-2 text-xl font-bold text-green-300">
                +{fmtAmt(totalWon)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
              </p>
            )}
            <button
              onClick={handleReset}
              className="mt-5 px-8 py-3.5 rounded-xl text-lg font-black uppercase tracking-wide text-[#1a1205] transition-transform hover:scale-105"
              style={{
                background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                boxShadow: '0 10px 28px rgba(0,0,0,0.9), 0 4px 10px rgba(0,0,0,0.8), 0 0 24px rgba(222,188,110,0.4), 0 0 60px rgba(222,188,110,0.15)',
              }}
            >
              Play again
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="flex-shrink-0 p-2 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-amber-400/10 sm:divide-y-0 sm:divide-x sm:divide-amber-400/10">

            {/* BET AMOUNT */}
            <div className="p-2.5 sm:p-4 space-y-1.5 sm:space-y-3">
              <p className="text-xs sm:text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Bet Amount
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-1 sm:py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" stroke="url(#frog-gold-grad)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount}
                  disabled={isProcessing || isActive}
                  onChange={(e) => {
                    if (result.state !== null) result.close();
                    setAmount(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-base sm:text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={isProcessing || isActive}
                    onClick={() => { playChip(); if (result.state !== null) result.close(); setAmount(v => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={isProcessing || isActive}
                    onClick={() => { playChip(); if (result.state !== null) result.close(); setAmount(v => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[...CHIP_VALUES, ...(bet.balanceWei ? ['MAX'] : [])].map((v) => {
                  const val = v === 'MAX' ? bet.maxAmount : v;
                  const active = amount === val;
                  return (
                    <button key={v}
                      disabled={isProcessing || isActive}
                      onClick={() => { playChip(); if (result.state !== null) result.close(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}>
                      {v}
                    </button>
                  );
                })}
              </div>
              {isActive && !gameOver && (
                <p className="text-[10px] sm:text-xs text-amber-500/70 font-medium">Bet locked during run</p>
              )}
            </div>

            {/* CURRENT STEP INFO */}
            <div className="p-2.5 sm:p-4 flex flex-col gap-1.5 sm:gap-3">
              <p className="text-xs sm:text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                {gameOver ? 'Result' : isActive ? 'Next Target' : 'First Step'}
              </p>

              <div className="flex-1 flex flex-row flex-wrap sm:flex-col items-center justify-center gap-3 sm:gap-2">
                {!gameOver ? (
                  <>
                    {!isActive && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Crocs / row</span>
                        <div className="flex rounded-md border border-zinc-700 overflow-hidden">
                          {([1, 2] as const).map((n) => (
                            <button
                              key={n}
                              type="button"
                              disabled={isProcessing}
                              onClick={() => { playClick(); setCrocCount(n); }}
                              className={`px-2.5 py-0.5 text-xs font-bold transition-colors disabled:opacity-40 ${crocCount === n ? 'text-[#1a1205]' : 'text-zinc-400 hover:text-zinc-200'}`}
                              style={crocCount === n ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-center">
                      <div className="text-2xl sm:text-4xl font-black tabular-nums"
                        style={{
                          background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                          WebkitBackgroundClip: 'text',
                          backgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                          filter: 'drop-shadow(0 0 8px rgba(222,188,110,0.3))',
                        }}>
                        {nextStep.display}
                      </div>
                      <div className="text-[10px] sm:text-xs text-zinc-500 font-medium tracking-wider uppercase">
                        {nextStep.label} of {STEPS.length}
                      </div>
                    </div>
                    {isActive && (
                      <button
                        onClick={handleReset}
                        disabled={isProcessing}
                        className="mt-1 px-4 py-1.5 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wide border transition-all disabled:opacity-40"
                        style={{
                          color: '#debc6e',
                          borderColor: 'rgba(222,188,110,0.45)',
                          background: 'rgba(222,188,110,0.08)',
                          boxShadow: '0 0 12px rgba(222,188,110,0.2)',
                        }}
                      >
                        Withdraw {amount} {bet.meta.symbol}
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <div className={`text-xl sm:text-3xl font-black ${gameOver === 'win' ? 'text-green-400' : 'text-red-400'}`}
                      style={{ textShadow: gameOver === 'win' ? '0 0 20px rgba(74,222,128,0.5)' : '0 0 20px rgba(248,113,113,0.5)' }}>
                      {gameOver === 'win' ? 'MAX WIN' : 'CROC GOT YOU'}
                    </div>
                    {gameOver === 'win' && totalWon > 0n && (
                      <p className="text-sm font-bold text-green-300">
                        +{fmtAmt(totalWon)} <span className="text-green-400/50">{bet.meta.symbol}</span>
                      </p>
                    )}
                    <button
                      onClick={handleReset}
                      className="mt-2 px-3 py-1 rounded text-xs font-bold border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors">
                      New run
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* JUMP button */}
            <div className="p-2 sm:p-4 flex items-center justify-center">
              <button
                onClick={gameOver ? handleReset : handlePlay}
                disabled={isProcessing || (!gameOver && (isComplete || bet.isApproving || bet.allowanceLoading))}
                className="relative w-full h-full min-h-[56px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-2 px-4 bg-[#0d0d0d]"
                style={{
                  border: '3px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  boxShadow: isProcessing
                    ? 'none'
                    : '0 0 24px rgba(222,188,110,0.25), 0 0 60px rgba(222,188,110,0.08), inset 0 0 20px rgba(222,188,110,0.04)',
                }}
              >
                <span className="text-2xl sm:text-5xl select-none" style={{ filter: 'drop-shadow(0 0 10px rgba(34,197,94,0.5))' }}>🐸</span>
                <span
                  className="font-black text-lg sm:text-3xl tracking-[0.1em] sm:tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5)) drop-shadow(0 0 24px rgba(222,188,110,0.25))',
                  }}
                >
                  {gameOver ? 'PLAY AGAIN' : bet.actionLabel('JUMP')}
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<Footprints className="w-4 h-4" />}
        title="Frogger"
        description="Frogger is a step-based 'let it ride' game played across 7 rows of lily pads, where each row hides one or more hungry crocodiles lurking beneath the pads. You pick a pad and jump, and if you land safely your entire stake — original bet plus everything won so far — automatically rides forward into the next row at a higher multiplier. Land on a croc at any point, however, and the whole run ends instantly with nothing returned, so every jump is a fresh decision between banking your progress and pushing for a bigger multiplier. You can choose to play with either 1 or 2 crocs hidden per row before starting a run, trading better odds for lower multipliers or worse odds for richer ones."
        steps={[
          'Pick a bet amount and decide how many crocs hide in each row — 1 croc per row is safer, 2 crocs per row pays more but is riskier.',
          'Choose any lily pad on the current row (the pad you pick is cosmetic styling for the animation; it does not change your odds) and tap Jump.',
          'If your jump lands safely, the full payout — your running stake — automatically becomes the wager for the next row, climbing the pyramid one step at a time.',
          'After any successful jump you may stop and cash out everything accumulated so far using the Withdraw button, locking in your winnings.',
          'If you ever land on a croc, the run ends immediately and everything staked in that run is lost; reaching Step 7 without hitting a croc pays out the maximum multiplier for that run.',
        ]}
        sections={[
          {
            title: 'Steps & Multipliers (1 croc/row)',
            content: (
              <>
                <div className="space-y-1.5">
                  {BASE_TILES.map((tiles, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-center text-[11px] rounded border border-zinc-800 px-2 py-1">
                      <div className="font-bold text-zinc-300">{STEP_LABELS[i]}</div>
                      <div className="text-zinc-400">{tiles} pads · 🐊×1</div>
                      <div className="text-amber-300 tabular-nums text-right">
                        {((tiles / (tiles - 1)) * 1).toFixed(2)}x
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 mt-2">
                  Each row's multiplier comes directly from its odds: with N pads and 1 hidden croc, the fair payout for surviving that row is N ÷ (N − 1). Choosing 2 crocs per row adds an extra pad to every row, which keeps the math fair but makes each step noticeably harder to clear and pushes every per-step multiplier higher to compensate.
                </p>
              </>
            ),
          },
          {
            title: 'Mechanics breakdown',
            content: (
              <div className="space-y-1.5 text-[11px] text-zinc-400">
                <p>
                  Frogger runs on the exact same underlying continuous-multiplier engine as Crash: each jump is evaluated as an independent draw against a target multiplier, so the chance of clearing any given row is mathematically tied to that row's displayed payout. There is no memory between rows beyond the stake you choose to carry forward — every jump is a clean, independent bet sized to whatever you currently have riding.
                </p>
                <p>
                  Because the stake compounds, late rows wager far more than your original bet, so the absolute amount at risk grows the further you push — even though each individual jump still resolves at fair, transparent odds.
                </p>
              </div>
            ),
          },
        ]}
        tip="Each successful jump's payout becomes the stake for the next jump. Cashing out early locks in a smaller, safer win; riding further multiplies your stake but risks losing the whole run to a single croc."
        rtp="~95.00%"
      />

    </div>
  );
}
