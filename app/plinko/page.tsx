'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CircleDollarSign, CircleDot } from 'lucide-react';
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
import { GameInfoButton, GameInfoModal } from '@/components/GameInfoModal';

// This Plinko reuses the WheelGame contract. configId 2 is a symmetric
// distribution: the contract returns a single outcome = the bin index the
// ball lands in. We just animate a ball falling into that bin.
const PLINKO_CONFIG_ID = 1;
const CHIP_VALUES = ['1', '5', '10', '50', '100'];

// SVG board dimensions
const VW = 420;
const VH = 460;
const MARGIN_X = 34;
const TOP_Y = 44;
const BINS_GAP = 96; // reserved vertical space for bins at the bottom

function formatMultiplier(bp: bigint): string {
  const value = Number(bp) / 10000;
  if (value === 0) return '0x';
  if (value >= 10 || Number.isInteger(value)) return value + 'x';
  return value.toFixed(1) + 'x';
}

/**
 * Computes the live, on-chain-config-dependent net RTP for Plinko.
 *
 * Plinko is a different front-end visualization of the exact same on-chain
 * weighted-wheel contract (WheelGame.sol) as the Wheel game — each "bin" is
 * just one of the contract's weighted segments. `weightRanges` is CUMULATIVE
 * (segment i's own weight = weightRanges[i] - weightRanges[i-1], except
 * segment 0 whose weight = weightRanges[0]; total weight = the last entry).
 * The internal RTP is the weight-weighted average of the bin multipliers (in
 * basis points); WheelGame.sol's config validation guarantees that figure is
 * ≤ 100% internally, but the exact value depends on whatever weights/
 * multipliers are configured on-chain for this config id. BaseGame.sol's
 * universal explosionRate mechanic (default 4, not overridden by WheelGame)
 * silently folds in a flat 5% instant-loss chance on every bet, so the real
 * net RTP is the internal figure × 0.95.
 */
function computePlinkoRtp(weightRanges: bigint[], multipliers: bigint[]): number {
  if (weightRanges.length === 0 || multipliers.length === 0) return 0;
  let weightedSum = 0n;
  let prev = 0n;
  const totalWeight = weightRanges[weightRanges.length - 1];
  if (totalWeight <= 0n) return 0;
  for (let i = 0; i < weightRanges.length; i++) {
    const binWeight = weightRanges[i] - prev;
    prev = weightRanges[i];
    weightedSum += binWeight * (multipliers[i] ?? 0n);
  }
  const internalRtp = Number(weightedSum) / (Number(totalWeight) * 10000);
  const netRtp = internalRtp * 0.95;
  return netRtp * 100;
}

// Visual style for a bin based on its multiplier value.
function binStyle(bp: bigint): { fill: string; text: string; glow: string } {
  const v = Number(bp) / 10000;
  if (v >= 5) return { fill: 'url(#plinkoGoldGrad)', text: '#1a1205', glow: 'rgba(222,188,110,0.7)' };
  if (v >= 2) return { fill: '#debc6e', text: '#1a1205', glow: 'rgba(222,188,110,0.45)' };
  if (v >= 1) return { fill: '#3a2c0c', text: '#debc6e', glow: 'rgba(222,188,110,0.2)' };
  return { fill: '#1a1a1a', text: '#a1a1aa', glow: 'rgba(0,0,0,0)' };
}

interface Point { x: number; y: number; }
interface BallView { pos: Point; trail: Point[]; squash?: number }
interface Impact { x: number; y: number; age: number }

const IMPACT_DURATION = 260; // ms, how long a bounce flash/ring stays visible

const BALL_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// Per-row base duration (ms) at 1× speed. The speed multiplier scales this
// (level 1 = 2× = half speed default, level 2 = 1×, level 3 = 0.5×).
const BASE_ROW_MS = 230;

export default function PlinkoPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.wheel);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.wheel);
  const { config, isLoading: isLoadingConfig } = useWheelConfig(PLINKO_CONFIG_ID);
  const { playClick, playChip, playSfx } = useGameAudio('plinko');

  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [isDropping, setIsDropping] = useState(false);
  const [showFinalResult, setShowFinalResult] = useState(false);
  const [landedBins, setLandedBins] = useState<number[]>([]);
  const [balls, setBalls] = useState<(BallView | null)[]>([]);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const impactsRef = useRef<{ x: number; y: number; start: number }[]>([]);
  const [ballCount, setBallCount] = useState(1);
  const [animSpeed, setAnimSpeed] = useState<1 | 2 | 3>(1); // 1 = slow (default), 3 = fast
  const [showInfoModal, setShowInfoModal] = useState(false);
  const animSpeedRef = useRef<1 | 2 | 3>(1);

  const rafRef = useRef<number>(0);
  const animStartedRef = useRef(false);

  const pendingBetId = contractPendingBet && contractPendingBet !== BigInt(0) ? contractPendingBet : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  // `amount` is the stake PER BALL. The total wagered (and the value sent to
  // the contract) is amount × ballCount; the contract splits it back per roll.
  const perBallNum = parseFloat(amount || '0');
  const totalBetNum = Number.isFinite(perBallNum) ? perBallNum * ballCount : 0;
  const totalBetStr = String(Number(totalBetNum.toFixed(8)));

  const resultPhase = result.state?.phase ?? 'idle';
  const isWin = result.state?.phase === 'result' && result.state.payout > BigInt(0);
  const resultPayout = result.state?.phase === 'result' ? result.state.payout : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const waitLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  const multipliers = useMemo(() => config?.multipliers ?? [], [config]);
  const binCount = multipliers.length || 9;
  const rows = binCount - 1; // decision rows in the binomial lattice

  // Live RTP, computed from the currently-loaded on-chain config. Falls back
  // to null while config is loading/unavailable so the modal simply omits
  // the rtp prop rather than showing a stale or invented number.
  const rtpLabel = useMemo(() => {
    if (!config || config.weightRanges.length === 0) return null;
    const pct = computePlinkoRtp(config.weightRanges, config.multipliers);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    return `~${pct.toFixed(1)}%`;
  }, [config]);

  // ── Board geometry ─────────────────────────────────────────────────────────
  const geometry = useMemo(() => {
    const usableW = VW - 2 * MARGIN_X;
    const u = usableW / binCount;               // horizontal unit between lattice nodes
    const cx = VW / 2;
    const rowSpacing = (VH - TOP_Y - BINS_GAP) / rows;
    const binsTop = TOP_Y + rows * rowSpacing + 18;

    // node position for lattice (row r, index p in 0..r)
    const node = (r: number, p: number): Point => ({
      x: cx + (p - r / 2) * u,
      y: TOP_Y + r * rowSpacing,
    });

    // bin center x for bin i (aligned with bottom-row nodes)
    const binCenterX = (i: number) => cx + (i - rows / 2) * u;

    return { u, cx, rowSpacing, binsTop, node, binCenterX };
  }, [binCount, rows]);

  // Pegs to render (interior lattice nodes)
  const pegs = useMemo(() => {
    const out: Point[] = [];
    for (let r = 1; r <= rows; r++) {
      for (let p = 0; p <= r; p++) {
        out.push(geometry.node(r, p));
      }
    }
    return out;
  }, [rows, geometry]);

  // ── Build a single ball's bounce timeline toward a target bin ───────────────
  const buildTimeline = useCallback((targetBin: number, speedMul: number, landOffsetX = 0) => {
    // Build a left/right move sequence with exactly `targetBin` right-moves.
    const moves: number[] = new Array(rows).fill(0);
    const rightIndices = Array.from({ length: rows }, (_, i) => i);
    for (let i = rightIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rightIndices[i], rightIndices[j]] = [rightIndices[j], rightIndices[i]];
    }
    for (let k = 0; k < targetBin; k++) moves[rightIndices[k]] = 1;

    // The ball rests on TOP of each pin (collision offset) instead of passing
    // through its center, so arcs hop between pins like a real bounce.
    const BALL_R = 7;
    const PIN_R = 2.6;
    const offset = BALL_R + PIN_R;

    const stops: Point[] = [];
    stops.push({ x: geometry.cx, y: TOP_Y - 18 }); // spawn above the board
    let p = 0;
    for (let r = 0; r < rows; r++) {
      p += moves[r];
      const n = geometry.node(r + 1, p);
      stops.push({ x: n.x, y: n.y - offset });
    }
    stops.push({ x: geometry.binCenterX(targetBin) + landOffsetX, y: geometry.binsTop + 4 }); // bin landing

    type Ease = 'arc' | 'in' | 'out';
    interface Seg { from: Point; to: Point; dur: number; arc: number; ease: Ease; }
    const segs: Seg[] = [];
    const nSeg = stops.length - 1;
    for (let i = 0; i < nSeg; i++) {
      const from = stops[i];
      const to = stops[i + 1];
      const isFirst = i === 0;
      const isLast = i === nSeg - 1;
      const prog = i / nSeg;
      // Acceleration: gravity pulls the ball faster as it descends.
      const base = BASE_ROW_MS - Math.sqrt(prog) * 95;
      const raw = isFirst ? 300 : isLast ? 175 : base;
      // speedMul applies the global speed level (level 1 = half speed = 2×).
      const dur = raw * (0.94 + Math.random() * 0.12) * speedMul;
      const arc = isFirst ? 0 : isLast ? 9 : Math.max(4, 13 - prog * 7) + Math.random() * 3;
      segs.push({ from, to, dur, arc, ease: isFirst ? 'in' : 'arc' });
    }
    // Small settle bounce inside the bucket.
    const landing = stops[stops.length - 1];
    const bounceTop = { x: landing.x, y: landing.y - 7 };
    segs.push({ from: landing, to: bounceTop, dur: 95 * speedMul, arc: 0, ease: 'out' });
    segs.push({ from: bounceTop, to: landing, dur: 85 * speedMul, arc: 0, ease: 'in' });

    const total = segs.reduce((s, seg) => s + seg.dur, 0);
    return { segs, total, landing };
  }, [rows, geometry]);

  // ── Drop N balls toward their resolved bins (single RAF, staggered start) ────
  const dropBalls = useCallback((targetBins: number[]) => {
    cancelAnimationFrame(rafRef.current);
    setIsDropping(true);
    setLandedBins([]);
    impactsRef.current = [];
    setImpacts([]);

    const speedMul = 2 / Math.pow(2, animSpeedRef.current - 1); // 1→2x, 2→1x, 3→0.5x
    const stagger = 170 * speedMul;

    const qBezier = (t: number, a: Point, c: Point, b: Point): Point => {
      const mt = 1 - t;
      return {
        x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
        y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
      };
    };

    // Spread balls that land in the same bin so they don't perfectly overlap.
    const binTotal: Record<number, number> = {};
    targetBins.forEach((b) => { binTotal[b] = (binTotal[b] ?? 0) + 1; });
    const binSeen: Record<number, number> = {};
    const maxSpread = Math.min(geometry.u * 0.55, 16);

    const tracks = targetBins.map((bin, i) => {
      const n = binTotal[bin];
      const k = binSeen[bin] ?? 0;
      binSeen[bin] = k + 1;
      const offset = n > 1 ? (k / (n - 1) - 0.5) * maxSpread : 0;
      return {
        ...buildTimeline(bin, speedMul, offset),
        delay: i * stagger,
        trail: [] as Point[],
        lastSegIdx: -1,
        lastImpactLocal: -Infinity,
      };
    });

    const start = performance.now();
    const maxEnd = Math.max(...tracks.map((tr) => tr.delay + tr.total), 1);

    const tick = (now: number) => {
      const elapsed = now - start;
      const views: (BallView | null)[] = tracks.map((tr) => {
        const local = elapsed - tr.delay;
        if (local < 0) return null; // not dropped yet
        if (local >= tr.total) {
          tr.trail = [];
          return { pos: tr.landing, trail: [], squash: 0 };
        }
        // Locate active segment.
        let acc = 0;
        let seg = tr.segs[0];
        let segElapsed = local;
        let segIdx = 0;
        for (let s = 0; s < tr.segs.length; s++) {
          if (local < acc + tr.segs[s].dur) { seg = tr.segs[s]; segElapsed = local - acc; segIdx = s; break; }
          acc += tr.segs[s].dur;
        }
        // Detect a bounce: we just crossed into a new segment, meaning the
        // ball collided with a peg (or the bin floor) at the previous stop.
        if (tr.lastSegIdx !== -1 && segIdx !== tr.lastSegIdx) {
          tr.lastImpactLocal = local;
          impactsRef.current.push({ x: seg.from.x, y: seg.from.y, start: now });
          playSfx('bounce');
        }
        tr.lastSegIdx = segIdx;

        const t = seg.dur > 0 ? Math.min(segElapsed / seg.dur, 1) : 1;
        let pos: Point;
        if (seg.arc > 0) {
          const ctrl = { x: (seg.from.x + seg.to.x) / 2, y: Math.min(seg.from.y, seg.to.y) - seg.arc };
          pos = qBezier(t, seg.from, ctrl, seg.to);
        } else {
          const e = seg.ease === 'in' ? t * t : seg.ease === 'out' ? 1 - (1 - t) * (1 - t) : t;
          pos = { x: seg.from.x + (seg.to.x - seg.from.x) * t, y: seg.from.y + (seg.to.y - seg.from.y) * e };
        }
        tr.trail.unshift(pos);
        if (tr.trail.length > 6) tr.trail.pop();
        // Squash-and-stretch: spikes to 1 right on impact, springs back out.
        const sinceImpact = local - tr.lastImpactLocal;
        const squash = Math.exp(-sinceImpact / 45);
        return { pos, trail: [...tr.trail], squash };
      });

      setBalls(views);
      impactsRef.current = impactsRef.current.filter((im) => now - im.start < IMPACT_DURATION);
      setImpacts(impactsRef.current.map((im) => ({ x: im.x, y: im.y, age: (now - im.start) / IMPACT_DURATION })));

      if (elapsed >= maxEnd) {
        setBalls(tracks.map((tr) => ({ pos: tr.landing, trail: [], squash: 0 })));
        impactsRef.current = [];
        setImpacts([]);
        setLandedBins(targetBins);
        setIsDropping(false);
        setShowFinalResult(true);
        playSfx('bucket');
        playSfx('defaultResult');
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [buildTimeline, geometry.u, playSfx]);

  const wasPlayingRef = useRef(false);

  // React to the settled result → drop each ball into its resolved bin.
  useEffect(() => {
    if (result.state?.phase === 'result' && !animStartedRef.current) {
      animStartedRef.current = true;
      // Same outcome→index mapping as the Wheel: each outcome is a bin index.
      const outcomes = result.state.outcomes;
      const bins = (outcomes.length > 0 ? outcomes : [BigInt(0)]).map((o) => {
        const raw = Number(o);
        return ((raw % binCount) + binCount) % binCount;
      });
      dropBalls(bins);
    }
    if (result.state && result.state.phase !== 'result') {
      wasPlayingRef.current = true;
    }
    if (!result.state && (animStartedRef.current || wasPlayingRef.current)) {
      cancelAnimationFrame(rafRef.current);
      animStartedRef.current = false;
      wasPlayingRef.current = false;
      setShowFinalResult(false);
      setLandedBins([]);
      setBalls([]);
      impactsRef.current = [];
      setImpacts([]);
    }
  }, [result.state, dropBalls, binCount]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const handlePlay = async () => {
    if (!address || !config) return;
    playClick();
    cancelAnimationFrame(rafRef.current);
    animStartedRef.current = false;
    setShowFinalResult(false);
    setLandedBins([]);
    impactsRef.current = [];
    setImpacts([]);
    // Show the pending balls resting at the top while the bet is placed.
    setBalls(Array.from({ length: ballCount }, () => ({ pos: { x: geometry.cx, y: TOP_Y - 18 }, trail: [] })));
    if (result.state !== null) result.close();
    setLoading(true);
    try {
      if (pendingBetId) {
        result.stuck(pendingBetId as bigint, addresses.games.wheel);
        return;
      }
      const gameChoice = encodeWheelChoice(config.configId, ballCount, BigInt(0), BigInt(0));
      // Send the TOTAL (per-ball × balls). If it gets clamped to the balance,
      // divide back so the per-ball field stays consistent.
      await bet.play(gameChoice, totalBetStr, result, (clampedTotal) => {
        const perBall = parseFloat(clampedTotal) / ballCount;
        setAmount(perBall.toFixed(2));
      });
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
      setBalls([]);
    } finally {
      setLoading(false);
    }
  };

  // ── Guard states ────────────────────────────────────────────────────────────
  if (isLoadingConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: 'rgba(222,188,110,0.4)', borderTopColor: '#debc6e' }} />
        <p className="text-zinc-400 text-sm tracking-wide">Loading Plinko board…</p>
      </div>
    );
  }

  if (!config || multipliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <p className="text-zinc-400 text-center max-w-xs">
          No Plinko configuration available (config #{PLINKO_CONFIG_ID}).
        </p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-6xl select-none" style={{ filter: 'drop-shadow(0 0 24px rgba(222,188,110,0.35))' }}>🔻</div>
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
        >Plinko</h1>
        <p className="text-zinc-400 text-center max-w-xs">Drop the ball and watch it bounce into a multiplier.</p>
        <WalletButton />
      </div>
    );
  }

  const isPlaying = loading || isDropping || ['placing', 'waiting-settle', 'settling'].includes(resultPhase);

  return (
    <div className="flex flex-col h-full">

      {/* Global gradient defs */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="plinko-gold-grad" x1="0" y1="0" x2="1" y2="1">
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
                title={['Slow', 'Normal', 'Fast'][lvl - 1]}
              >
                {'›'.repeat(lvl)}
              </button>
            );
          })}
        </div>

        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden ml-2 border-l border-amber-400/20 pl-4">
          <RecentOutcomes
            gameAddress={addresses.games.wheel}
            renderOutcome={(o) => {
              const idx = ((o % binCount) + binCount) % binCount;
              const mult = multipliers[idx];
              const isGood = mult !== undefined && mult >= 20000n;
              return (
                <div className={`px-2 py-0.5 rounded-md font-bold text-[10px] mx-0.5 whitespace-nowrap font-mono
                  ${isGood ? 'text-amber-300 bg-amber-400/10' : 'text-zinc-400 bg-zinc-800'}`}>
                  {mult !== undefined ? formatMultiplier(mult) : `#${idx}`}
                </div>
              );
            }}
          />
        </div>

        <GameInfoButton onClick={() => setShowInfoModal(true)} />

        <div className="ml-auto">
          <FastTxToggle disabled={isPlaying} />
        </div>
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.wheel} betId={pendingBetId as bigint} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Board area ── */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a]">

        {/* Radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[70%] aspect-square max-w-[640px] rounded-full bg-amber-500/4 blur-3xl" />
        </div>

        <div className="relative z-10 w-full h-full flex items-center justify-center p-2 sm:p-4">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
          >
            <defs>
              <radialGradient id="plinkoBallGrad" cx="35%" cy="35%" r="65%">
                <stop offset="0%" stopColor="#fff7e0" />
                <stop offset="55%" stopColor="#debc6e" />
                <stop offset="100%" stopColor="#8c6825" />
              </radialGradient>
              <linearGradient id="plinkoGoldGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#debc6e" />
                <stop offset="100%" stopColor="#8c6825" />
              </linearGradient>
              {/* Generous filter region so the blur fades out smoothly instead
                  of being clipped to the (square) default bounding box. */}
              <filter id="plinkoGlow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Pegs */}
            {pegs.map((peg, i) => (
              <circle
                key={i}
                cx={peg.x}
                cy={peg.y}
                r={2.6}
                fill="rgba(222,188,110,0.55)"
              />
            ))}

            {/* Bins */}
            {multipliers.map((mult, i) => {
              const style = binStyle(mult);
              const x = geometry.binCenterX(i);
              const w = geometry.u * 0.86;
              const isLanded = showFinalResult && landedBins.includes(i);
              return (
                <g key={i}>
                  <rect
                    x={x - w / 2}
                    y={geometry.binsTop}
                    width={w}
                    height={34}
                    rx={5}
                    fill={style.fill}
                    stroke={isLanded ? '#4ade80' : 'rgba(0,0,0,0.3)'}
                    strokeWidth={isLanded ? 2.5 : 1}
                    filter={isLanded ? 'url(#plinkoGlow)' : undefined}
                    opacity={showFinalResult && !isLanded ? 0.45 : 1}
                    style={{ transition: 'opacity 0.3s' }}
                  />
                  <text
                    x={x}
                    y={geometry.binsTop + 22}
                    fill={isLanded ? '#4ade80' : style.text}
                    fontSize={binCount > 10 ? 8 : 10}
                    fontWeight="bold"
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {formatMultiplier(mult)}
                  </text>
                </g>
              );
            })}

            {/* Bounce impact flashes (rings at pegs/floor the ball just hit) */}
            {isDropping && impacts.map((im, i) => {
              if (im.age >= 1) return null;
              const fade = 1 - im.age;
              return (
                <g key={`impact-${i}`}>
                  <circle cx={im.x} cy={im.y} r={2.5 + im.age * 2} fill="#fff7e0" opacity={fade * 0.85} />
                  <circle
                    cx={im.x} cy={im.y}
                    r={3 + im.age * 10}
                    fill="none"
                    stroke="#debc6e"
                    strokeWidth={1.4}
                    opacity={fade * 0.55}
                  />
                </g>
              );
            })}

            {/* Balls + motion trails */}
            {balls.map((b, bi) => {
              if (!b) return null;
              const pulse = !isDropping && !showFinalResult && isPlaying;
              const squash = b.squash ?? 0;
              return (
                <g key={`ball-${bi}`}>
                  {isDropping && b.trail.map((pt, i) => (
                    <circle
                      key={`trail-${bi}-${i}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={7 * (1 - i / (b.trail.length + 1)) * 0.85}
                      fill="#debc6e"
                      opacity={0.16 * (1 - i / b.trail.length)}
                    />
                  ))}
                  <ellipse
                    cx={b.pos.x}
                    cy={b.pos.y}
                    rx={7 * (1 + squash * 0.32)}
                    ry={7 * (1 - squash * 0.28)}
                    fill="url(#plinkoBallGrad)"
                    filter="url(#plinkoGlow)"
                    style={{ animation: pulse ? 'plinkoPulse 1s ease-in-out infinite' : undefined }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <style>{`
          @keyframes plinkoPulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.45; }
          }
        `}</style>

        {/* Status text overlay (top) */}
        {isPlaying && waitLabel && !isDropping && !showFinalResult && (
          <p className="absolute top-4 left-1/2 -translate-x-1/2 text-amber-300/60 text-xs font-medium animate-pulse tracking-widest uppercase z-20">
            {waitLabel}
          </p>
        )}

        {/* Result overlay (center) */}
        {showFinalResult && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div
              className="flex flex-col items-center gap-1 rounded-2xl bg-black/55 backdrop-blur-sm px-8 py-6 pointer-events-auto"
              style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
            >
              <div
                className={`text-4xl font-black tracking-tight ${isWin ? 'text-green-400' : 'text-red-400'}`}
                style={{ textShadow: isWin ? '0 0 30px rgba(74,222,128,0.5)' : '0 0 30px rgba(248,113,113,0.5)' }}
              >
                {isWin ? 'WIN' : 'LOSS'}
              </div>
              {isWin && resultPayout !== undefined && (
                <p className="text-lg font-bold text-green-300">
                  +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                </p>
              )}
              {!isWin && resultTotalBet !== undefined && (
                <p className="text-sm text-zinc-400">
                  −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                </p>
              )}
              {landedBins.length > 1 && (
                <div className="flex flex-wrap gap-1 justify-center max-w-[220px] mt-1">
                  {landedBins.map((b, i) => {
                    const mult = multipliers[b];
                    const good = mult !== undefined && mult >= 10000n;
                    return (
                      <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${good ? 'text-amber-300 bg-amber-400/10' : 'text-zinc-400 bg-zinc-800'}`}>
                        {mult !== undefined ? formatMultiplier(mult) : `#${b}`}
                      </span>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => { result.close(); setShowFinalResult(false); setLandedBins([]); setBalls([]); }}
                className="mt-2 px-6 py-2 rounded-lg text-sm font-bold transition-colors"
                style={{
                  border: '1.5px solid transparent',
                  backgroundImage: 'linear-gradient(#161616, #161616), linear-gradient(20deg, #debc6e, #8c6825)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                  color: '#debc6e',
                }}
              >
                Drop Again
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Bottom controls ── */}
      <div className="flex-shrink-0 p-2 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-amber-400/10">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3 border-r border-amber-400/10 sm:border-r-0">
              <p className="text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Bet Amount
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#plinko-gold-grad)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount}
                  disabled={isPlaying}
                  onChange={(e) => { if (result.state !== null) result.close(); setAmount(e.target.value); }}
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

            {/* BALLS */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black uppercase tracking-widest"
                  style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                  Balls
                </p>
                <span className="text-xl font-black tabular-nums text-zinc-100">{ballCount}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {BALL_OPTIONS.map((n) => {
                  const active = ballCount === n;
                  return (
                    <button key={n}
                      disabled={isPlaying}
                      onClick={() => { playClick(); if (result.state !== null) result.close(); setBallCount(n); }}
                      className={`py-1.5 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}>
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase text-center">
                {ballCount > 1 ? `Total ${totalBetNum.toFixed(2)} ${bet.meta.symbol} · ` : ''}max {formatMultiplier(config.maxMultiplier)}
              </p>
            </div>

            {/* DROP BUTTON */}
            <div className="col-span-2 sm:col-span-1 p-4 flex items-center justify-center border-t border-amber-400/10 sm:border-t-0">
              <button
                onClick={handlePlay}
                disabled={isPlaying || showFinalResult}
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
                <svg className="w-8 h-8 sm:w-11 sm:h-11" viewBox="0 0 24 24" fill="none" stroke="url(#plinko-gold-grad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="2.5" />
                  <path d="M12 8v8" />
                  <path d="M8 13l4 4 4-4" />
                </svg>
                <span
                  className="font-black text-2xl sm:text-4xl tracking-[0.15em]"
                  style={{
                    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                    WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent',
                    filter: 'drop-shadow(0 0 10px rgba(222,188,110,0.5)) drop-shadow(0 0 24px rgba(222,188,110,0.25))',
                  }}
                >
                  DROP
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<CircleDot className="w-4 h-4" />}
        title="Plinko"
        description="Plinko visualizes a drop of one or more balls onto a pin board: each ball falls from the top, bounces left or right off a row of pegs on every row it passes, and finally comes to rest in one of the bins lined up along the bottom edge. Under the hood, every ball you drop is actually a single weighted-random outcome from the same on-chain wheel-style contract used elsewhere in the app — each bin simply corresponds to one of that contract's pre-configured payout segments, so the ball-and-peg animation is a faithful visualization of a fixed, on-chain-resolved outcome rather than a true physical simulation. You can drop multiple balls in the same round, each with its own independent stake and its own independently resolved bin, which lets you spread a single round across several simultaneous outcomes instead of committing your whole wager to one drop."
        steps={[
          'Choose your stake per ball and how many balls to drop in this round (1 to 10) — your total wager for the round is stake × number of balls.',
          'Press Drop to send the round on-chain; every ball you selected is included in the same transaction and resolved together.',
          'Each ball animates falling down the peg board independently, bouncing left or right at every row before settling into a bin at the bottom.',
          'The bin each ball lands in is not arbitrary — it corresponds to one of the contract\'s weighted outcome segments, each carrying its own fixed multiplier.',
          'Payout for each ball is credited as that ball\'s stake multiplied by its landing bin\'s multiplier, and the results across all balls in the round are summed into your total payout.',
        ]}
        sections={[
          {
            title: 'Board & Bins',
            content: (
              <div>
                <p className="text-xs text-zinc-300 mb-2 leading-relaxed">
                  This board currently resolves into {binCount} bins ({rows} peg rows deep). The multiplier shown on each bin is read live from the same on-chain configuration as the rest of the game, not hardcoded, so the values below are exactly what you can land on right now.
                </p>
                <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {multipliers.map((mult, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] rounded border border-zinc-800 px-2 py-1">
                      <span className="text-zinc-300 font-mono font-bold">{formatMultiplier(mult)}</span>
                      <span className="text-zinc-500 font-mono">{(100 / binCount).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            title: 'Payout Mechanics',
            content: (
              <p className="text-xs text-zinc-300 leading-relaxed">
                Each ball that lands pays out independently as stake × that bin&apos;s multiplier; with several balls dropped in the same round, some can land on low or zero-multiplier bins while others land on higher-paying ones, so your round result is the sum of every ball&apos;s individual outcome rather than a single all-or-nothing result. This makes multi-ball rounds inherently smoother in variance than dropping your entire wager on a single ball, even though the underlying odds per ball never change.
              </p>
            ),
          },
        ]}
        tip="Dropping more balls per round doesn't change your odds on any single ball, but it averages your outcomes together within the round — useful if you'd rather see a blend of results than one all-or-nothing drop."
        rtp={rtpLabel ?? undefined}
      />
    </div>
  );
}
