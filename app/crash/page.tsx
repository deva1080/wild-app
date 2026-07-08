'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Rocket, CircleDollarSign } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
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
import { useGameAudio } from '@/lib/sound/useGameAudio';
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const MULT_OPTIONS = [110, 150, 200, 500, 1000, 5000];

/** Format basis-point multiplier → "2.45x" */
function fmtMult(bp: number): string {
  return (bp / 100).toFixed(2) + 'x';
}

// ── Starfield Background ──────────────────────────────────────────────────────

function Starfield({ intensity }: { intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<{ x: number; y: number; z: number; color: number }[]>([]);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const maxStars = 200;
    if (starsRef.current.length === 0) {
      for (let i = 0; i < maxStars; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.offsetWidth,
          y: Math.random() * canvas.offsetHeight,
          z: Math.random(),
          color: Math.random(),
        });
      }
    }

    let lastTime = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(now - lastTime, 50) / 1000;
      lastTime = now;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      ctx.clearRect(0, 0, w, h);

      const speed = 20 + intensity * 400;
      const count = Math.min(Math.floor(30 + intensity * 170), maxStars);
      const stars = starsRef.current;

      for (let i = 0; i < count; i++) {
        const s = stars[i];
        s.x -= (s.z * 0.5 + 0.5) * speed * dt;

        if (s.x < -4) {
          s.x = w + 4;
          s.y = Math.random() * h;
          s.z = Math.random();
          s.color = Math.random();
        }

        const tailLen = intensity * s.z * 30;
        const size = 0.5 + s.z * 1.8;
        const alpha = 0.15 + s.z * 0.5 + intensity * 0.3;

        let r = 255, g = 255, b = 255;
        if (intensity > 0.3) {
          const ci = s.color;
          if (ci < 0.25) { r = 222; g = 188; b = 110; }
          else if (ci < 0.45) { r = 140; g = 104; b = 37; }
          else if (ci < 0.55 && intensity > 0.6) { r = 74; g = 222; b = 128; }
          else if (ci < 0.62 && intensity > 0.8) { r = 248; g = 113; b = 113; }
          else if (ci < 0.68 && intensity > 0.9) { r = 147; g = 130; b = 255; }
        }

        if (tailLen > 1) {
          const grad = ctx.createLinearGradient(s.x, s.y, s.x + tailLen, s.y);
          grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(s.x, s.y - size / 2, tailLen, size);
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

// ── Crash Chart ──────────────────────────────────────────────────────────────

function CrashChart({
  displayMult,
  targetMult,
  refMult,
  animating,
  showFinalResult,
  isWin,
  loading,
  width,
  height,
}: {
  displayMult: number;
  targetMult: number;
  refMult: number;
  animating: boolean;
  showFinalResult: boolean;
  isWin: boolean;
  loading: boolean;
  width: number;
  height: number;
}) {
  const W = width || 800, H = height || 220;
  const padL = 46, padB = 40, padT = 32, padR = 16;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const isActive = animating || showFinalResult;
  const effectiveMult = isActive ? targetMult : refMult;
  const maxY = Math.max(Math.ceil(effectiveMult / 100) + 1, 3);

  // Y-axis ticks
  const step = maxY <= 5 ? 1 : maxY <= 10 ? 2 : Math.ceil(maxY / 5);
  const yTicks: number[] = [];
  for (let v = 0; v <= maxY; v += step) yTicks.push(v);

  // Progress 0–1 from displayMult
  const progress = isActive
    ? Math.min((displayMult - 100) / Math.max(targetMult - 100, 1), 1)
    : 0;

  // Tip Y coordinate (where multiplier sits on the Y-axis)
  const tipFrac = Math.min((displayMult / 100 - 1) / (maxY - 1), 1);
  const tipX = padL + progress * cW;
  const tipY = padT + cH - tipFrac * cH;

  // Cubic bezier: flat start, steep finish — exponential shape
  const cp1x = padL + progress * cW * 0.68;
  const cp1y = padT + cH;
  const cp2x = tipX;
  const cp2y = tipY + (padT + cH - tipY) * 0.28;
  const curvePath = `M ${padL},${padT + cH} C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}`;

  // Area fill path (closed below the curve)
  const areaPath = `${curvePath} L ${tipX.toFixed(1)},${padT + cH} Z`;

  const lineColor = showFinalResult
    ? (isWin ? '#4ade80' : '#f87171')
    : '#d4a017';
  const glowId = 'cglow';
  const gradId = 'cgrad';
  const fillId = 'cfill';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Horizontal grid + Y-axis labels */}
      {yTicks.map((v) => {
        const y = padT + cH - (v / maxY) * cH;
        return (
          <g key={v}>
            <line
              x1={padL} y1={y} x2={W - padR} y2={y}
              stroke="rgba(255,255,255,0.055)" strokeWidth="1"
            />
            <text
              x={padL - 6} y={y + 4}
              fill="rgba(255,255,255,0.28)"
              fontSize="10" textAnchor="end" fontFamily="monospace"
            >
              {v === 0 ? '0x' : `${v}x`}
            </text>
          </g>
        );
      })}

      {/* Baseline */}
      <line
        x1={padL} y1={padT + cH} x2={W - padR} y2={padT + cH}
        stroke="rgba(255,255,255,0.09)" strokeWidth="1"
      />

      {/* Curve area fill */}
      {isActive && progress > 0 && (
        <path d={areaPath} fill={`url(#${fillId})`} />
      )}

      {/* Curve glow layer */}
      {isActive && progress > 0 && (
        <path
          d={curvePath}
          fill="none"
          stroke={lineColor}
          strokeWidth="7"
          strokeOpacity="0.15"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
      )}

      {/* Curve main line */}
      {isActive && progress > 0 && (
        <path
          d={curvePath}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      )}

      {/* Tip dot */}
      {isActive && progress > 0 && (
        <>
          <circle
            cx={tipX} cy={tipY} r="8"
            fill={lineColor} opacity="0.25"
            filter={`url(#${glowId})`}
          />
          <circle cx={tipX} cy={tipY} r="4" fill={lineColor} />
          <circle cx={tipX} cy={tipY} r="2" fill="white" />
        </>
      )}

      {/* Loading pulse dot */}
      {loading && !isActive && (
        <circle cx={padL + 3} cy={padT + cH} r="4" fill="#d4a017" opacity="0.5">
          <animate attributeName="opacity" values="0.2;0.7;0.2" dur="1.1s" repeatCount="indefinite" />
          <animate attributeName="r" values="3;5.5;3" dur="1.1s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

export default function CrashPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.crash);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.crash);
  const { playSfx, playRandom, playClick, playChip } = useGameAudio('crash');

  const [amount, setAmount] = useState('1');
  const [multiplier, setMultiplier] = useState(200);
  const [loading, setLoading] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Animation
  const [animating, setAnimating] = useState(false);
  const [displayMult, setDisplayMult] = useState(100);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [targetMult, setTargetMult] = useState(200);
  const [animSpeed, setAnimSpeed] = useState<1 | 2 | 3>(1); // 1=4s  2=2s  3=1s
  const animSpeedRef = useRef<1 | 2 | 3>(1);
  const rafRef = useRef<number>(0);
  const animStartedRef = useRef(false);

  const pendingBetId = contractPendingBet && contractPendingBet !== BigInt(0) ? contractPendingBet : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const isPlaying = loading || animating;
  const resultPhase = result.state?.phase ?? 'idle';
  const isWin = result.state?.phase === 'result' && result.state.payout > BigInt(0);
  const resultPayout = result.state?.phase === 'result' ? result.state.payout : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const spinLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  // ── Animation trigger ────────────────────────────────────────────────────
  useEffect(() => {
    if (result.state?.phase === 'result' && !animStartedRef.current) {
      animStartedRef.current = true;
      const tm = Number(result.state.outcomes[0] ?? BigInt(200));
      const hasWon = result.state.payout > BigInt(0);
      setTargetMult(tm);
      setDisplayMult(100);
      setAnimating(true);
      setShowFinalResult(false);
      playSfx('launch');

      const startTime = performance.now();
      // 4s base → halved per speed level: 1=4000ms, 2=2000ms, 3=1000ms
      const duration = 4000 / Math.pow(2, animSpeedRef.current - 1);

      const tick = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = Math.pow(progress, 0.5); // fast start
        setDisplayMult(Math.round(100 + (tm - 100) * eased));
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setDisplayMult(tm);
          setAnimating(false);
          setShowFinalResult(true);
          if (hasWon) {
            playRandom(['win', 'winAlt']);
            playSfx('coinRain');
          } else {
            playRandom(['lose', 'loseAlt']);
          }
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    if (!result.state) {
      animStartedRef.current = false;
      setDisplayMult(100);
      setAnimating(false);
      setShowFinalResult(false);
      cancelAnimationFrame(rafRef.current);
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [result.state]);

  // ── Play handler ─────────────────────────────────────────────────────────
  const handlePlay = async () => {
    if (!address) return;
    playClick();

    // Reset animation state explicitly — React 18 batches result.close() +
    // startPlacing() so the useEffect never sees the null transition.
    cancelAnimationFrame(rafRef.current);
    animStartedRef.current = false;
    setDisplayMult(100);
    setAnimating(false);
    setShowFinalResult(false);

    if (result.state !== null) result.close();
    setLoading(true);
    try {
      if (pendingBetId) { result.stuck(pendingBetId as bigint, addresses.games.crash); return; }

      const gameChoice = encodeCrashChoice(BigInt(multiplier), 1);
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
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
        >Crash</h1>
        <p className="text-zinc-400 text-center max-w-xs">Set your target multiplier. If the crash goes above it, you win.</p>
        <WalletButton />
      </div>
    );
  }

  // Determine center display
  const isIdle = !loading && !animating && !showFinalResult && resultPhase === 'idle';

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState({ w: 800, h: 220 });
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setChartSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col h-full">

      {/* Global gradient defs for lucide icon strokes */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-rocket-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={isPlaying} />

        {/* ── Speed toggle ── */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/60 bg-zinc-900/70 p-0.5 ml-2 shrink-0">
          {([1, 2, 3] as const).map((lvl) => {
            const active = animSpeed === lvl;
            return (
              <button
                key={lvl}
                disabled={isPlaying}
                onClick={() => { playClick(); setAnimSpeed(lvl); animSpeedRef.current = lvl; }}
                className={`px-2 py-1 rounded-md text-[11px] font-black tracking-tight transition-all disabled:cursor-not-allowed ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 shadow-[0_0_8px_rgba(200,146,10,0.4)]'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
                title={['4s', '2s', '1s'][lvl - 1]}
              >
                {'›'.repeat(lvl)}
              </button>
            );
          })}
        </div>

        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden ml-2 border-l border-amber-400/20 pl-4">
          <RecentOutcomes 
            gameAddress={addresses.games.crash}
            renderOutcome={(o, i) => {
              // Crash: o is the multiplier in basis points (e.g. 150 = 1.50x)
              const mult = (o / 100).toFixed(2);
              const isGood = o >= 200; // >= 2x is "good"
              return (
                <div 
                  className={`px-2 py-0.5 rounded-md flex items-center justify-center font-bold text-[10px] mx-0.5 whitespace-nowrap
                    ${isGood 
                      ? 'text-green-400 bg-green-400/10' 
                      : 'text-zinc-400 bg-zinc-800'}`}
                >
                  {mult}x
                </div>
              );
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <GameInfoButton onClick={() => setShowInfoModal(true)} />
          <FastTxToggle disabled={isPlaying} />
        </div>
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.crash} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: chart ── */}
      <div
        className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a]"
      >
        {/* Starfield */}
        <Starfield intensity={
          animating
            ? Math.min((displayMult - 100) / 1500, 1)
            : loading ? 0.08 : 0.03
        } />

        {/* Chart */}
        <div ref={chartContainerRef} className="absolute inset-0" style={{ zIndex: 1 }}>
          <CrashChart
            displayMult={animating || showFinalResult ? displayMult : 100}
            targetMult={targetMult}
            refMult={multiplier}
            animating={animating}
            showFinalResult={showFinalResult}
            isWin={isWin}
            width={chartSize.w}
            height={chartSize.h}
            loading={loading}
          />
        </div>

        {/* Multiplier overlay — centered */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
          <div
            className="font-black tabular-nums leading-none select-none"
            style={{
              fontSize: 'clamp(3.5rem, 10vw, 6rem)',
              color: showFinalResult
                ? (isWin ? '#4ade80' : '#f87171')
                : isIdle ? 'rgba(200,146,10,0.22)' : '#d4a017',
              textShadow: showFinalResult
                ? (isWin ? '0 0 50px rgba(74,222,128,0.5)' : '0 0 50px rgba(248,113,113,0.5)')
                : animating ? '0 0 50px rgba(212,160,23,0.5)' : 'none',
              transition: 'color 0.3s, text-shadow 0.3s',
            }}
          >
            {fmtMult(animating || showFinalResult ? displayMult : 100)}
          </div>

          {/* WIN / LOSS */}
          {showFinalResult && (
            <div className="flex flex-col items-center gap-0.5" style={{ animation: 'resultFadeIn 0.35s ease-out both' }}>
              <div
                className={`text-3xl font-black tracking-tight ${isWin ? 'text-green-400' : 'text-red-400'}`}
                style={{ textShadow: isWin ? '0 0 24px rgba(74,222,128,0.7)' : '0 0 24px rgba(248,113,113,0.7)' }}
              >
                {isWin ? 'WIN' : 'LOSS'}
              </div>
              {isWin && resultPayout !== undefined && (
                <p className="text-base font-bold text-green-300">
                  +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                </p>
              )}
              {!isWin && resultTotalBet !== undefined && (
                <p className="text-sm text-zinc-400">
                  −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Loading status label — bottom center */}
        {loading && !animating && !showFinalResult && spinLabel && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <p className="text-amber-300/50 text-xs font-medium animate-pulse tracking-widest uppercase">
              {spinLabel}
            </p>
          </div>
        )}

        {/* Error */}
        {resultPhase === 'error' && result.state?.phase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10"
            style={{ animation: 'resultFadeIn 0.35s ease-out both' }}>
            <p className="text-red-400 font-bold text-sm">{result.state.message}</p>
            <button onClick={() => result.close()} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors pointer-events-auto">Dismiss</button>
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
              >Bet Amount</p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-rocket-grad)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={isPlaying}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={isPlaying} onClick={() => { playChip(); setAmount((v) => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={isPlaying} onClick={() => { playChip(); setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[...CHIP_VALUES, ...(bet.balanceWei ? ['MAX'] : [])].map((v) => {
                  const val = v === 'MAX' ? bet.maxAmount : v;
                  const active = amount === val || (v !== 'MAX' && amount === v);
                  return (
                    <button
                      key={v}
                      disabled={isPlaying}
                      onClick={() => { playChip(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* MULTIPLIER */}
            <div className="p-4 space-y-3 mx-0">
              <p
                className="text-sm font-black uppercase tracking-widest"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >Multiplier</p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2">
                <Rocket className="w-5 h-5 shrink-0" stroke="url(#gold-rocket-grad)" strokeWidth={1.8} />
                <span className={`flex-1 text-xl font-black tabular-nums ${isPlaying ? 'text-zinc-500' : 'text-zinc-100'}`}>
                  {fmtMult(multiplier)}
                </span>
                <div className="flex flex-col gap-0.5">
                  <button disabled={isPlaying} onClick={() => { playClick(); setMultiplier((v) => Math.min(v + 10, 10000)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={isPlaying} onClick={() => { playClick(); setMultiplier((v) => Math.max(v - 10, 110)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MULT_OPTIONS.map((v) => {
                  const active = multiplier === v;
                  return (
                    <button
                      key={v}
                      disabled={isPlaying}
                      onClick={() => { playClick(); setMultiplier(v); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{fmtMult(v)}</button>
                  );
                })}
              </div>
            </div>

            {/* LAUNCH */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={isPlaying}
                className="relative w-full h-full min-h-[56px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2.5 sm:gap-3 px-4 bg-[#0d0d0d]"
                style={{
                  border: '3px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  boxShadow: isPlaying
                    ? 'none'
                    : '0 0 24px rgba(222,188,110,0.25), 0 0 60px rgba(222,188,110,0.08), inset 0 0 20px rgba(222,188,110,0.04)',
                }}
              >
                <Rocket className="w-8 h-8 sm:w-12 sm:h-12" stroke="url(#gold-rocket-grad)" strokeWidth={1.8} />
                <span
                  className="font-black text-2xl sm:text-4xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5)) drop-shadow(0 0 24px rgba(222,188,110,0.25))',
                  }}
                >
                  LAUNCH
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<Rocket className="w-4 h-4" />}
        title="Crash"
        description="Crash is built around a single decision: how greedy do you want to be? Before launch, you set a target multiplier anywhere from 1.10x up to 100.00x — the higher the target, the bigger the payout, but the lower the chance the climb actually gets there. Once you hit launch, an independent random multiplier is generated for that round and the rocket's flight path is drawn live on the chart, climbing until the moment it crashes. If the multiplier the rocket reaches is at or above your chosen target, you win; if it crashes before reaching your target, the bet is lost in full."
        steps={[
          'Choose your bet amount using the chip buttons or the input field, then set a target multiplier between 1.10x and 100.00x using the stepper or one of the quick-target buttons.',
          'Press Launch to submit your bet — the contract immediately determines the round outcome.',
          'Watch the chart animate the climb: the line rises from 1.00x and keeps going until it reaches the round\'s crash point.',
          'If the crash point lands at or above your target, the round resolves as a win and the multiplier is applied to your stake.',
          'If the crash point lands below your target, the round resolves as a loss and the full stake is forfeited — your balance updates automatically either way.',
        ]}
        sections={[
          {
            title: 'Targets & odds',
            content: (
              <div className="space-y-2 text-[11px] text-zinc-300">
                <p>
                  Every target between 1.10x and 100.00x is available, and the round's outcome is drawn from a continuous, uniformly fair distribution — mathematically, the chance of the climb reaching at least M× is approximately 1 ÷ M. That means a 2.00x target wins roughly half the time, a 10.00x target wins roughly one time in ten, and a 100.00x target wins only rarely, but pays out 100 times the stake when it does.
                </p>
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {[110, 150, 200, 500, 1000, 5000].map((v) => (
                    <div key={v} className="text-center rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 py-1 font-bold tabular-nums">
                      {fmtMult(v)}
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            title: 'Payout calculation',
            content: (
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                Payout is simply your stake multiplied by your chosen target: a 5.00 {bet.meta.symbol} bet on a 3.00x target pays 15.00 {bet.meta.symbol} on a win and nothing on a loss. There is no partial credit for getting close — the only thing that matters is whether the crash point cleared your target before the round ended. Higher targets carry both a bigger multiplier on the win side and a steeper drop in how often that win happens, so the expected return per round is built to balance out across many bets rather than any single one.
              </p>
            ),
          },
        ]}
        tip="Low targets (1.10x–2.00x) win often but pay little per round; high targets pay big but land rarely — pick a target that matches how much variance you want, and consider sizing bets smaller as your target climbs."
        rtp="~95.00%"
      />

    </div>
  );
}
