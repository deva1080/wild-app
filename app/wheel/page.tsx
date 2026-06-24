'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { useWheelConfig } from '@/lib/web3/hooks/useWheelConfig';
import { encodeWheelChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];

// ── Spinning Starfield Background ────────────────────────────────────────────

function SpinningStarfield({ spinning }: { spinning: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<{ angle: number; dist: number; z: number; color: number }[]>([]);
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

    const maxStars = 220;
    if (starsRef.current.length === 0) {
      for (let i = 0; i < maxStars; i++) {
        starsRef.current.push({
          angle: Math.random() * Math.PI * 2,
          dist: 0.1 + Math.random() * 0.9,
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
      const cxC = w / 2;
      const cyC = h * 0.85;
      const maxR = Math.max(w, h) * 0.9;

      ctx.clearRect(0, 0, w, h);

      const speed = spinning ? 1.2 : 0.15;
      const stars = starsRef.current;

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.angle += (0.3 + s.z * 0.7) * speed * dt;
        if (s.angle > Math.PI * 2) s.angle -= Math.PI * 2;

        const r = s.dist * maxR;
        const x = cxC + Math.cos(s.angle) * r;
        const y = cyC + Math.sin(s.angle) * r;

        const size = 0.6 + s.z * 2.0;
        const alpha = 0.12 + s.z * 0.35;

        let cr = 190, cg = 165, cb = 110;
        const ci = s.color;
        if (ci < 0.3) { cr = 222; cg = 188; cb = 110; }
        else if (ci < 0.55) { cr = 170; cg = 140; cb = 80; }
        else if (ci < 0.75) { cr = 140; cg = 130; cb = 120; }
        else { cr = 200; cg = 175; cb = 100; }

        if (spinning && s.z > 0.4) {
          const trailAngle = s.angle - 0.06;
          const tx = cxC + Math.cos(trailAngle) * r;
          const ty = cyC + Math.sin(trailAngle) * r;
          const grad = ctx.createLinearGradient(tx, ty, x, y);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},${alpha * 0.7})`);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(x, y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = size * 0.8;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [spinning]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

// 4-color segment palette: negro, marrón oscuro, dorado, marrón claro
const SEGMENT_PALETTE = [
  { fill: 'url(#wDarkGrad1)', stroke: 'rgba(222,188,110,0.3)', text: 'url(#wGoldGrad)' },
  { fill: 'url(#wDarkGrad2)', stroke: 'rgba(222,188,110,0.3)', text: 'url(#wGoldGrad)' },
  { fill: 'url(#wGoldGrad)',  stroke: 'rgba(222,188,110,0.5)', text: 'url(#wDarkGrad1)' },
  { fill: 'url(#wDarkGrad3)', stroke: 'rgba(222,188,110,0.3)', text: 'url(#wGoldGrad)' },
];

function formatMultiplier(bp: bigint): string {
  const value = Number(bp) / 10000;
  if (value === 0) return '0X';
  if (Number.isInteger(value)) return value + 'X';
  return value.toFixed(1) + 'X';
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return ['M', cx, cy, 'L', start.x, start.y, 'A', r, r, 0, largeArc, 0, end.x, end.y, 'Z'].join(' ');
}

function WheelSVG({
  multipliers,
  rotation,
  resultSegment,
  showResult,
}: {
  multipliers: bigint[];
  rotation: number;
  resultSegment: number | null;
  showResult: boolean;
}) {
  const cx = 500, cy = 500, r = 460;
  const segmentCount = multipliers.length;
  const segmentAngle = 360 / segmentCount;

  return (
    <svg viewBox="0 0 1000 1000" className="w-full h-full">
      <defs>
        <filter id="wGlow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="wGlowStrong">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="wCenterGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2a1e07" />
          <stop offset="100%" stopColor="#0d0d0d" />
        </radialGradient>
        <linearGradient id="wGoldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#debc6e" />
          <stop offset="100%" stopColor="#8c6825" />
        </linearGradient>
        <linearGradient id="wDarkGrad1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#161616" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        <linearGradient id="wDarkGrad2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1104" />
          <stop offset="100%" stopColor="#492e0d" />
        </linearGradient>
        <linearGradient id="wDarkGrad3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#58340B" />
          <stop offset="100%" stopColor="#936b27" />
        </linearGradient>
      </defs>

      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r + 12} fill="none" stroke="rgba(222,188,110,0.2)" strokeWidth="6" />
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(222,188,110,0.35)" strokeWidth="3" />

      {/* Spinning wheel group */}
      <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        {multipliers.map((mult, i) => {
          const startAngle = i * segmentAngle;
          const endAngle = (i + 1) * segmentAngle;
          const midAngle = startAngle + segmentAngle / 2;
          const textPos = polarToCartesian(cx, cy, r * 0.78, midAngle);
          const half = Math.floor(segmentCount / 2) || 1;
          const palette = SEGMENT_PALETTE[(i % half) % SEGMENT_PALETTE.length];
          const isWinSegment = showResult && resultSegment === i;

          return (
            <g key={i}>
              <path
                d={describeArc(cx, cy, r, startAngle, endAngle)}
                fill={palette.fill}
                stroke={palette.stroke}
                strokeWidth={2}
                opacity={0.4}
              />
              <text
                x={textPos.x}
                y={textPos.y}
                fill={isWinSegment ? '#4ade80' : palette.text}
                fontSize={segmentCount > 10 ? '128' : segmentCount > 7 ? '112' : '168'}
                fontWeight="normal"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${midAngle}, ${textPos.x}, ${textPos.y})`}
                style={{
                  fontFamily: '"Bebas Neue", sans-serif',
                  letterSpacing: '0.05em',
                  textShadow: isWinSegment ? '0 0 12px rgba(74,222,128,0.8)' : 'none',
                }}
              >
                {formatMultiplier(mult)}
              </text>
            </g>
          );
        })}
      </g>

      {/* Center hub */}
      <circle cx={cx} cy={cy} r="120" fill="url(#wCenterGrad)" />
      <circle cx={cx} cy={cy} r="120" fill="none" stroke="rgba(222,188,110,0.4)" strokeWidth="4" filter="url(#wGlow)" />
      
      {/* Crown emblem in center */}
      <g transform={`translate(${cx - 48}, ${cy - 38}) scale(0.25)`}>
        <path
          d="M 72.08 292.75 C71.86,270.58 68.77,242.72 63.93,219.15 C57.85,189.54 45.42,149.67 34.27,124.01 L 32.32 119.52 L 25.41 119.43 C11.09,119.23 1.61,109.93 1.53,96.00 C1.49,87.83 4.78,81.66 11.58,77.15 C26.68,67.16 46.07,76.66 47.72,94.87 C48.20,100.15 47.91,101.65 45.50,106.41 C43.98,109.43 42.11,112.13 41.36,112.41 C38.72,113.43 40.08,116.30 48.50,127.51 C52.92,133.39 58.32,140.19 69.96,154.54 C90.47,179.82 119.29,208.97 128.13,213.38 C132.83,215.72 133.47,215.81 136.03,214.48 C148.39,208.09 166.36,162.16 176.90,110.00 C181.61,86.69 186.38,56.43 185.56,55.10 C185.31,54.69 183.21,53.73 180.90,52.97 C174.79,50.95 167.70,43.62 165.52,37.07 C162.04,26.57 164.92,14.79 172.63,8.02 C183.94,-1.91 199.59,-1.42 210.10,9.20 C223.25,22.49 219.33,44.27 202.36,52.21 C198.86,53.85 196.00,55.52 196.00,55.92 C196.00,57.41 198.99,77.79 200.49,86.50 C210.68,145.80 227.28,195.84 241.86,211.25 C247.38,217.09 250.97,216.51 261.00,208.14 C277.13,194.68 312.23,156.10 327.50,135.03 C328.60,133.51 332.29,128.54 335.70,123.99 L 341.90 115.72 L 338.51 111.58 C334.20,106.32 332.93,102.94 332.87,96.58 C332.79,87.21 338.89,78.03 347.65,74.37 C352.26,72.45 360.06,72.66 365.17,74.87 C381.31,81.83 384.07,103.91 370.15,114.67 C365.69,118.12 356.92,120.52 352.68,119.46 C349.57,118.67 348.52,120.51 341.22,139.50 C327.24,175.84 316.78,216.77 312.60,251.50 C311.16,263.43 309.00,294.02 309.00,302.46 L 309.00 306.00 L 190.60 306.00 L 72.21 306.00 L 72.08 292.75 Z"
          fill="url(#wGoldGrad)"
          
          // filter="url(#wGlow)"
        />
      </g>
    </svg>
  );
}

export default function WheelPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.wheel);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.wheel);
  const { config, isLoading: isLoadingConfig } = useWheelConfig(0);
  const { playClick, playChip, playSfx, startLoop, stopLoop, playFading } = useGameAudio('wheel');

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [targetSegment, setTargetSegment] = useState<number | null>(null);

  const rafRef = useRef<number>(0);
  const rotationRef = useRef(0);
  const animStartedRef = useRef(false);
  // Handle for the in-flight win sound, so "Spin Again" can cut it short
  // with a quick fade instead of letting it ring out underneath the next spin.
  const coinRainHandleRef = useRef<{ stop: (fadeMs?: number) => void } | null>(null);

  const pendingBetId = contractPendingBet && contractPendingBet !== BigInt(0) ? contractPendingBet : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase = result.state?.phase ?? 'idle';
  const isWin = result.state?.phase === 'result' && result.state.payout > BigInt(0);
  const resultPayout = result.state?.phase === 'result' ? result.state.payout : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const spinLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  const multipliers = useMemo(() => config?.multipliers ?? [], [config]);
  const segmentCount = multipliers.length || 8;
  const segmentAngle = 360 / segmentCount;

  const startInfiniteSpin = useCallback(() => {
    setIsSpinning(true);
    const spinSpeed = 300;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      rotationRef.current = (rotationRef.current + (spinSpeed * delta / 1000)) % 360;
      setRotation(rotationRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopSpinAndAnimateToResult = useCallback((winningSegment: number, hasWon: boolean) => {
    cancelAnimationFrame(rafRef.current);
    const currentRotation = rotationRef.current;
    // The pointer is at the top (12 o'clock). We want the winning segment centered under it.
    const segmentCenter = winningSegment * segmentAngle + segmentAngle / 2;
    const targetAngle = (360 - segmentCenter + 360) % 360;
    const currentAngle = ((currentRotation % 360) + 360) % 360;
    let deltaToTarget = targetAngle - currentAngle;
    if (deltaToTarget < 0) deltaToTarget += 360;
    const extraSpins = 6 * 360;
    const targetRotation = currentRotation + extraSpins + deltaToTarget;

    const startTime = performance.now();
    const duration = 4500;
    const startRot = currentRotation;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      rotationRef.current = startRot + (targetRotation - startRot) * eased;
      setRotation(rotationRef.current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setIsSpinning(false);
        setShowFinalResult(true);
        stopLoop();
        if (hasWon) {
          // 1.5s natural tail fade so the coin rain winds down instead of
          // cutting off at the clip's end.
          coinRainHandleRef.current = playFading('coinRain', 1500);
        } else {
          playSfx('click3');
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [segmentAngle, stopLoop, playSfx, playFading]);

  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (result.state?.phase === 'result' && !animStartedRef.current) {
      animStartedRef.current = true;
      const raw = Number(result.state.outcomes[0] ?? 0);
      const segment = ((raw % segmentCount) + segmentCount) % segmentCount;
      const hasWon = result.state.payout > BigInt(0);
      setTargetSegment(segment);
      stopSpinAndAnimateToResult(segment, hasWon);
    }
    if (result.state && result.state.phase !== 'result') {
      wasPlayingRef.current = true;
    }
    if (!result.state && (animStartedRef.current || wasPlayingRef.current)) {
      cancelAnimationFrame(rafRef.current);
      setIsSpinning(false);
      setShowFinalResult(false);
      setTargetSegment(null);
      animStartedRef.current = false;
      wasPlayingRef.current = false;
      stopLoop();
    }
  }, [result.state, stopSpinAndAnimateToResult, stopLoop]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePlay = async () => {
    if (!address || !config) return;
    playClick();
    coinRainHandleRef.current?.stop(150);
    coinRainHandleRef.current = null;
    cancelAnimationFrame(rafRef.current);
    animStartedRef.current = false;
    setShowFinalResult(false);
    setTargetSegment(null);
    if (result.state !== null) result.close();
    setLoading(true);
    startInfiniteSpin();
    startLoop('spin');
    try {
      if (pendingBetId) {
        result.stuck(pendingBetId as bigint, addresses.games.wheel);
        cancelAnimationFrame(rafRef.current);
        setIsSpinning(false);
        stopLoop();
        return;
      }
      const gameChoice = encodeWheelChoice(config.configId, 1, BigInt(0), BigInt(0));
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
      cancelAnimationFrame(rafRef.current);
      setIsSpinning(false);
      stopLoop();
    } finally {
      setLoading(false);
    }
  };

  // ── Loading / no config states ──────────────────────────────────────────────
  if (isLoadingConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: 'rgba(222,188,110,0.4)', borderTopColor: '#debc6e' }} />
        <p className="text-zinc-400 text-sm tracking-wide">Loading wheel…</p>
      </div>
    );
  }

  if (!config || multipliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <p className="text-zinc-400 text-center max-w-xs">No wheel configuration available yet.</p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="opacity-25 pointer-events-none w-full max-w-[500px] aspect-square overflow-hidden relative">
          <div className="absolute left-1/2" style={{ width: '180%', transform: 'translateX(-50%) translateY(45%)', bottom: '10%' }}>
            <WheelSVG multipliers={multipliers} rotation={0} resultSegment={null} showResult={false} />
          </div>
        </div>
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
        >Wheel</h1>
        <p className="text-zinc-400 text-center max-w-xs">Spin the wheel, land on a multiplier, win big.</p>
        <WalletButton />
      </div>
    );
  }

  const isPlaying = loading || isSpinning;

  return (
    <div className="flex flex-col h-full">

      {/* Global gradient defs */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="wheel-gold-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={isPlaying} />
        <div className="flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes
            gameAddress={addresses.games.wheel}
            renderOutcome={(o) => {
              const mult = multipliers[o] ? formatMultiplier(multipliers[o]) : `#${o}`;
              const isGood = multipliers[o] && multipliers[o] >= 20000n;
              return (
                <div className={`px-2 py-0.5 rounded-md font-bold text-[10px] mx-0.5 whitespace-nowrap font-mono
                  ${isGood ? 'text-amber-300 bg-amber-400/10' : 'text-zinc-400 bg-zinc-800'}`}>
                  {mult}
                </div>
              );
            }}
          />
        </div>
        <FastTxToggle disabled={isPlaying} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.wheel} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Wheel area ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a]">

        {/* Spinning starfield background */}
        <SpinningStarfield spinning={isSpinning} />

        {/* Fixed pointer at top center */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30">
          <svg width="28" height="36" viewBox="0 0 28 36">
            <polygon points="14,36 0,0 28,0" fill="url(#wheel-gold-grad)" />
            <polygon points="14,36 0,0 28,0" fill="none" stroke="rgba(222,188,110,0.8)" strokeWidth="1.5" />
          </svg>
        </div>

        {/* Oversized wheel: center anchored slightly above bottom of container */}
        <div
          className="absolute left-1/2 z-10"
          style={{
            width: '180%',
            maxWidth: '1000px',
            aspectRatio: '1',
            transform: 'translateX(-50%) translateY(50%)',
            bottom: '8%',
          }}
        >
          <WheelSVG
            multipliers={multipliers}
            rotation={rotation}
            resultSegment={targetSegment}
            showResult={showFinalResult}
          />
        </div>

        {/* Status / result overlay */}
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
          {isSpinning && spinLabel && !showFinalResult && (
            <p className="text-amber-300/50 text-sm font-medium animate-pulse tracking-widest uppercase pointer-events-none">
              {spinLabel}
            </p>
          )}

          {showFinalResult && (
            <div
              className="flex flex-col items-center gap-1 pointer-events-auto"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              <div
                className={`text-5xl font-black tracking-tight ${isWin ? 'text-green-400' : 'text-red-400'}`}
                style={{ textShadow: isWin ? '0 0 30px rgba(74,222,128,0.5)' : '0 0 30px rgba(248,113,113,0.5)' }}
              >
                {isWin ? 'WIN' : 'LOSS'}
              </div>
              {isWin && resultPayout !== undefined && (
                <p className="text-xl font-bold text-green-300">
                  +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                </p>
              )}
              {!isWin && resultTotalBet !== undefined && (
                <p className="text-base text-zinc-400">
                  −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                </p>
              )}
              <button
                onClick={() => {
                  coinRainHandleRef.current?.stop(150);
                  coinRainHandleRef.current = null;
                  result.close();
                  setShowFinalResult(false);
                  setTargetSegment(null);
                }}
                className="mt-2 px-6 py-2 rounded-lg text-sm font-bold transition-colors"
                style={{
                  border: '1.5px solid transparent',
                  backgroundImage: 'linear-gradient(#161616, #161616), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  color: '#debc6e',
                }}
              >
                Spin Again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom controls ── */}
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-3">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p className="text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Bet Amount
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#wheel-gold-grad)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount}
                  disabled={isPlaying}
                  onChange={(e) => {
                    if (result.state !== null) result.close();
                    setAmount(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={isPlaying}
                    onClick={() => { playChip(); if (result.state !== null) result.close(); setAmount(v => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={isPlaying}
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
                      disabled={isPlaying}
                      onClick={() => { playChip(); if (result.state !== null) result.close(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* PROBABILITY TABLE (middle column) */}
            <div className="p-4 border-x border-amber-400/10 space-y-3">
              <p className="text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Chances
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto max-h-[90px] pr-1">
                {multipliers.map((mult, i) => (
                  <div key={i} className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-mono text-zinc-300 font-bold">{formatMultiplier(mult)}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{(100 / segmentCount).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 font-medium">{segmentCount} segments &middot; equal odds</p>
            </div>

            {/* SPIN BUTTON */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={isPlaying || showFinalResult}
                className="relative w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-3 bg-[#0d0d0d]"
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
                <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <defs>
                    <linearGradient id="wheel-spin-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#debc6e"/>
                      <stop offset="100%" stopColor="#8c6825"/>
                    </linearGradient>
                  </defs>
                  <path stroke="url(#wheel-spin-grad)" strokeWidth="1.8" d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path stroke="url(#wheel-spin-grad)" strokeWidth="1.8" d="M21 3v5h-5"/>
                </svg>
                <span
                  className="font-black text-4xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5)) drop-shadow(0 0 24px rgba(222,188,110,0.25))',
                  }}
                >
                  SPIN
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
