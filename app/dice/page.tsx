'use client';

import React, { useState, useRef, useEffect } from 'react';
import { CircleDollarSign, Dices } from 'lucide-react';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeDiceChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

// ── Constants ─────────────────────────────────────────────────────────────────

const CHIP_VALUES = ['1', '5', '10', '50', '100'];

const BET_TYPES = [
  { id: 0, label: 'EXACT SUM', short: 'SUM',    payout: null },   // dynamic
  { id: 1, label: 'HIGH',      short: 'HIGH',   payout: 230 },
  { id: 2, label: 'LOW',       short: 'LOW',    payout: 230 },
  { id: 3, label: 'EVEN',      short: 'EVEN',   payout: 192 },
  { id: 4, label: 'ODD',       short: 'ODD',    payout: 192 },
  { id: 5, label: 'ANY DOUBLE', short: 'DBL',   payout: 576 },
  { id: 6, label: 'EXACT DBL', short: 'XDBL',   payout: 3456 },
];

const EXACT_SUM_PAYOUTS = [0, 0, 3456, 1728, 1152, 864, 691, 576, 691, 864, 1152, 1728, 3456];

function getPayoutDisplay(betType: number, betData: number): string {
  if (betType === 0) {
    const p = EXACT_SUM_PAYOUTS[betData] ?? 0;
    return p ? `${(p / 100).toFixed(2)}x` : '—';
  }
  const found = BET_TYPES.find((b) => b.id === betType);
  return found?.payout ? `${(found.payout / 100).toFixed(2)}x` : '—';
}

// ── Dice face ─────────────────────────────────────────────────────────────────

const DOT_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [75, 25], [25, 75], [75, 75]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]],
};

// The "1" face uses the crown wildcard glyph instead of a plain dot, on every
// die face we render (flat previews, falling comets, and the 3D cube).
function FacePips({ value, size }: { value: number; size: number }) {
  const dots = DOT_POSITIONS[value] ?? [];
  const r = size * 0.08;
  if (value === 1) {
    const w = r * 6 * 0.8; // crown sized down 20% from a plain dot's footprint
    const h = w * (307 / 381);
    return <image href="/svg/wildcard.svg" x={50 - w / 2} y={50 - h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />;
  }
  return (
    <>
      {dots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#1a1a1a" />
      ))}
    </>
  );
}

function DieFace({ value, size = 64, glow }: { value: number; size?: number; glow?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{
        borderRadius: '11%',
        background: '#fdf8ec',
        boxShadow: glow
          ? `0 4px 20px rgba(0,0,0,0.5), 0 0 24px ${glow}`
          : '0 4px 20px rgba(0,0,0,0.4)',
        flexShrink: 0,
      }}
    >
      <FacePips value={value} size={size} />
    </svg>
  );
}

// ── 3D rolling die (CSS cube) ────────────────────────────────────────────────
// Each face of an actual 6-sided cube is rendered and rotated in 3D space;
// while `rolling` it tumbles continuously via rAF, then on settling it spins
// forward (never snapping backward) until the target face points at the
// viewer — driven by direct DOM writes so the hand-off has no visual pop.

const FACE_PLACEMENT: Record<number, (half: number) => string> = {
  1: (half) => `translateZ(${half}px)`,
  6: (half) => `rotateX(180deg) translateZ(${half}px)`,
  2: (half) => `rotateX(-90deg) translateZ(${half}px)`,
  5: (half) => `rotateX(90deg) translateZ(${half}px)`,
  3: (half) => `rotateY(90deg) translateZ(${half}px)`,
  4: (half) => `rotateY(-90deg) translateZ(${half}px)`,
};

const DIE_SETTLE_MS = 700; // must match the transition duration below

// Inverse of FACE_PLACEMENT: the cube rotation that brings each face to front.
const SHOW_ROTATION: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 180, y: 0 },
  2: { x: 90, y: 0 },
  5: { x: -90, y: 0 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
};

function Die3D({ value, size = 64, glow, rolling }: { value?: number; size?: number; glow?: string; rolling?: boolean }) {
  const half = size / 2;
  const cubeRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef({ x: -18, y: 28 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const angle = angleRef.current;
    cancelAnimationFrame(rafRef.current);

    if (rolling) {
      // Normalize so the angle doesn't grow without bound across many rolls.
      angle.x = ((angle.x % 360) + 360) % 360;
      angle.y = ((angle.y % 360) + 360) % 360;
      if (cubeRef.current) {
        cubeRef.current.style.transition = 'none';
        cubeRef.current.style.transform = `rotateX(${angle.x}deg) rotateY(${angle.y}deg)`;
      }
      let last = performance.now();
      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        angle.x += 0.5 * dt;
        angle.y += 0.34 * dt;
        if (cubeRef.current) cubeRef.current.style.transform = `rotateX(${angle.x}deg) rotateY(${angle.y}deg)`;
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else if (value) {
      // Spin forward to the next pass through the target angle (plus one
      // extra full turn for flourish) — continuing from wherever it was.
      const show = SHOW_ROTATION[value] ?? { x: 0, y: 0 };
      const targetX = Math.ceil(angle.x / 360) * 360 + 360 + show.x;
      const targetY = Math.ceil(angle.y / 360) * 360 + 360 + show.y;
      angle.x = targetX;
      angle.y = targetY;
      if (cubeRef.current) {
        cubeRef.current.style.transition = `transform ${DIE_SETTLE_MS}ms cubic-bezier(0.22,1,0.36,1)`;
        cubeRef.current.style.transform = `rotateX(${targetX}deg) rotateY(${targetY}deg)`;
      }
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [rolling, value]);

  return (
    <div
      style={{
        width: size,
        height: size,
        perspective: size * 5,
        filter: glow && !rolling
          ? `drop-shadow(0 4px 16px rgba(0,0,0,0.5)) drop-shadow(0 0 20px ${glow})`
          : 'drop-shadow(0 4px 16px rgba(0,0,0,0.4))',
        flexShrink: 0,
      }}
    >
      <div
        ref={cubeRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${angleRef.current.x}deg) rotateY(${angleRef.current.y}deg)`,
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((v) => (
          <div
            key={v}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: size * 0.11,
              background: '#fdf8ec',
              backfaceVisibility: 'hidden',
              transform: FACE_PLACEMENT[v](half),
            }}
          >
            <svg width="100%" height="100%" viewBox="0 0 100 100">
              <FacePips value={v} size={size} />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DicePage() {
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.diceGame);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.diceGame);
  const { playClick, playChip, playSfx, playFading } = useGameAudio('dice');
  // Handles for the in-flight result sound(s) (defaultResult / coinRain), so
  // pressing ROLL again always cuts them off instead of letting a previous
  // win/loss sound ring out underneath the next roll.
  const resultSoundHandlesRef = useRef<{ stop: (fadeMs?: number) => void }[]>([]);

  const [betType, setBetType] = useState<number>(1); // HIGH default
  const [betData, setBetData] = useState<number>(7); // default sum=7 / double=1
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showResultText, setShowResultText] = useState(false);

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
  const isWin    = isResult && resultPayout !== undefined && resultTotalBet !== undefined && resultPayout > resultTotalBet;
  const isTie    = isResult && resultPayout !== undefined && resultTotalBet !== undefined && resultPayout > BigInt(0) && resultPayout <= resultTotalBet;
  const isLoss   = isResult && (resultPayout === undefined || resultPayout === BigInt(0));

  // Hold the WIN/LOSS text (and its sound) until the dice have visibly
  // finished settling, plus a beat — instead of popping in/playing the
  // instant the chain result lands, ahead of the 3D dice animation.
  useEffect(() => {
    if (!isResult) { setShowResultText(false); return; }
    const t = setTimeout(() => {
      setShowResultText(true);
      const handles = [playFading('defaultResult'), isWin ? playFading('coinRain') : null]
        .filter((h): h is { stop: (fadeMs?: number) => void } => h !== null);
      resultSoundHandlesRef.current = handles;
    }, DIE_SETTLE_MS + 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResult]);

  // outcome = die1 * 10 + die2
  const outcomeRaw = result.state?.phase === 'result' ? Number(result.state.outcomes?.[0] ?? 0) : 0;
  const die1 = Math.floor(outcomeRaw / 10);
  const die2 = outcomeRaw % 10;
  const diceSum = die1 + die2;

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…'  :
    resultPhase === 'waiting-settle' ? 'Confirming…'   :
    resultPhase === 'settling'       ? 'Rolling…'      : '';

  const resultColor = isWin ? '#4ade80' : isTie ? '#d4a017' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : isTie ? 'rgba(212,160,23,0.45)' : 'rgba(248,113,113,0.5)';
  const resultLabel = isWin ? 'WIN' : isTie ? 'TIE' : 'LOSS';

  const currentPayout = getPayoutDisplay(betType, betData);

  // betData is only relevant for EXACT_SUM (0) and EXACT_DOUBLE (6)
  const effectiveBetData = betType === 0 ? betData : betType === 6 ? betData : 0;

  const handlePlay = async () => {
    if (bet.needsApproval) {
      try { await bet.approveSelectedToken(); } catch (e: unknown) { result.error(extractRevertReason(e)); }
      return;
    }
    playClick();
    resultSoundHandlesRef.current.forEach((h) => h.stop(80));
    resultSoundHandlesRef.current = [];
    if (result.state !== null) result.close();
    setLoading(true);
    playSfx('roll');
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.diceGame); return; }
      const gameChoice = encodeDiceChoice(betType, effectiveBetData, 1);
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-dice" x1="0" y1="0" x2="1" y2="1">
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
            gameAddress={addresses.games.diceGame}
            renderOutcome={(o) => {
              const d1 = Math.floor(o / 10);
              const d2 = o % 10;
              const sum = d1 + d2;
              const isDouble = d1 === d2;
              return (
                <div
                  className={`h-6 px-1.5 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 tabular-nums ${
                    isDouble
                      ? 'bg-amber-400/10 text-amber-300 border-amber-500/30'
                      : sum >= 8
                      ? 'bg-green-400/10 text-green-400 border-green-500/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-600'
                  }`}
                >
                  {d1}+{d2}
                </div>
              );
            }}
          />
        </div>
        <GameInfoButton onClick={() => setShowInfoModal(true)} />
        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.diceGame} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: dice display ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex items-center justify-center border border-amber-400/25 bg-[#0a0a0a]">

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-64 h-64 rounded-full blur-3xl transition-colors duration-700"
            style={{
              background: isWin  ? 'rgba(74,222,128,0.07)'
                        : isTie  ? 'rgba(212,160,23,0.07)'
                        : isLoss ? 'rgba(248,113,113,0.07)'
                        : 'rgba(200,146,10,0.05)',
            }}
          />
        </div>

        {/* Falling dice comets */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[
            { size: 24, left: '12%', delay: '0s', dur: '6s', spinDur: '3.2s', val: 4 },
            { size: 18, left: '28%', delay: '1.8s', dur: '7s', spinDur: '2.8s', val: 2 },
            { size: 32, left: '72%', delay: '0.5s', dur: '5.5s', spinDur: '4.5s', val: 6 },
            { size: 16, left: '85%', delay: '3s', dur: '8s', spinDur: '2.5s', val: 1 },
            { size: 22, left: '50%', delay: '2.5s', dur: '6.5s', spinDur: '3s', val: 5 },
            { size: 14, left: '38%', delay: '4s', dur: '7.5s', spinDur: '2.2s', val: 3 },
            { size: 28, left: '92%', delay: '1s', dur: '5s', spinDur: '4s', val: 4 },
            { size: 20, left: '5%', delay: '3.5s', dur: '6.8s', spinDur: '2.7s', val: 2 },
          ].map((c, i) => (
            <div
              key={i}
              className="absolute opacity-[0.06]"
              style={{
                left: c.left,
                top: '-40px',
                width: c.size,
                height: c.size,
                animation: `coinFall ${c.dur} linear ${c.delay} infinite`,
              }}
            >
              <div
                className="w-full h-full"
                style={{
                  animation: `coinSpinFast ${c.spinDur} linear infinite`,
                  transformOrigin: 'center',
                }}
              >
                <DieFace value={c.val} size={c.size} />
              </div>
            </div>
          ))}
        </div>

        <div className="relative z-10 flex flex-col items-center gap-6">
          {/* Dice pair */}
          <div className="flex items-center gap-15">
            {loading ? (
              <Die3D rolling size={110} />
            ) : isResult && die1 > 0 ? (
              <Die3D value={die1} size={110} glow={resultGlow} />
            ) : (
              <DieFace value={1} size={110} />
            )}
            {loading ? (
              <Die3D rolling size={110} />
            ) : isResult && die2 > 0 ? (
              <Die3D value={die2} size={110} glow={resultGlow} />
            ) : (
              <DieFace value={1} size={110} />
            )}
          </div>

          {/* Status / result */}
          {loading && spinLabel && (
            <p className="text-amber-300/40 text-xs font-medium animate-pulse tracking-widest uppercase">
              {spinLabel}
            </p>
          )}

          {showResultText && isResult && (
            <div
              className="flex flex-col items-center gap-1"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              <div
                className="text-6xl font-black tracking-tight"
                style={{ color: resultColor, textShadow: `0 0 32px ${resultGlow}` }}
              >
                {resultLabel}
              </div>
              {die1 > 0 && (
                <span className="text-zinc-500 text-lg font-bold">
                  Sum: <span className="text-zinc-200">{diceSum}</span>
                  {die1 === die2 && (
                    <span className="ml-2 text-amber-400 text-sm">Double!</span>
                  )}
                </span>
              )}
              {isWin && resultPayout !== undefined && (
                <p className="text-base font-bold text-green-300">
                  +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                </p>
              )}
              {isLoss && resultTotalBet !== undefined && (
                <p className="text-xs text-zinc-400">
                  −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                </p>
              )}
            </div>
          )}

          {!isResult && !loading && (
            <p className="text-zinc-700 text-xs tracking-widest uppercase">
              {BET_TYPES.find((b) => b.id === betType)?.label}
              {betType === 0 && ` · Sum ${betData}`}
              {betType === 6 && ` · ${betData}s`}
              {' · '}{currentPayout}
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
            <button
              onClick={() => result.close()}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div className="flex-shrink-0 p-2 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-amber-400/10 sm:divide-y-0 sm:divide-x sm:divide-amber-400/10">

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
                <CircleDollarSign
                  className="w-5 h-5 shrink-0"
                  stroke="url(#gold-icon-grad-dice)"
                  strokeWidth={2}
                />
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

            {/* BET TYPE */}
            <div className="p-4 space-y-2 relative">
              <div className="flex items-center justify-between">
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
                  Bet Type
                </p>
              </div>

              {/* Type buttons */}
              <div className="grid grid-cols-4 gap-1">
                {BET_TYPES.filter(bt => [1, 2, 3, 4].includes(bt.id)).map((bt) => {
                  const active = betType === bt.id;
                  return (
                    <button
                      key={bt.id}
                      disabled={loading}
                      onClick={() => { playClick(); setBetType(bt.id); }}
                      className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? 'border-transparent text-[#1a1205]'
                          : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600'
                      }`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >
                      <span className="text-xs font-black leading-none">{bt.short}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {BET_TYPES.filter(bt => [0, 5, 6].includes(bt.id)).map((bt) => {
                  const active = betType === bt.id;
                  return (
                    <button
                      key={bt.id}
                      disabled={loading}
                      onClick={() => {
                        playClick();
                        setBetType(bt.id);
                        if (bt.id === 0 && (betData < 2 || betData > 12)) setBetData(7);
                        if (bt.id === 6 && (betData < 1 || betData > 6)) setBetData(1);
                      }}
                      className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? 'border-transparent text-[#1a1205]'
                          : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600'
                      }`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >
                      <span className="text-xs font-black leading-none">{bt.short}</span>
                    </button>
                  );
                })}
              </div>

              {/* Conditional: sum picker for EXACT_SUM */}
              {betType === 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest">Target Sum</p>
                  <div className="grid grid-cols-11 gap-1">
                    {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => {
                      const active = betData === s;
                      return (
                        <button
                          key={s}
                          disabled={loading}
                          onClick={() => { playClick(); setBetData(s); }}
                          className={`h-8 rounded text-xs font-bold border transition-all disabled:opacity-40 ${
                            active
                              ? 'border-transparent text-[#1a1205]'
                              : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600'
                          }`}
                          style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Conditional: double picker for EXACT_DOUBLE */}
              {betType === 6 && (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-500 uppercase tracking-widest">Double Value</p>
                  <div className="grid grid-cols-6 gap-1">
                    {[1, 2, 3, 4, 5, 6].map((d) => {
                      const active = betData === d;
                      return (
                        <button
                          key={d}
                          disabled={loading}
                          onClick={() => { playClick(); setBetData(d); }}
                          className={`h-8 rounded text-xs font-bold border transition-all disabled:opacity-40 ${
                            active
                              ? 'border-transparent text-[#1a1205]'
                              : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600'
                          }`}
                          style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                        >
                          {d}s
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* PLAY */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading || bet.isApproving || bet.allowanceLoading}
                className="relative w-full h-full min-h-[56px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-2 px-4 bg-[#0d0d0d]"
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
                <div className="flex gap-2">
                  <DieFace value={die1 > 0 && isResult ? die1 : 3} size={28} />
                  <DieFace value={die2 > 0 && isResult ? die2 : 4} size={28} />
                </div>
                <span
                  className="font-black text-xl sm:text-3xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5))',
                  }}
                >
                  {bet.actionLabel('ROLL')}
                </span>
                <span className="text-[10px] text-zinc-500 font-medium">{currentPayout}</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<Dices className="w-4 h-4" />}
        title="Dice"
        description="Dice is played with two standard six-sided dice (d6 + d6), rolled together on every wager. Before rolling you choose a bet type — the exact sum, a high/low range, even/odd, any double, or one specific double — and the contract draws both dice independently and pays out automatically based on which category the result falls into. Because there are 36 equally likely combinations of two dice, every bet type's odds are fixed and fully calculable, and the payout for each one is set so the house keeps a small, consistent edge no matter which bet you choose. Sums cluster around 7, which is the most common total, so bets covering the middle of the range hit more often but pay less, while rarer outcomes like exact doubles pay far more."
        steps={[
          'Set your bet amount using the chip buttons or the input field.',
          'Pick a bet type: EXACT SUM, HIGH, LOW, EVEN, ODD, ANY DOUBLE, or EXACT DOUBLE.',
          'If you picked EXACT SUM or EXACT DOUBLE, also choose the specific target sum (2-12) or double value (1-6).',
          'Press Roll to submit your bet — both dice are rolled together on-chain.',
          'The combined result decides the outcome: matching your bet type pays out at that bet\'s fixed multiplier, and any other result loses the stake.',
        ]}
        sections={[
          {
            title: 'Bet types & payouts',
            content: (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">HIGH — sum 8 to 12 (a sum of 7 always loses this bet)</span>
                  <span className="text-amber-300 font-bold">2.30×</span>
                </div>
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">LOW — sum 2 to 6 (a sum of 7 always loses this bet)</span>
                  <span className="text-amber-300 font-bold">2.30×</span>
                </div>
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">EVEN — combined sum is even</span>
                  <span className="text-amber-300 font-bold">1.92×</span>
                </div>
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">ODD — combined sum is odd</span>
                  <span className="text-amber-300 font-bold">1.92×</span>
                </div>
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">ANY DOUBLE — both dice show the same value</span>
                  <span className="text-amber-300 font-bold">5.76×</span>
                </div>
                <div className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="text-zinc-400">EXACT DOUBLE — a specific double you choose (e.g. double-6)</span>
                  <span className="text-amber-300 font-bold">34.56×</span>
                </div>
                <p className="text-[10px] text-zinc-500 pt-1">
                  HIGH and LOW exclude sum 7 entirely — rolling a 7 loses both bets even though it sits between the two ranges, which is what keeps their odds (and payout) matched to EVEN/ODD rather than paying out more often than they should.
                </p>
              </div>
            ),
          },
          {
            title: 'Exact sum payouts (target 2-12)',
            content: (
              <div className="grid grid-cols-4 gap-1 text-[11px]">
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => (
                  <div key={s} className="flex flex-col items-center rounded border border-zinc-800 px-1.5 py-1">
                    <span className="text-zinc-500">Sum {s}</span>
                    <span className="text-amber-300 font-bold tabular-nums">
                      {((EXACT_SUM_PAYOUTS[s] ?? 0) / 100).toFixed(2)}x
                    </span>
                  </div>
                ))}
              </div>
            ),
          },
        ]}
        tip="Sums near 7 (6, 7, 8) are rolled far more often than extreme sums like 2 or 12, which is why the exact-sum payout table pays much more for the rare edge totals than for the common middle ones — every bet type is priced so the long-run edge stays the same regardless of which you pick."
        rtp="~96.00%"
      />
    </div>
  );
}
