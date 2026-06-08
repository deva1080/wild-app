'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

const CHIP_VALUES = ['1', '5', '10', '50', '100'];

const SEGMENT_COLORS = [
  '#d4a017',
  '#1a1a2e',
  '#c8920a',
  '#0f0f1a',
  '#b8860b',
  '#161625',
  '#daa520',
  '#1e1e30',
];

function formatMultiplier(bp: bigint): string {
  const value = Number(bp) / 10000;
  if (value === 0) return '0x';
  if (value < 1) return value.toFixed(1) + 'x';
  if (Number.isInteger(value)) return value + 'x';
  return value.toFixed(1) + 'x';
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    'M', cx, cy,
    'L', start.x, start.y,
    'A', r, r, 0, largeArc, 0, end.x, end.y,
    'Z',
  ].join(' ');
}

interface WheelSVGProps {
  multipliers: bigint[];
  rotation: number;
}

function WheelSVG({ multipliers, rotation }: WheelSVGProps) {
  const cx = 150, cy = 150, r = 140;
  const segmentCount = multipliers.length;
  const segmentAngle = 360 / segmentCount;

  return (
    <svg viewBox="0 0 300 300" className="w-full h-full max-w-[320px] max-h-[320px]">
      <defs>
        <filter id="wheelGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2a2a3a" />
          <stop offset="100%" stopColor="#0d0d12" />
        </radialGradient>
      </defs>

      <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke="rgba(212,160,23,0.15)" strokeWidth="4" />
      
      <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        {multipliers.map((mult, i) => {
          const startAngle = i * segmentAngle;
          const endAngle = (i + 1) * segmentAngle;
          const midAngle = startAngle + segmentAngle / 2;
          const textPos = polarToCartesian(cx, cy, r * 0.65, midAngle);
          const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
          
          return (
            <g key={i}>
              <path
                d={describeArc(cx, cy, r, startAngle, endAngle)}
                fill={color}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1"
              />
              <text
                x={textPos.x}
                y={textPos.y}
                fill={i % 2 === 0 ? '#1a0e00' : '#d4a017'}
                fontSize={segmentCount > 10 ? '9' : '12'}
                fontWeight="bold"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  transform: `rotate(${midAngle}deg)`,
                  transformOrigin: `${textPos.x}px ${textPos.y}px`,
                }}
              >
                {formatMultiplier(mult)}
              </text>
            </g>
          );
        })}
      </g>

      <circle cx={cx} cy={cy} r="32" fill="url(#centerGrad)" stroke="rgba(212,160,23,0.3)" strokeWidth="3" />
      <circle cx={cx} cy={cy} r="18" fill="#0d0d12" stroke="rgba(212,160,23,0.2)" strokeWidth="2" />
      
      <g transform={`translate(${cx - 12}, ${cy - 8})`}>
        <path
          d="M2 16h20M2 16l2-10 5 5 3-7 3 7 5-5 2 10H2z"
          fill="none"
          stroke="#d4a017"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>

      <polygon
        points={`${cx},${cy - r - 18} ${cx - 10},${cy - r + 2} ${cx + 10},${cy - r + 2}`}
        fill="#d4a017"
        filter="url(#wheelGlow)"
      />
    </svg>
  );
}

export default function WheelPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.wheel);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.wheel);
  const { config, isLoading: isLoadingConfig } = useWheelConfig(0);

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);

  // Animation states
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [targetSegment, setTargetSegment] = useState<number | null>(null);

  const rafRef = useRef<number>(0);
  const rotationRef = useRef(0);
  const animStartedRef = useRef(false);

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
    const spinSpeed = 360;
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

  const stopSpinAndAnimateToResult = useCallback((winningSegment: number) => {
    cancelAnimationFrame(rafRef.current);
    
    const currentRotation = rotationRef.current;
    const segmentCenter = winningSegment * segmentAngle + segmentAngle / 2;
    const targetAngle = (360 - segmentCenter + 360) % 360;
    const currentAngle = ((currentRotation % 360) + 360) % 360;
    let deltaToTarget = targetAngle - currentAngle;
    if (deltaToTarget < 0) deltaToTarget += 360;
    
    const extraSpins = 5 * 360;
    const targetRotation = currentRotation + extraSpins + deltaToTarget;

    console.log('[Wheel Animation] Segment:', winningSegment, 'SegmentAngle:', segmentAngle, 'SegmentCenter:', segmentCenter, 'TargetAngle:', targetAngle, 'CurrentAngle:', currentAngle, 'Delta:', deltaToTarget);

    const startTime = performance.now();
    const duration = 4000;
    const startRot = currentRotation;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const newRotation = startRot + (targetRotation - startRot) * eased;
      rotationRef.current = newRotation;
      setRotation(newRotation);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setIsSpinning(false);
        setShowFinalResult(true);
      }
    };
    
    rafRef.current = requestAnimationFrame(tick);
  }, [segmentAngle]);

  useEffect(() => {
    if (result.state?.phase === 'result' && !animStartedRef.current) {
      animStartedRef.current = true;
      const segment = Number(result.state.outcomes[0] ?? 0);
      setTargetSegment(segment);
      stopSpinAndAnimateToResult(segment);
    }

    if (!result.state && animStartedRef.current) {
      animStartedRef.current = false;
      setShowFinalResult(false);
      setTargetSegment(null);
    }
  }, [result.state, stopSpinAndAnimateToResult]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePlay = async () => {
    if (!address || !config) return;

    cancelAnimationFrame(rafRef.current);
    animStartedRef.current = false;
    setShowFinalResult(false);
    setTargetSegment(null);
    
    if (result.state !== null) result.close();
    
    setLoading(true);
    startInfiniteSpin();

    try {
      if (pendingBetId) {
        result.stuck(pendingBetId as bigint, addresses.games.wheel);
        setLoading(false);
        cancelAnimationFrame(rafRef.current);
        setIsSpinning(false);
        return;
      }

      const gameChoice = encodeWheelChoice(config.configId, 1, BigInt(0), BigInt(0));
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
      cancelAnimationFrame(rafRef.current);
      setIsSpinning(false);
    } finally {
      setLoading(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="w-10 h-10 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
        <p className="text-zinc-400">Loading wheel configuration...</p>
      </div>
    );
  }

  if (!config || multipliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <h1 className="text-3xl font-black text-amber-100 tracking-tight">Wheel</h1>
        <p className="text-zinc-400 text-center max-w-xs">No wheel configuration available yet.</p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="opacity-30">
          <WheelSVG multipliers={multipliers} rotation={0} />
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

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={isPlaying} />
        <div className="flex-1" />
        <FastTxToggle disabled={isPlaying} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.wheel} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Wheel area ── */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a]">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-80 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative z-10">
          <WheelSVG multipliers={multipliers} rotation={rotation} />
        </div>

        {/* Status while spinning */}
        {isSpinning && spinLabel && (
          <p className="relative z-10 mt-4 text-amber-300/50 text-xs font-medium animate-pulse tracking-widest uppercase">
            {spinLabel}
          </p>
        )}

        {/* Result overlay */}
        {showFinalResult && (
          <div
            className="relative z-10 mt-4 flex flex-col items-center gap-1"
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
              onClick={() => { result.close(); setShowFinalResult(false); }}
              className="mt-3 px-6 py-2 rounded-lg text-sm font-bold transition-colors"
              style={{
                border: '1.5px solid transparent',
                backgroundImage: 'linear-gradient(#161616, #161616), linear-gradient(20deg, #debc6e, #8c6825)',
                backgroundOrigin: 'border-box',
                backgroundClip: 'padding-box, border-box',
                color: '#debc6e',
              }}
            >
              Play Again
            </button>
          </div>
        )}

        {/* Error state */}
        {resultPhase === 'error' && result.state?.phase === 'error' && (
          <div
            className="relative z-10 mt-4 flex flex-col items-center gap-2"
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
              >Bet Amount</p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <span className="text-amber-400 text-lg font-black">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  disabled={isPlaying}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button
                    disabled={isPlaying}
                    onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button
                    disabled={isPlaying}
                    onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
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
                      onClick={() => setAmount(val)}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SPIN BUTTON */}
            <div className="p-4 flex items-center justify-center border-l border-amber-400/10">
              <button
                onClick={handlePlay}
                disabled={isPlaying || !config || showFinalResult}
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
                  <defs><linearGradient id="wheel-btn-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#debc6e"/><stop offset="100%" stopColor="#8c6825"/></linearGradient></defs>
                  <path stroke="url(#wheel-btn-grad)" strokeWidth="1.8" d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path stroke="url(#wheel-btn-grad)" strokeWidth="1.8" d="M21 3v5h-5"/>
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
