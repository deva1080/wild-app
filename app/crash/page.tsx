'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useDelegatedPlay } from '@/lib/web3/hooks/useDelegatedPlay';
import { usePreflightCheck } from '@/lib/web3/hooks/usePreflightCheck';
import { encodeCrashChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const MULT_OPTIONS = [110, 150, 200, 500, 1000, 5000];

/** Format basis-point multiplier → "2.45x" */
function fmtMult(bp: number): string {
  return (bp / 100).toFixed(2) + 'x';
}

// ── Crash Chart ────────────────────────────────────────────────────────────────

const STARS: [number, number][] = [
  [0.07, 0.18], [0.20, 0.65], [0.36, 0.12], [0.52, 0.40], [0.70, 0.22],
  [0.87, 0.55], [0.13, 0.50], [0.46, 0.78], [0.93, 0.32], [0.30, 0.87],
  [0.61, 0.15], [0.79, 0.70], [0.04, 0.80], [0.43, 0.33], [0.96, 0.60],
  [0.24, 0.28], [0.67, 0.85], [0.82, 0.42], [0.15, 0.92], [0.55, 0.58],
];

function CrashChart({
  displayMult,
  targetMult,
  refMult,
  animating,
  showFinalResult,
  isWin,
  loading,
}: {
  displayMult: number;
  targetMult: number;
  refMult: number;
  animating: boolean;
  showFinalResult: boolean;
  isWin: boolean;
  loading: boolean;
}) {
  const W = 560, H = 220;
  const padL = 46, padB = 28, padT = 16, padR = 52;
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
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
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

      {/* Stars */}
      {STARS.map(([fx, fy], i) => (
        <circle
          key={i}
          cx={padL + fx * cW}
          cy={padT + fy * cH}
          r={i % 3 === 0 ? 1.4 : 0.9}
          fill="rgba(255,255,255,0.28)"
        />
      ))}

      {/* Crown silhouette (background watermark) */}
      <g opacity="0.055" transform={`translate(${W / 2 - 52},${padT + 10}) scale(2.2)`}>
        <path d="M4 32h40M4 32L8 12l10 9L24 4l6 17 10-9 4 20H4z" fill="#c8920a" />
        <circle cx="4" cy="12" r="2.8" fill="#c8920a" />
        <circle cx="24" cy="4" r="2.8" fill="#c8920a" />
        <circle cx="44" cy="12" r="2.8" fill="#c8920a" />
      </g>

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
  const { wildBalance, pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.crash);
  const { playStandard, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const result = useGameResultFlow();
  const { mode: txMode } = useTxMode();

  const [amount, setAmount] = useState('1');
  const [multiplier, setMultiplier] = useState(200);
  const [loading, setLoading] = useState(false);

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
  const balStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toFixed(2) : '0.00';

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
      setTargetMult(tm);
      setDisplayMult(100);
      setAnimating(true);
      setShowFinalResult(false);

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
      const gameChoice = encodeCrashChoice(BigInt(multiplier), 1);
      const weiAmount = parseEther(amount);

      if (pendingBetId) { result.stuck(pendingBetId as bigint, addresses.games.crash); return; }

      if (txMode !== 'delegated') {
        const issues = await check(addresses.games.crash, weiAmount);
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length > 0) { result.error(errors.map((e) => e.message).join('\n')); return; }
      }

      if (txMode === 'delegated') {
        result.startPlacing();
        if (!authorizedPlays || authorizedPlays === BigInt(0)) await setupDelegatedPlay(BigInt(100));
        const txHash = await requestDelegatedPlay(addresses.games.crash, address, addresses.wildToken, weiAmount, gameChoice, false);
        await result.waitForDelegatedTx(txHash);
      } else {
        result.startPlacing();
        const playResult = await playStandard(addresses.games.crash, gameChoice, weiAmount);
        result.betPlaced(playResult.betId, playResult.gameAddress);
        const settleTxHash = await requestSettle(playResult.gameAddress, playResult.betId);
        await result.waitForSettleTx(settleTxHash);
      }
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
        <h1 className="text-3xl font-black text-amber-100 tracking-tight">Crash</h1>
        <p className="text-zinc-400 text-center max-w-xs">Set your target multiplier. If the crash goes above it, you win.</p>
        <WalletButton />
      </div>
    );
  }

  // Determine center display
  const isIdle = !loading && !animating && !showFinalResult && resultPhase === 'idle';

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-amber-500/10 bg-[#0d0d0d]/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm font-bold">
          <span className="text-amber-400">♦</span>
          $WILD
          <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
        </div>

        {/* ── Speed toggle ── */}
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/60 bg-zinc-900/70 p-0.5">
          {([1, 2, 3] as const).map((lvl) => {
            const active = animSpeed === lvl;
            return (
              <button
                key={lvl}
                disabled={isPlaying}
                onClick={() => { setAnimSpeed(lvl); animSpeedRef.current = lvl; }}
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

        <div className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-zinc-600">
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${txMode === 'delegated' ? 'text-amber-400' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          {txMode === 'delegated' ? <span className="text-amber-400">Fast TX</span> : 'Standard TX'}
        </div>
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.crash} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: chart ── */}
      <div
        className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.8)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >

        {/* Chart */}
        <div className="absolute inset-0 px-2 py-1">
          <CrashChart
            displayMult={animating || showFinalResult ? displayMult : 100}
            targetMult={targetMult}
            refMult={multiplier}
            animating={animating}
            showFinalResult={showFinalResult}
            isWin={isWin}
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
                  +{Number(formatEther(resultPayout)).toFixed(2)} <span className="text-green-400/60 text-sm">WILD</span>
                </p>
              )}
              {!isWin && resultTotalBet !== undefined && (
                <p className="text-sm text-zinc-400">
                  −{Number(formatEther(resultTotalBet)).toFixed(2)} WILD
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
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#111111] border border-zinc-800/80 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-zinc-800/80">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet Amount</p>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">♦</span>
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={isPlaying}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={isPlaying} onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                  <button disabled={isPlaying} onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {CHIP_VALUES.map((v) => (
                  <button key={v} disabled={isPlaying} onClick={() => setAmount(v)}
                    className={`px-2 py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      amount === v ? 'bg-amber-500/25 border-amber-400/50 text-amber-200' : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}>{v}</button>
                ))}
                {wildBalance && (
                  <button disabled={isPlaying} onClick={() => setAmount(Number(formatEther(wildBalance as bigint)).toFixed(2))}
                    className="px-2 py-1 rounded text-xs font-bold border bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed">MAX</button>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">Balance: {balStr} WILD</p>
            </div>

            {/* MULTIPLIER */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Multiplier</p>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">♦</span>
                <span className={`flex-1 text-xl font-black tabular-nums ${isPlaying ? 'text-zinc-500' : 'text-zinc-100'}`}>
                  {fmtMult(multiplier)}
                </span>
                <div className="flex flex-col gap-0.5">
                  <button disabled={isPlaying} onClick={() => setMultiplier((v) => Math.min(v + 10, 10000))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                  <button disabled={isPlaying} onClick={() => setMultiplier((v) => Math.max(v - 10, 110))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {MULT_OPTIONS.map((v) => (
                  <button key={v} disabled={isPlaying} onClick={() => setMultiplier(v)}
                    className={`px-2 py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      multiplier === v ? 'bg-amber-500/25 border-amber-400/50 text-amber-200' : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}>{fmtMult(v)}</button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600">Win if crash ≥ {fmtMult(multiplier)}</p>
            </div>

            {/* LAUNCH */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={isPlaying}
                className="w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #d4a017 0%, #c8920a 40%, #8b6000 100%)',
                  boxShadow: isPlaying ? 'none' : '0 0 30px rgba(200,146,10,0.3), inset 0 1px 0 rgba(255,220,80,0.3)',
                  border: '1px solid rgba(200,146,10,0.4)',
                  color: '#1a0e00',
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
                  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
                  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
                  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
                </svg>
                <span className="font-black text-xl tracking-widest" style={{ letterSpacing: '0.12em' }}>
                  LAUNCH
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
