'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useDelegatedPlay } from '@/lib/web3/hooks/useDelegatedPlay';
import { usePreflightCheck } from '@/lib/web3/hooks/usePreflightCheck';
import { useWheelConfig } from '@/lib/web3/hooks/useWheelConfig';
import { encodeWheelChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

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
  const publicClient = usePublicClient();
  const { wildBalance, pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.wheel);
  const { playStandard, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const result = useGameResultFlow();
  const { mode: txMode } = useTxMode();
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
  const balStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toFixed(2) : '0.00';

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

  // Spin infinito mientras loading
  const startInfiniteSpin = useCallback(() => {
    setIsSpinning(true);
    const spinSpeed = 360; // grados por segundo
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
    
    // El centro del segmento ganador (en grados desde el inicio)
    // Segmento 0 empieza en 0°, su centro está en segmentAngle/2
    // Segmento N empieza en N*segmentAngle, su centro está en N*segmentAngle + segmentAngle/2
    const segmentCenter = winningSegment * segmentAngle + segmentAngle / 2;
    
    // Para que el segmento quede bajo el pointer (arriba = 0°), necesitamos
    // rotar la rueda de forma que el segmentCenter quede en 0°
    // Si rotamos X grados, el punto que estaba en 0° ahora está en X°
    // Queremos que el punto en segmentCenter quede en 0°, así que:
    // finalRotation % 360 = 360 - segmentCenter (para que segmentCenter quede arriba)
    const targetAngle = (360 - segmentCenter + 360) % 360;
    
    // Calcular cuánto más necesitamos rotar desde la posición actual
    const currentAngle = ((currentRotation % 360) + 360) % 360;
    let deltaToTarget = targetAngle - currentAngle;
    if (deltaToTarget < 0) deltaToTarget += 360;
    
    // Agregar 5 vueltas completas + el delta necesario
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

  // Efecto para manejar el resultado
  useEffect(() => {
    if (result.state?.phase === 'result' && !animStartedRef.current) {
      animStartedRef.current = true;
      const segment = Number(result.state.outcomes[0] ?? 0);
      setTargetSegment(segment);
      stopSpinAndAnimateToResult(segment);
    }

    // Reset cuando se cierra el resultado
    if (!result.state && animStartedRef.current) {
      animStartedRef.current = false;
      setShowFinalResult(false);
      setTargetSegment(null);
    }
  }, [result.state, stopSpinAndAnimateToResult]);

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePlay = async () => {
    if (!address || !config) return;

    // Reset state
    cancelAnimationFrame(rafRef.current);
    animStartedRef.current = false;
    setShowFinalResult(false);
    setTargetSegment(null);
    
    if (result.state !== null) result.close();
    
    setLoading(true);
    startInfiniteSpin();

    try {
      const gameChoice = encodeWheelChoice(config.configId, 1, BigInt(0), BigInt(0));
      const weiAmount = parseEther(amount);

      if (pendingBetId) {
        result.stuck(pendingBetId as bigint, addresses.games.wheel);
        setLoading(false);
        cancelAnimationFrame(rafRef.current);
        setIsSpinning(false);
        return;
      }

      if (txMode !== 'delegated') {
        const issues = await check(addresses.games.wheel, weiAmount);
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length > 0) {
          result.error(errors.map((e) => e.message).join('\n'));
          setLoading(false);
          cancelAnimationFrame(rafRef.current);
          setIsSpinning(false);
          return;
        }
      }

      if (txMode === 'delegated') {
        // Read balance BEFORE
        const balanceBefore = publicClient ? await publicClient.readContract({
          address: addresses.wildToken,
          abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [address],
        }) as bigint : BigInt(0);
        console.log('[Balance Debug] BEFORE play - balance:', formatEther(balanceBefore), 'WILD, bet:', amount, 'WILD');
        
        result.startPlacing();
        if (!authorizedPlays || authorizedPlays === BigInt(0)) await setupDelegatedPlay(BigInt(100));
        const txHash = await requestDelegatedPlay(addresses.games.wheel, address, addresses.wildToken, weiAmount, gameChoice, false);
        await result.waitForDelegatedTx(txHash);
        
        // Read balance AFTER
        const balanceAfter = publicClient ? await publicClient.readContract({
          address: addresses.wildToken,
          abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [address],
        }) as bigint : BigInt(0);
        const diff = balanceAfter - balanceBefore;
        console.log('[Balance Debug] AFTER play - balance:', formatEther(balanceAfter), 'WILD');
        console.log('[Balance Debug] DIFF:', diff >= 0 ? '+' : '', formatEther(diff), 'WILD (positive = win, negative = loss)');
        
        refetchAll();
      } else {
        result.startPlacing();
        const playResult = await playStandard(addresses.games.wheel, gameChoice, weiAmount);
        result.betPlaced(playResult.betId, playResult.gameAddress);
        const settleTxHash = await requestSettle(playResult.gameAddress, playResult.betId);
        await result.waitForSettleTx(settleTxHash);
      }
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
        <h1 className="text-3xl font-black text-amber-100 tracking-tight">Wheel</h1>
        <p className="text-zinc-400 text-center max-w-xs">Spin the wheel, land on a multiplier, win big.</p>
        <WalletButton />
      </div>
    );
  }

  const isPlaying = loading || isSpinning;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-amber-500/10 bg-[#0d0d0d]/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm font-bold">
          <span className="text-amber-400">♦</span>
          $WILD
          <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
        </div>

        <div className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-zinc-600">
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${txMode === 'delegated' ? 'text-amber-400' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          {txMode === 'delegated' ? <span className="text-amber-400">Fast TX</span> : 'Standard TX'}
        </div>
      </div>

      {/* Pending bet banner */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.wheel} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* Wheel area */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-80 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative z-10">
          <WheelSVG multipliers={multipliers} rotation={rotation} />
        </div>

        {/* Status while spinning */}
        {isSpinning && spinLabel && (
          <p className="relative z-10 mt-4 text-amber-300/70 text-sm font-medium tracking-wide animate-pulse">
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
                +{Number(formatEther(resultPayout)).toFixed(2)} <span className="text-green-400/60 text-sm">WILD</span>
              </p>
            )}
            {!isWin && resultTotalBet !== undefined && (
              <p className="text-base text-zinc-400">
                −{Number(formatEther(resultTotalBet)).toFixed(2)} WILD
              </p>
            )}
            <button
              onClick={() => { result.close(); setShowFinalResult(false); }}
              className="mt-3 px-6 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-300 text-sm font-bold hover:bg-amber-500/30 transition-colors"
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

      {/* Bottom controls */}
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#111111] border border-zinc-800/80 overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-zinc-800/80">
            {/* BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet Amount</p>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">♦</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  disabled={isPlaying}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40"
                />
                <div className="flex flex-col gap-0.5">
                  <button
                    disabled={isPlaying}
                    onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >+</button>
                  <button
                    disabled={isPlaying}
                    onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >−</button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    disabled={isPlaying}
                    onClick={() => setAmount(v)}
                    className={`px-2 py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      amount === v
                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                        : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {v}
                  </button>
                ))}
                {wildBalance && (
                  <button
                    disabled={isPlaying}
                    onClick={() => setAmount(Number(formatEther(wildBalance as bigint)).toFixed(2))}
                    className="px-2 py-1 rounded text-xs font-bold border bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    MAX
                  </button>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">Balance: {balStr} WILD</p>
            </div>

            {/* SPIN BUTTON */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={isPlaying || !config || showFinalResult}
                className="w-full h-full min-h-[90px] rounded-xl font-black text-2xl tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #d4a017 0%, #c8920a 40%, #8b6000 100%)',
                  boxShadow: isPlaying ? 'none' : '0 0 30px rgba(200,146,10,0.3), inset 0 1px 0 rgba(255,220,80,0.3)',
                  color: '#1a0e00',
                  border: '1px solid rgba(200,146,10,0.4)',
                  letterSpacing: '0.12em',
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
                SPIN
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
