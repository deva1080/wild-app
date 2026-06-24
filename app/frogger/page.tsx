'use client';

import { useState, useEffect, useRef } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeCrashChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const STEP_HEIGHT = 52;
const STEP_GAP = 8;
const STEP_PITCH = STEP_HEIGHT + STEP_GAP;
const GROUND_OFFSET = STEP_PITCH; // extra space below step 1 so frog starts on ground

// Steps: mult in bps (110 = 1.10x), label shown in UI
const STEPS = [
  { label: 'Step 1', multBps: 110, display: '1.10x' },
  { label: 'Step 2', multBps: 135, display: '1.35x' },
  { label: 'Step 3', multBps: 175, display: '1.75x' },
  { label: 'Step 4', multBps: 250, display: '2.50x' },
  { label: 'Step 5', multBps: 400, display: '4.00x' },
  { label: 'Step 6', multBps: 700, display: '7.00x' },
  { label: 'Step 7', multBps: 1500, display: '15.00x' },
];

// ── Lily Pad SVG ─────────────────────────────────────────────────────────────
function LilyPad({
  state,
  label,
  mult,
  isCurrent,
  isProcessing,
}: {
  state: 'future' | 'current' | 'passed';
  label: string;
  mult: string;
  isCurrent: boolean;
  isProcessing: boolean;
}) {
  const isPassed = state === 'passed';
  const isFut = state === 'future';

  return (
    <div
      className="relative flex items-center justify-between px-6 rounded-xl transition-all duration-500"
      style={{
        height: 52,
        // Longhand background-* only (no `background` shorthand) — mixing
        // shorthand and longhand in the same style object across re-renders
        // (e.g. when "Play again" flips isCurrent/isPassed) confuses React's
        // incremental style diffing and can leave stale gradients behind.
        backgroundColor: isPassed ? undefined : isCurrent ? '#0d0d0d' : 'rgba(255,255,255,0.02)',
        backgroundImage: isPassed
          ? 'linear-gradient(90deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%)'
          : isCurrent
          ? 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(90deg, #debc6e, #8c6825)'
          : undefined,
        border: isPassed
          ? '1px solid rgba(34,197,94,0.35)'
          : isCurrent
          ? '2px solid transparent'
          : '1px solid rgba(255,255,255,0.06)',
        backgroundOrigin: isCurrent ? 'border-box' : undefined,
        backgroundClip: isCurrent ? 'padding-box, border-box' : undefined,
        boxShadow: isCurrent
          ? '0 0 20px rgba(222,188,110,0.18), 0 0 50px rgba(222,188,110,0.06)'
          : undefined,
        animation: isProcessing && isCurrent ? 'lilyPulse 1.4s ease-in-out infinite' : undefined,
      }}
    >
      <span
        className="text-sm font-black tracking-wider"
        style={{
          color: isPassed ? '#4ade80' : isCurrent ? '#debc6e' : 'rgba(255,255,255,0.25)',
        }}
      >
        {label}
      </span>
      <span
        className="font-mono font-bold text-base"
        style={{
          color: isPassed ? '#4ade80' : isCurrent ? '#debc6e' : 'rgba(255,255,255,0.2)',
          textShadow: isCurrent ? '0 0 12px rgba(222,188,110,0.4)' : undefined,
        }}
      >
        {mult}
      </span>
      {isPassed && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold">✓</div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FroggerPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.crash);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.crash);

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0); // 0 = not started, 1–7 = on that step
  const [lastPayout, setLastPayout] = useState<bigint | null>(null);
  const [gameOver, setGameOver] = useState<'win' | 'loss' | null>(null);
  // Let-it-ride stake: once a run is going, each jump wagers exactly what the
  // previous jump paid out. null = no run in progress (use the typed `amount`).
  const [stakeWei, setStakeWei] = useState<bigint | null>(null);
  // Sum of every payout collected so far in the current run (what the "how
  // much you won" indicators show, not just the most recent jump's payout).
  const [totalWon, setTotalWon] = useState<bigint>(0n);
  // The amount the player typed before starting the run, restored on reset.
  const baseAmountRef = useRef('1');
  const inFlightRef = useRef(false);
  // Prevents double-processing the same result state (React StrictMode runs
  // effects twice in dev, and waitForDelegatedTx can call settled() a second
  // time via its receipt fallback if result.close() was called mid-flight).
  const resultHandledRef = useRef(false);

  // Auto-shrink the frog/tower visual to whatever space the card actually has,
  // so it always fits on screen with no scroll instead of clipping or overflowing.
  const towerCardRef = useRef<HTMLDivElement>(null);
  const towerGroupRef = useRef<HTMLDivElement>(null);
  const [towerScale, setTowerScale] = useState(1);

  useEffect(() => {
    const card = towerCardRef.current;
    const group = towerGroupRef.current;
    if (!card || !group) return;
    const BREATHING_ROOM = 32; // px of padding to keep around the scaled tower
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

    if (hasWon) {
      setLastPayout(payout);
      setTotalWon((prev) => prev + payout);
      setStakeWei(payout); // let it ride: next jump wagers exactly what you just won
      setAmount(fmtAmt(payout));
      setCurrentStep((prev) => {
        const next = Math.min(prev + 1, STEPS.length);
        if (next >= STEPS.length) setGameOver('win');
        return next;
      });
    } else {
      setGameOver('loss');
      setLastPayout(null);
      setStakeWei(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.state]);

  const handlePlay = async () => {
    if (!address || inFlightRef.current || isProcessing || !!gameOver || isComplete) return;
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
    if (result.state !== null) result.close();
    setCurrentStep(0);
    setLastPayout(null);
    setGameOver(null);
    setStakeWei(null);
    setTotalWon(0n);
    setAmount(baseAmountRef.current);
  };

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-7xl select-none" style={{ filter: 'drop-shadow(0 0 24px rgba(34,197,94,0.4))' }}>🐸</div>
        <h1
          className="text-[42px] font-black uppercase tracking-tight"
          style={{
            background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',
          }}
        >Frogger</h1>
        <p className="text-zinc-400 text-center max-w-xs">Hop step by step up the multiplier tower. Each leap is a separate bet.</p>
        <WalletButton />
      </div>
    );
  }

  // Frog vertical position: currentStep=0 is ground; each successful jump moves
  // exactly one pitch up (1 pad).
  const frogBottomPx = currentStep * STEP_PITCH + 4;
  const towerHeight = STEPS.length * STEP_PITCH + GROUND_OFFSET + 8;

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
        @keyframes lilyPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(222,188,110,0.18), 0 0 50px rgba(222,188,110,0.06); }
          50%       { box-shadow: 0 0 32px rgba(222,188,110,0.40), 0 0 80px rgba(222,188,110,0.15); }
        }
        @keyframes frogBounce {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-6px); }
        }
        @keyframes frogCrash {
          0%   { transform: rotate(0deg) scale(1); }
          30%  { transform: rotate(-15deg) scale(1.1); }
          60%  { transform: rotate(15deg) scale(0.9); }
          100% { transform: rotate(0deg) scale(1); }
        }
      `}</style>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={isProcessing} />
        <div className="flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
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
        <FastTxToggle disabled={isProcessing} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.crash} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: tower ── */}
      <div ref={towerCardRef} className="flex-1 relative overflow-hidden min-h-0 mx-2 sm:mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a] flex items-center justify-center">

        {/* Subtle radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-80 rounded-full bg-amber-500/4 blur-3xl" />
        </div>

        {/* Tower */}
        <div
          ref={towerGroupRef}
          className="relative z-10 flex items-end gap-5 px-6 flex-shrink-0"
          style={{ transform: `scale(${towerScale}) translateY(-8px)` }}
        >

          {/* Frog column */}
          <div className="relative w-10 flex-shrink-0" style={{ height: towerHeight }}>
            <div
              className="absolute left-0 w-10 h-10 flex items-center justify-center text-2xl select-none transition-all duration-500 ease-out"
              style={{
                bottom: frogBottomPx,
                animation: gameOver === 'loss'
                  ? 'frogCrash 0.5s ease-in-out'
                  : isActive && !isProcessing
                  ? 'frogBounce 2s ease-in-out infinite'
                  : 'none',
                filter: gameOver === 'loss'
                  ? 'grayscale(1) opacity(0.4)'
                  : 'drop-shadow(0 0 8px rgba(34,197,94,0.5))',
              }}
            >
              {gameOver === 'loss' ? '💀' : '🐸'}
            </div>
            {/* Vertical track */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-0.5 rounded-full"
              style={{
                top: 0,
                bottom: 0,
                background: 'linear-gradient(to bottom, rgba(222,188,110,0.3), rgba(222,188,110,0.05))',
              }}
            />
          </div>

          {/* Steps column */}
          <div className="flex flex-col-reverse gap-2" style={{ width: 320, paddingBottom: GROUND_OFFSET }}>
            {STEPS.map((step, idx) => {
              const state =
                idx < currentStep ? 'passed'
                : idx === currentStep && !gameOver ? 'current'
                : 'future';
              return (
                <LilyPad
                  key={idx}
                  state={state}
                  label={step.label}
                  mult={step.display}
                  isCurrent={state === 'current'}
                  isProcessing={isProcessing}
                />
              );
            })}
          </div>

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
              {gameOver === 'win' ? 'MAX WIN!' : 'CRASHED!'}
            </div>
            {gameOver === 'win' && totalWon > 0n && (
              <p className="mt-2 text-xl font-bold text-green-300">
                +{fmtAmt(totalWon)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
              </p>
            )}
            <button
              onClick={handleReset}
              className="mt-5 px-5 py-2 rounded-lg text-sm font-bold text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-white transition-colors"
            >
              Play again
            </button>
          </div>
        )}

        {/* Step cleared feedback */}
        {!gameOver && lastPayout && !isProcessing && currentStep > 0 && (
          <div className="absolute top-4 right-4 z-10 rounded-lg px-4 py-2 text-sm font-bold font-mono"
            style={{
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.4)',
              color: '#4ade80',
              animation: 'resultFadeIn 0.3s ease-out both',
            }}
          >
            +{fmtAmt(totalWon)} {bet.meta.symbol}
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
                    onClick={() => { if (result.state !== null) result.close(); setAmount(v => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={isProcessing || isActive}
                    onClick={() => { if (result.state !== null) result.close(); setAmount(v => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
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
                      onClick={() => { if (result.state !== null) result.close(); setAmount(val); }}
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

              <div className="flex-1 flex flex-col items-center justify-center gap-1 sm:gap-2">
                {!gameOver ? (
                  <>
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
                    {isActive && (
                      <button
                        onClick={handleReset}
                        disabled={isProcessing}
                        className="mt-1 px-3 py-1 rounded text-xs font-bold border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                      >
                        Reset run
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <div className={`text-xl sm:text-3xl font-black ${gameOver === 'win' ? 'text-green-400' : 'text-red-400'}`}
                      style={{ textShadow: gameOver === 'win' ? '0 0 20px rgba(74,222,128,0.5)' : '0 0 20px rgba(248,113,113,0.5)' }}>
                      {gameOver === 'win' ? 'MAX WIN' : 'CRASHED'}
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
                onClick={handlePlay}
                disabled={isProcessing || !!gameOver || isComplete}
                className="relative w-full h-full min-h-[64px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1 sm:gap-2 bg-[#0d0d0d]"
                style={{
                  border: '3px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  boxShadow: (isProcessing || !!gameOver)
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
                  JUMP
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
