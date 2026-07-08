'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Coins } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeFlipChoice } from '@/lib/web3/utils/encoders';
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

const CROWN_PATH = "M 72.08 292.75 C71.86,270.58 68.77,242.72 63.93,219.15 C57.85,189.54 45.42,149.67 34.27,124.01 L 32.32 119.52 L 25.41 119.43 C11.09,119.23 1.61,109.93 1.53,96.00 C1.49,87.83 4.78,81.66 11.58,77.15 C26.68,67.16 46.07,76.66 47.72,94.87 C48.20,100.15 47.91,101.65 45.50,106.41 C43.98,109.43 42.11,112.13 41.36,112.41 C38.72,113.43 40.08,116.30 48.50,127.51 C52.92,133.39 58.32,140.19 69.96,154.54 C90.47,179.82 119.29,208.97 128.13,213.38 C132.83,215.72 133.47,215.81 136.03,214.48 C148.39,208.09 166.36,162.16 176.90,110.00 C181.61,86.69 186.38,56.43 185.56,55.10 C185.31,54.69 183.21,53.73 180.90,52.97 C174.79,50.95 167.70,43.62 165.52,37.07 C162.04,26.57 164.92,14.79 172.63,8.02 C183.94,-1.91 199.59,-1.42 210.10,9.20 C223.25,22.49 219.33,44.27 202.36,52.21 C198.86,53.85 196.00,55.52 196.00,55.92 C196.00,57.41 198.99,77.79 200.49,86.50 C210.68,145.80 227.28,195.84 241.86,211.25 C247.38,217.09 250.97,216.51 261.00,208.14 C277.13,194.68 312.23,156.10 327.50,135.03 C328.60,133.51 332.29,128.54 335.70,123.99 L 341.90 115.72 L 338.51 111.58 C334.20,106.32 332.93,102.94 332.87,96.58 C332.79,87.21 338.89,78.03 347.65,74.37 C352.26,72.45 360.06,72.66 365.17,74.87 C381.31,81.83 384.07,103.91 370.15,114.67 C365.69,118.12 356.92,120.52 352.68,119.46 C349.57,118.67 348.52,120.51 341.22,139.50 C327.24,175.84 316.78,216.77 312.60,251.50 C311.16,263.43 309.00,294.02 309.00,302.46 L 309.00 306.00 L 190.60 306.00 L 72.21 306.00 L 72.08 292.75 Z";

// ─── Coin SVG ───────────────────────────────────────────────────────────────
function CoinSide({ isHeads, size, isBack }: { isHeads: boolean, size: number, isBack: boolean }) {
  // HEADS: Centro dorado con reborde negro
  // TAILS: Centro negro con reborde dorado
  const outerGradient = isHeads
    ? 'linear-gradient(145deg, #3a3a3a 0%, #111111 50%, #2a2a2a 100%)'
    : 'linear-gradient(145deg, #debc6e 0%, #8c6825 50%, #debc6e 100%)';

  const innerGradient = isHeads
    ? 'linear-gradient(145deg, #a87d32 0%, #debc6e 60%, #8c6825 100%)'
    : 'linear-gradient(145deg, #2a2a2a 0%, #111111 60%, #000000 100%)';

  // Flatter, coin-like shadows instead of a ball
  const outerBoxShadow = '0 8px 16px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.3), inset 0 -3px 6px rgba(0,0,0,0.5)';
  const innerBoxShadow = 'inset 0 3px 10px rgba(0,0,0,0.6), 0 1px 2px rgba(255,255,255,0.3)';

  const iconColor = isHeads ? '#111111' : '#debc6e';
  const textColor = isHeads ? '#111111' : '#debc6e';
  
  // Engraved effect for Heads (black on gold), Raised effect for Tails (gold on black)
  const embossFilter = isHeads 
    ? 'drop-shadow(-2px -2px 2px rgba(0,0,0,0.7)) drop-shadow(2px 2px 2px rgba(255,255,255,0.4))' 
    : 'drop-shadow(-2px -2px 2px rgba(255,230,150,0.3)) drop-shadow(3px 3px 4px rgba(0,0,0,0.9))';

  const textEmboss = isHeads
    ? '-2px -2px 2px rgba(0,0,0,0.7), 2px 2px 2px rgba(255,255,255,0.4)'
    : '-2px -2px 2px rgba(255,230,150,0.3), 3px 3px 4px rgba(0,0,0,0.9)';

  return (
    <div
      className="absolute inset-0 rounded-full flex items-center justify-center select-none"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: isBack ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}
    >
      {/* Outer ring */}
      <div className="absolute inset-0 rounded-full" style={{ background: outerGradient, boxShadow: outerBoxShadow }} />
      {/* Inner face */}
      <div className="absolute rounded-full" style={{ inset: '10px', background: innerGradient, boxShadow: innerBoxShadow }} />
      {/* Icon */}
      <div className="relative z-10 flex flex-col items-center gap-1 mt-1">
        <svg width={size * 0.45} height={size * 0.35} viewBox="0 0 381 307" fill={iconColor} style={{ filter: embossFilter }}>
          <path d={CROWN_PATH} />
        </svg>
        <span
          className="font-black tracking-widest uppercase mt-1"
          style={{ 
            fontSize: size * 0.085, 
            color: textColor, 
            letterSpacing: '0.15em',
            textShadow: textEmboss
          }}
        >
          {isHeads ? 'HEADS' : 'TAILS'}
        </span>
      </div>
    </div>
  );
}

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
        perspective: '1000px',
      }}
      className="relative select-none"
    >
      <div
        className="w-full h-full relative transition-transform duration-700 ease-in-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateY(${side === 1 ? 180 : 0}deg)`,
          animation: spinning ? 'coinSpinFast 0.55s linear infinite' : 'none',
        }}
      >
        <CoinSide isHeads={true} size={size} isBack={false} />
        <CoinSide isHeads={false} size={size} isBack={true} />
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function FlipPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.flip);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.flip);
  const { playClick, playChip, playSfx } = useGameAudio('flip');

  const [side, setSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const resultHandledRef = useRef(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase = result.state?.phase ?? 'idle';
  const resultPayout = result.state?.phase === 'result' ? result.state.payout : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const isSpinning = loading;
  const isResult = resultPhase === 'result';
  const isError = resultPhase === 'error';
  const isWin = isResult && resultPayout !== undefined && resultPayout > BigInt(0);
  // The coin's spin animation is purely visual — it must stop the instant a
  // result is known, not when `loading` clears. `loading` only flips false
  // once bet.play()'s promise resolves, which can lag several seconds behind
  // the WSS-driven result (waitForSettleTx still polls for confirmations),
  // leaving the coin spinning after the WIN/LOSS text already shows.
  const showSpinAnim = isSpinning && !isResult && !isError;

  // Show the side that actually landed: player's pick if win, opposite if loss
  const displaySide: 0 | 1 = isResult
    ? (isWin ? side : (side === 0 ? 1 : 0))
    : side;

  // Status message while spinning
  const spinLabel =
    resultPhase === 'placing' ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…' :
    resultPhase === 'settling' ? 'Resolving…' : '';

  // Play the coin landing sound (plus a coin-rain layer on a win) the moment
  // the result actually settles — independent of `loading`, for the same
  // reason `showSpinAnim` is: the result can arrive well before bet.play()'s
  // promise resolves.
  useEffect(() => {
    if (result.state?.phase !== 'result') {
      resultHandledRef.current = false;
      return;
    }
    if (resultHandledRef.current) return;
    resultHandledRef.current = true;
    playSfx('end');
    if (result.state.payout > BigInt(0)) playSfx('chip1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.state]);

  const handlePlay = async () => {
    if (!address) return;
    playClick();

    // Clear previous result before starting a new game
    if (result.state !== null) result.close();

    setLoading(true);
    playSfx('flip');
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.flip); return; }

      const gameChoice = encodeFlipChoice(side, 1);
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
        <CoinFace side={0} size={140} />
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
        >Coin Flip</h1>
        <p className="text-zinc-400 text-center max-w-xs">Pick a side. Double your bet. 50/50 odds.</p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* Global gradient defs for lucide icon strokes */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={isSpinning} />

        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes 
            gameAddress={addresses.games.flip}
            renderOutcome={(o, i) => {
              // Flip: 0 = Heads, 1 = Tails
              const isHeads = o === 0;
              return (
                <div 
                  className={`w-6 h-6 rounded-full flex items-center justify-center border font-bold text-[10px] mx-0.5
                    ${isHeads 
                      ? 'bg-amber-400/20 text-amber-200 border-amber-400/50' 
                      : 'bg-zinc-800 text-zinc-300 border-zinc-600'}`}
                >
                  {isHeads ? 'H' : 'T'}
                </div>
              );
            }}
          />
        </div>

        <GameInfoButton onClick={() => setShowInfoModal(true)} />
        <FastTxToggle disabled={isSpinning} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.flip} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Coin area (flex-1) ── */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden gap-5 mx-4 my-3 rounded-2xl border border-amber-400/25 bg-[#0a0a0a]">
        {/* Radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-72 rounded-full bg-amber-500/6 blur-3xl" />
        </div>

        {/* Falling coin comets */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[
            { size: 18, left: '12%', delay: '0s', dur: '6s', angle: 15, spinDur: '2.2s' },
            { size: 14, left: '28%', delay: '1.8s', dur: '7s', angle: -10, spinDur: '1.8s' },
            { size: 22, left: '72%', delay: '0.5s', dur: '5.5s', angle: 20, spinDur: '2.5s' },
            { size: 12, left: '85%', delay: '3s', dur: '8s', angle: -18, spinDur: '1.5s' },
            { size: 16, left: '50%', delay: '2.5s', dur: '6.5s', angle: 12, spinDur: '2s' },
            { size: 10, left: '38%', delay: '4s', dur: '7.5s', angle: -8, spinDur: '1.2s' },
            { size: 20, left: '92%', delay: '1s', dur: '5s', angle: 25, spinDur: '3s' },
            { size: 13, left: '5%', delay: '3.5s', dur: '6.8s', angle: -22, spinDur: '1.7s' },
          ].map((c, i) => (
            <div
              key={i}
              className="absolute opacity-[0.12]"
              style={{
                left: c.left,
                top: '-30px',
                width: c.size,
                height: c.size,
                animation: `coinFall ${c.dur} linear ${c.delay} infinite`,
                transform: `rotate(${c.angle}deg)`,
              }}
            >
              <div
                className="w-full h-full rounded-full"
                style={{
                  background: 'linear-gradient(145deg, #debc6e 0%, #8c6825 50%, #debc6e 100%)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                  animation: `coinSpinFast ${c.spinDur} linear infinite`,
                }}
              />
            </div>
          ))}
        </div>

        {/* Coin — always visible */}
        <div className="relative z-10">
          <CoinFace side={displaySide} size={220} spinning={showSpinAnim} />
        </div>

        {/* Status text below coin while spinning */}
        {isSpinning && spinLabel && (
          <p className="relative z-10 text-amber-300/50 text-xs font-medium animate-pulse tracking-widest uppercase">
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
                +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
              </p>
            )}
            {!isWin && resultTotalBet !== undefined && (
              <p className="text-base text-zinc-400">
                −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
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
      <div className="flex-shrink-0 p-2 sm:p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-amber-400/10 sm:divide-y-0 sm:divide-x sm:divide-amber-400/10">

            {/* Column 1: BET AMOUNT */}
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
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad)" strokeWidth={2} />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  disabled={isSpinning}
                  onChange={(e) => {
                    if (result.state !== null) result.close();
                    setAmount(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button
                    disabled={isSpinning}
                    onClick={() => {
                      playChip();
                      if (result.state !== null) result.close();
                      setAmount((v) => (parseFloat(v) + 1).toFixed(2));
                    }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button
                    disabled={isSpinning}
                    onClick={() => {
                      playChip();
                      if (result.state !== null) result.close();
                      setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2));
                    }}
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
                      disabled={isSpinning}
                      onClick={() => {
                        playChip();
                        if (result.state !== null) result.close();
                        setAmount(val);
                      }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* Column 2: CHOOSE SIDE */}
            <div className="p-4 flex flex-col gap-3 h-full">
              <p
                className="text-sm font-black uppercase tracking-widest text-center"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >Choose Side</p>
              <div className="flex items-center gap-3 w-full flex-1">
                <button
                  disabled={isSpinning}
                  onClick={() => {
                    playClick();
                    if (result.state !== null) result.close();
                    setSide(0);
                  }}
                  className={`flex-1 h-full py-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 0
                      ? 'border-[#debc6e] bg-[linear-gradient(145deg,#a87d32_0%,#debc6e_60%,#8c6825_100%)] shadow-[0_0_20px_rgba(222,188,110,0.25)]'
                      : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                  }`}
                >
                  <svg 
                    width="36" height="29" viewBox="0 0 381 307" 
                    fill={side === 0 ? '#111111' : '#52525b'}
                    style={{ filter: side === 0 ? 'drop-shadow(-1px -1px 1px rgba(0,0,0,0.6)) drop-shadow(1px 1px 1px rgba(255,255,255,0.4))' : 'none' }}
                  >
                    <path d={CROWN_PATH} />
                  </svg>
                  <span 
                    className={`text-sm font-black tracking-wider ${side === 0 ? 'text-[#111111]' : 'text-zinc-500'}`}
                    style={{ textShadow: side === 0 ? '-1px -1px 1px rgba(0,0,0,0.6), 1px 1px 1px rgba(255,255,255,0.4)' : 'none' }}
                  >HEADS</span>
                </button>

                <span className="text-zinc-600 text-sm font-bold">vs</span>

                <button
                  disabled={isSpinning}
                  onClick={() => {
                    playClick();
                    if (result.state !== null) result.close();
                    setSide(1);
                  }}
                  className={`flex-1 h-full py-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 1
                      ? 'border-[#debc6e] bg-[#111111] shadow-[0_0_20px_rgba(222,188,110,0.15)]'
                      : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'
                  }`}
                >
                  <svg 
                    width="36" height="29" viewBox="0 0 381 307" 
                    fill={side === 1 ? '#debc6e' : '#52525b'}
                    style={{ filter: side === 1 ? 'drop-shadow(-1px -1px 1px rgba(255,230,150,0.3)) drop-shadow(1px 1px 2px rgba(0,0,0,0.9))' : 'none' }}
                  >
                    <path d={CROWN_PATH} />
                  </svg>
                  <span 
                    className={`text-sm font-black tracking-wider ${side === 1 ? 'text-[#debc6e]' : 'text-zinc-500'}`}
                    style={{ textShadow: side === 1 ? '-1px -1px 1px rgba(255,230,150,0.3), 1px 1px 2px rgba(0,0,0,0.9)' : 'none' }}
                  >TAILS</span>
                </button>
              </div>
            </div>

            {/* Column 3: FLIP button */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading}
                className="relative w-full h-full min-h-[56px] sm:min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-row sm:flex-col items-center justify-center gap-2.5 sm:gap-3 px-4 bg-[#0d0d0d]"
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
                <svg className="w-8 h-8 sm:w-12 sm:h-12" viewBox="0 0 24 24" fill="none" stroke="url(#flip-btn-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <defs><linearGradient id="flip-btn-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#debc6e"/><stop offset="100%" stopColor="#8c6825"/></linearGradient></defs>
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                  <path d="M8 16H3v5"/>
                </svg>
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
                  FLIP
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<Coins className="w-4 h-4" />}
        title="Coin Flip"
        description="Coin Flip is the simplest game on the platform: a single golden coin, two faces, one call. You pick Heads or Tails before the flip, the coin spins through a quick 3D animation, and then it lands on exactly one side. There's no partial outcome and no multiplier to choose — it's a straight 50/50 wager where guessing correctly doubles your stake and guessing wrong loses it outright."
        steps={[
          'Choose your bet amount using the chip buttons or by typing a custom amount.',
          'Pick a side — Heads or Tails — using the two large side-select buttons.',
          'Press Flip to submit the bet; the coin spins while the outcome is resolved on-chain.',
          'The coin settles on the side that actually landed: if it matches your call, you win.',
          'A correct call pays out 2.00x your stake; an incorrect call forfeits the full bet, and your balance updates immediately after.',
        ]}
        sections={[
          {
            title: 'Mechanics: the flip itself',
            content: (
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                Each flip is an independent 50/50 draw between Heads and Tails — the coin has no memory of previous flips, so streaks in either direction don't change the odds of the next one. The side you choose is locked in the moment you submit the bet, before the outcome is generated, so there is no way to react to a result already in motion.
              </p>
            ),
          },
          {
            title: 'Payout calculation',
            content: (
              <div className="space-y-2 text-[11px] text-zinc-300">
                <p>
                  Payout math couldn't be simpler: a correct guess returns exactly double your stake, and a wrong guess returns nothing. A 10.00 {bet.meta.symbol} bet on the winning side pays 20.00 {bet.meta.symbol} — your original stake plus an equal amount in winnings. There are no partial wins, ties, or side bets to track.
                </p>
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <div className="text-center rounded border border-amber-400/20 bg-amber-400/10 text-amber-300 py-1 font-bold">
                    Correct → 2.00x
                  </div>
                  <div className="text-center rounded border border-zinc-700 bg-zinc-900 text-zinc-400 py-1 font-bold">
                    Wrong → 0x
                  </div>
                </div>
              </div>
            ),
          },
        ]}
        tip="Coin Flip is the lowest-variance game on the platform — every round is a flat coin toss with no skill or strategy involved, which makes it a steady, predictable way to size bets if you prefer short, simple rounds over chasing big multipliers."
        rtp="~95.00%"
      />

    </div>
  );
}
