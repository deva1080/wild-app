'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useDelegatedPlay } from '@/lib/web3/hooks/useDelegatedPlay';
import { usePreflightCheck } from '@/lib/web3/hooks/usePreflightCheck';
import { encodeFlipChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];

// ─── Coin SVG ───────────────────────────────────────────────────────────────
function CoinFace({
  side,
  size = 220,
  spinning = false,
}: {
  side: 0 | 1;
  size?: number;
  spinning?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        animation: spinning ? 'coinSpinFast 0.55s linear infinite' : undefined,
      }}
      className="relative rounded-full flex items-center justify-center select-none"
    >
      {/* Outer ring glow */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'radial-gradient(circle at 38% 32%, #ffe066 0%, #c8920a 55%, #7a4e00 100%)',
          boxShadow: '0 0 60px 10px rgba(200,146,10,0.35), 0 0 0 6px rgba(200,146,10,0.18), inset 0 2px 8px rgba(255,230,100,0.4)',
        }}
      />
      {/* Inner circle */}
      <div
        className="absolute rounded-full"
        style={{
          inset: '14px',
          background: 'radial-gradient(circle at 36% 30%, #f5d060 0%, #b87c0a 60%, #7a4e00 100%)',
        }}
      />
      {/* Icon */}
      <div className="relative z-10 flex flex-col items-center gap-1">
        {side === 0 ? (
          <svg width={size * 0.38} height={size * 0.32} viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 36h40M4 36L8 14l10 10L24 6l6 18 10-10 4 22H4z" stroke="#7a4e00" strokeWidth="3" strokeLinejoin="round" fill="rgba(255,200,50,0.25)" />
            <circle cx="4" cy="14" r="3" fill="#7a4e00" />
            <circle cx="24" cy="6" r="3" fill="#7a4e00" />
            <circle cx="44" cy="14" r="3" fill="#7a4e00" />
          </svg>
        ) : (
          <svg width={size * 0.32} height={size * 0.32} viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="18" stroke="#7a4e00" strokeWidth="4" />
            <circle cx="24" cy="24" r="8" fill="#7a4e00" opacity="0.3" />
          </svg>
        )}
        <span
          className="font-black tracking-widest uppercase"
          style={{ fontSize: size * 0.085, color: '#7a4e00', letterSpacing: '0.15em' }}
        >
          {side === 0 ? 'HEADS' : 'TAILS'}
        </span>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function FlipPage() {
  const { address } = useAccount();
  const { wildBalance, pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.flip);
  const { playStandard, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const result = useGameResultFlow();
  const { mode: txMode } = useTxMode();

  const [side, setSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);

  const pendingBetId = contractPendingBet && contractPendingBet !== BigInt(0) ? contractPendingBet : null;
  const balStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toFixed(2) : '0.00';

  const resultPhase = result.state?.phase ?? 'idle';
  const resultPayout = result.state?.phase === 'result' ? result.state.payout : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const isSpinning = loading;
  const isResult = resultPhase === 'result';
  const isError = resultPhase === 'error';
  const isWin = isResult && resultPayout !== undefined && resultPayout > BigInt(0);

  // Show the side that actually landed: player's pick if win, opposite if loss
  const displaySide: 0 | 1 = isResult
    ? (isWin ? side : (side === 0 ? 1 : 0))
    : side;

  // Status message while spinning
  const spinLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  const handlePlay = async () => {
    if (!address) return;

    // Clear previous result before starting a new game
    if (result.state !== null) result.close();

    setLoading(true);
    try {
      const gameChoice = encodeFlipChoice(side, 1);
      const weiAmount = parseEther(amount);

      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.flip); return; }

      if (txMode !== 'delegated') {
        const issues = await check(addresses.games.flip, weiAmount);
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length > 0) { result.error(errors.map((e) => e.message).join('\n')); return; }
      }

      if (txMode === 'delegated') {
        result.startPlacing();
        if (!authorizedPlays || authorizedPlays === BigInt(0)) await setupDelegatedPlay(BigInt(100));
        const txHash = await requestDelegatedPlay(addresses.games.flip, address, addresses.wildToken, weiAmount, gameChoice, false);
        await result.waitForDelegatedTx(txHash);
      } else {
        result.startPlacing();
        const playResult = await playStandard(addresses.games.flip, gameChoice, weiAmount);
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
        <CoinFace side={0} size={140} />
        <h1 className="text-3xl font-black text-amber-100 tracking-tight">Coin Flip</h1>
        <p className="text-zinc-400 text-center max-w-xs">Pick a side. Double your bet. 50/50 odds.</p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-amber-500/10 bg-[#0d0d0d]/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm font-bold">
          <span className="text-amber-400">♦</span>
          $WILD
          <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
        </div>

        <div className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-zinc-600">
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 ${txMode === 'delegated' ? 'text-amber-400' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          {txMode === 'delegated' ? <span className="text-amber-400">Fast TX</span> : 'Standard TX'}
        </div>
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.flip} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Coin area (flex-1) ── */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden gap-5">
        {/* Radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-72 rounded-full bg-amber-500/6 blur-3xl" />
        </div>

        {/* Decorative shadow coins */}
        {!isSpinning && !isResult && (
          <>
            <div className="absolute left-[8%] top-1/2 -translate-y-1/2 opacity-10">
              <CoinFace side={1} size={110} />
            </div>
            <div className="absolute right-[8%] top-1/2 -translate-y-1/2 opacity-10">
              <CoinFace side={1} size={90} />
            </div>
          </>
        )}

        {/* Coin — always visible */}
        <div className="relative z-10">
          <CoinFace side={displaySide} size={220} spinning={isSpinning} />
        </div>

        {/* Status text below coin while spinning */}
        {isSpinning && spinLabel && (
          <p className="relative z-10 text-amber-300/70 text-sm font-medium tracking-wide animate-pulse">
            {spinLabel}
          </p>
        )}

        {/* Result text below coin */}
        {isResult && (
          <div
            className="relative z-10 flex flex-col items-center gap-1"
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
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div
            className="relative z-10 flex flex-col items-center gap-2"
            style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
          >
            <p className="text-red-400 font-bold">Something went wrong</p>
            <button
              onClick={() => result.close()}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom controls panel ── */}
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#111111] border border-zinc-800/80 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-zinc-800/80">

            {/* Column 1: BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet Amount</p>

              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">♦</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  disabled={isSpinning}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40"
                />
                <div className="flex flex-col gap-0.5">
                  <button
                    disabled={isSpinning}
                    onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >+</button>
                  <button
                    disabled={isSpinning}
                    onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >−</button>
                </div>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    disabled={isSpinning}
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
                    disabled={isSpinning}
                    onClick={() => setAmount(Number(formatEther(wildBalance as bigint)).toFixed(2))}
                    className="px-2 py-1 rounded text-xs font-bold border bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    MAX
                  </button>
                )}
              </div>

              <p className="text-[10px] text-zinc-600">Balance: {balStr} WILD</p>
            </div>

            {/* Column 2: CHOOSE SIDE */}
            <div className="p-4 flex flex-col items-center justify-center gap-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Choose Side</p>
              <div className="flex items-center gap-3 w-full">
                <button
                  disabled={isSpinning}
                  onClick={() => setSide(0)}
                  className={`flex-1 py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 0
                      ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_20px_rgba(251,191,36,0.15)]'
                      : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                  }`}
                >
                  <svg width="22" height="18" viewBox="0 0 48 40" fill="none">
                    <path d="M4 36h40M4 36L8 14l10 10L24 6l6 18 10-10 4 22H4z" stroke={side === 0 ? '#f59e0b' : '#52525b'} strokeWidth="3" strokeLinejoin="round" fill={side === 0 ? 'rgba(245,158,11,0.2)' : 'none'}/>
                    <circle cx="4" cy="14" r="3" fill={side === 0 ? '#f59e0b' : '#52525b'}/>
                    <circle cx="24" cy="6" r="3" fill={side === 0 ? '#f59e0b' : '#52525b'}/>
                    <circle cx="44" cy="14" r="3" fill={side === 0 ? '#f59e0b' : '#52525b'}/>
                  </svg>
                  <span className={`text-[10px] font-bold tracking-wider ${side === 0 ? 'text-amber-300' : 'text-zinc-500'}`}>HEADS</span>
                </button>

                <span className="text-zinc-600 text-xs font-bold">vs</span>

                <button
                  disabled={isSpinning}
                  onClick={() => setSide(1)}
                  className={`flex-1 py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 1
                      ? 'border-zinc-400 bg-zinc-500/15 shadow-[0_0_20px_rgba(161,161,170,0.12)]'
                      : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                  }`}
                >
                  <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="18" stroke={side === 1 ? '#a1a1aa' : '#52525b'} strokeWidth="4"/>
                    <circle cx="24" cy="24" r="8" fill={side === 1 ? 'rgba(161,161,170,0.25)' : 'none'}/>
                  </svg>
                  <span className={`text-[10px] font-bold tracking-wider ${side === 1 ? 'text-zinc-300' : 'text-zinc-500'}`}>TAILS</span>
                </button>
              </div>
            </div>

            {/* Column 3: FLIP button */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading}
                className="w-full h-full min-h-[90px] rounded-xl font-black text-2xl tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #d4a017 0%, #c8920a 40%, #8b6000 100%)',
                  boxShadow: loading ? 'none' : '0 0 30px rgba(200,146,10,0.3), inset 0 1px 0 rgba(255,220,80,0.3)',
                  color: '#1a0e00',
                  border: '1px solid rgba(200,146,10,0.4)',
                  letterSpacing: '0.12em',
                }}
              >
                FLIP
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
