'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeHiLoChoice } from '@/lib/web3/utils/encoders';
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
const CARD_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Payout tables (x100 basis, mirrored from contract)
const HI_PAYOUTS = [0, 104, 113, 124, 138, 156, 178, 208, 249, 312, 416, 624, 1248, 1248];
const LO_PAYOUTS = [0, 1248, 1248, 624, 416, 312, 249, 208, 178, 156, 138, 124, 113, 104];

function getMultiplierDisplay(card: number, direction: 0 | 1): string {
  const payout = direction === 1 ? HI_PAYOUTS[card] : LO_PAYOUTS[card];
  if (!payout) return '—';
  return `${(payout / 100).toFixed(2)}x`;
}

function getWinChance(card: number, direction: 0 | 1): string {
  if (direction === 1) {
    const wins = card === 13 ? 1 : 13 - card;
    return `${((wins / 13) * 100).toFixed(0)}%`;
  } else {
    const wins = card === 1 ? 1 : card - 1;
    return `${((wins / 13) * 100).toFixed(0)}%`;
  }
}

function getCardSuit(card: number): string {
  return ['♠', '♥', '♦', '♣'][(card - 1) % 4];
}

function isRedCard(card: number): boolean {
  const suit = getCardSuit(card);
  return suit === '♥' || suit === '♦';
}

// ── Playing Card ─────────────────────────────────────────────────────────────

function PlayingCard({
  value,
  revealed = true,
  size = 'md',
  glow,
  selected = false,
}: {
  value: number;
  revealed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  glow?: string;
  selected?: boolean;
}) {
  const dims = {
    sm: 'w-10 h-14 rounded-lg',
    md: 'w-24 h-32 rounded-xl',
    lg: 'w-36 h-48 rounded-2xl',
  }[size];

  const text = {
    sm: { rank: 'text-[10px]', suit: 'text-[7px]', center: 'text-lg' },
    md: { rank: 'text-base', suit: 'text-[10px]', center: 'text-3xl' },
    lg: { rank: 'text-xl', suit: 'text-sm', center: 'text-5xl' },
  }[size];

  const pad = size === 'sm' ? 'p-1' : size === 'md' ? 'p-2' : 'p-3';

  if (!revealed) {
    const iconSize = size === 'sm' ? 'w-5 h-5' : size === 'md' ? 'w-10 h-10' : 'w-14 h-14';
    return (
      <div
        className={`${dims} flex items-center justify-center flex-shrink-0 relative overflow-hidden`}
        style={{
          background: 'linear-gradient(160deg, #1a1611 0%, #0d0b08 40%, #151210 100%)',
          border: '2px solid rgba(222,188,110,0.45)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.7), inset 0 0 30px rgba(222,188,110,0.03)',
        }}
      >
        {/* Inner border frame */}
        <div
          className="absolute pointer-events-none"
          style={{
            inset: size === 'sm' ? '3px' : size === 'md' ? '5px' : '7px',
            border: '1.5px solid rgba(222,188,110,0.25)',
            borderRadius: size === 'sm' ? '6px' : size === 'md' ? '8px' : '12px',
          }}
        />
        {/* Wildcard icon */}
        <img
          src="/svg/wildcard.svg"
          alt=""
          className={`${iconSize} select-none pointer-events-none`}
          style={{
            filter: 'invert(76%) sepia(30%) saturate(600%) hue-rotate(10deg) brightness(90%) contrast(90%)',
            opacity: 0.7,
          }}
        />
        {/* Subtle shimmer overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 35% 25%, rgba(222,188,110,0.06) 0%, transparent 60%)',
          }}
        />
      </div>
    );
  }

  const label = CARD_LABELS[value] || String(value);
  const suit = getCardSuit(value);
  const red = isRedCard(value);
  const textColor = red ? 'text-red-600' : 'text-zinc-900';
  const borderStyle = selected
    ? { border: '2px solid #debc6e', boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(222,188,110,0.4)` }
    : glow
    ? { border: '2px solid rgba(255,255,255,0.3)', boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 32px ${glow}` }
    : { border: '2px solid rgba(255,255,255,0.2)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' };

  return (
    <div
      className={`${dims} ${pad} bg-[#fdf8ec] flex flex-col justify-between flex-shrink-0`}
      style={borderStyle}
    >
      <div className={`${textColor} font-black leading-none`}>
        <div className={text.rank}>{label}</div>
        <div className={text.suit}>{suit}</div>
      </div>
      <div className={`${textColor} ${text.center} text-center leading-none`}>{suit}</div>
      <div className={`${textColor} font-black leading-none self-end rotate-180`}>
        <div className={text.rank}>{label}</div>
        <div className={text.suit}>{suit}</div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HiLoPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.hiLoGame);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.hiLoGame);
  const { playClick, playChip, playRandom, playSfx } = useGameAudio('hilo');

  const [card, setCard] = useState<number>(() => Math.floor(Math.random() * 13) + 1);
  const [direction, setDirection] = useState<0 | 1>(1); // 0=LO, 1=HI
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [skipFlipping, setSkipFlipping] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const resultHandledRef = useRef(false);
  // WIN/LOSS/TIE text waits for this instead of `isResult` directly, so it
  // appears together with the result sound, in sync with the card's 0.8s
  // flip reveal instead of popping in the instant the result arrives.
  const [showResultText, setShowResultText] = useState(false);

  const [skipAngle, setSkipAngle] = useState(0);
  const [cardSize, setCardSize] = useState<'sm' | 'md' | 'lg'>('lg');

  useEffect(() => {
    const update = () => setCardSize(window.innerWidth < 640 ? 'md' : 'lg');
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleSkipCard = () => {
    if (loading || skipFlipping) return;
    playClick();
    setSkipFlipping(true);
    const nextAngle = skipAngle + 360;
    setSkipAngle(nextAngle);
    setTimeout(() => {
      setCard(Math.floor(Math.random() * 13) + 1);
      if (result.state !== null) result.close();
    }, 350);
    setTimeout(() => setSkipFlipping(false), 700);
  };

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

  const drawnCard =
    result.state?.phase === 'result' ? Number(result.state.outcomes?.[0] ?? 0) : 0;

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…'  :
    resultPhase === 'settling'       ? 'Drawing card…' : '';

  const resultColor = isWin ? '#4ade80' : isTie ? '#d4a017' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : isTie ? 'rgba(212,160,23,0.45)' : 'rgba(248,113,113,0.5)';
  const resultLabel = isWin ? 'WIN' : isTie ? 'TIE' : 'LOSS';

  const currentMultiplier = getMultiplierDisplay(card, direction);
  const currentWinChance  = getWinChance(card, direction);

  // Card-loss / default-result are tied to when the bet actually settles, not
  // to `loading` — the WSS-driven result can land before bet.play()'s promise
  // resolves (same lag flip.page works around with `showSpinAnim`).
  useEffect(() => {
    if (result.state?.phase !== 'result') {
      resultHandledRef.current = false;
      setShowResultText(false);
      return;
    }
    if (resultHandledRef.current) return;
    resultHandledRef.current = true;
    const { payout } = result.state;
    const lost = payout === undefined || payout === BigInt(0);
    // Delayed to land with the drawn card's 0.8s flip reveal instead of
    // firing the instant the result arrives, ahead of the card animation.
    const id = setTimeout(() => {
      playSfx(lost ? 'loss' : 'defaultResult');
      setShowResultText(true);
    }, 500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.state]);

  const handlePlay = async () => {
    if (!address) return;
    playClick();
    if (result.state !== null) result.close();
    setLoading(true);
    playRandom(['card1', 'card2']);
    try {
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.hiLoGame); return; }
      const gameChoice = encodeHiLoChoice(card, direction, 1);
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Wallet not connected ────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex gap-4 opacity-30">
          <PlayingCard value={1} size="md" />
          <PlayingCard value={7} size="md" />
          <PlayingCard value={13} size="md" />
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
        >
          Hi-Lo
        </h1>
        <p className="text-zinc-400 text-center max-w-xs">
          Pick a reference card. Bet whether the drawn card will be Higher or Lower.
        </p>
        <WalletButton />
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-hilo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2 sm:py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={loading} />

        <div className="flex-1 sm:hidden" aria-hidden />
        <div className="hidden sm:block flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes
            gameAddress={addresses.games.hiLoGame}
            renderOutcome={(o) => {
              const label = CARD_LABELS[o] ?? String(o);
              const red = isRedCard(o);
              return (
                <div
                  className={`w-6 h-6 rounded flex items-center justify-center border font-bold text-[10px] mx-0.5 ${
                    red
                      ? 'bg-red-400/10 text-red-400 border-red-500/30'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-600'
                  }`}
                >
                  {label}
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
        <div className="px-3 sm:px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.hiLoGame} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: game display ── */}
      <div className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex items-center justify-center border border-amber-400/25 bg-[#0a0a0a]">

        {/* Floating card suit icons */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {[
            { suit: '♠', x: '8%',  y: '15%', size: 42, delay: 0,   dur: 18 },
            { suit: '♥', x: '85%', y: '20%', size: 36, delay: 3,   dur: 22 },
            { suit: '♦', x: '15%', y: '72%', size: 30, delay: 6,   dur: 20 },
            { suit: '♣', x: '88%', y: '75%', size: 38, delay: 1.5, dur: 24 },
            { suit: '♠', x: '50%', y: '8%',  size: 24, delay: 4,   dur: 16 },
            { suit: '♥', x: '25%', y: '45%', size: 20, delay: 8,   dur: 19 },
            { suit: '♦', x: '72%', y: '50%', size: 22, delay: 5,   dur: 21 },
            { suit: '♣', x: '45%', y: '85%', size: 26, delay: 10,  dur: 17 },
            { suit: '♠', x: '92%', y: '45%', size: 18, delay: 7,   dur: 23 },
            { suit: '♥', x: '5%',  y: '40%', size: 28, delay: 2,   dur: 25 },
          ].map((item, i) => (
            <span
              key={i}
              className="absolute select-none"
              style={{
                left: item.x,
                top: item.y,
                fontSize: `${item.size}px`,
                color: (item.suit === '♥' || item.suit === '♦') ? 'rgba(248,113,113,0.04)' : 'rgba(255,255,255,0.03)',
                animation: `suitFloat ${item.dur}s ease-in-out ${item.delay}s infinite`,
              }}
            >
              {item.suit}
            </span>
          ))}
        </div>

        {/* Ambient glow */}
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

        <div className="relative z-10 flex flex-row items-center gap-3 sm:gap-16 px-3 sm:px-6">

          {/* Reference card (player's chosen card) */}
          <div className="flex flex-col items-center gap-3">
            <div style={{ perspective: '800px' }}>
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.7s ease-in-out',
                  transform: `rotateY(${skipAngle}deg)`,
                  position: 'relative',
                  width: cardSize === 'lg' ? '144px' : '96px',
                  height: cardSize === 'lg' ? '192px' : '128px',
                }}
              >
                {/* Front face (revealed card) */}
                <div style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', position: 'absolute', inset: 0 }}>
                  <PlayingCard value={card} size={cardSize} selected />
                </div>
                {/* Back face (card back) */}
                <div style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)', position: 'absolute', inset: 0 }}>
                  <PlayingCard value={0} revealed={false} size={cardSize} />
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className="text-base font-black tracking-widest uppercase"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                YOUR CARD
              </span>
              <button
                onClick={handleSkipCard}
                disabled={loading || skipFlipping}
                className="px-3 py-1 rounded-md border border-zinc-700/60 bg-zinc-800/30 text-xs font-bold text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Skip Card
              </button>
            </div>
          </div>

          {/* Middle: direction + status */}
          <div className="flex flex-col items-center gap-3 min-w-[72px] sm:min-w-[120px]">
            <div className="flex flex-col items-center gap-1">
              {direction === 1 ? (
                <TrendingUp className="w-8 h-8 text-green-400" />
              ) : (
                <TrendingDown className="w-8 h-8 text-green-400" />
              )}
              <span className="text-xl font-black tracking-widest text-green-400">
                {direction === 1 ? 'HI' : 'LO'}
              </span>
            </div>

            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-zinc-600 text-xs uppercase tracking-widest">Multiplier</span>
              <span
                className="text-2xl font-black"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {currentMultiplier}
              </span>
              <span className="text-zinc-500 text-xs">{currentWinChance} win chance</span>
            </div>

            {loading && spinLabel && (
              <p className="text-amber-300/40 text-[10px] font-medium animate-pulse tracking-widest uppercase">
                {spinLabel}
              </p>
            )}

            {showResultText && (
              <div
                className="flex flex-col items-center gap-1"
                style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
              >
                <div
                  className="text-4xl font-black tracking-tight"
                  style={{ color: resultColor, textShadow: `0 0 32px ${resultGlow}` }}
                >
                  {resultLabel}
                </div>
                {isWin && resultPayout !== undefined && (
                  <p className="text-base font-bold text-green-300">
                    +{fmtAmt(resultPayout)}{' '}
                    <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
                  </p>
                )}
                {isTie && (
                  <p className="text-xs text-amber-300/60 font-medium">Bet returned</p>
                )}
                {isLoss && resultTotalBet !== undefined && (
                  <p className="text-xs text-zinc-400">
                    −{fmtAmt(resultTotalBet)} {bet.meta.symbol}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Drawn card (hidden → flip reveal on result) */}
          <div className="flex flex-col items-center gap-3">
            <div style={{ perspective: '800px' }}>
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.8s ease-in-out',
                  transform: isResult ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  position: 'relative',
                  width: cardSize === 'lg' ? '144px' : '96px',
                  height: cardSize === 'lg' ? '192px' : '128px',
                }}
              >
                {/* Back face */}
                <div
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    position: 'absolute',
                    inset: 0,
                  }}
                >
                  <PlayingCard value={0} revealed={false} size={cardSize} />
                  {loading && (
                    <div
                      className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden"
                    >
                      <div
                        className="absolute inset-0"
                        style={{
                          animation: 'cardGlint 2.5s ease-in-out infinite',
                          background:
                            'linear-gradient(105deg, transparent 40%, rgba(222,188,110,0.08) 45%, rgba(222,188,110,0.2) 50%, rgba(222,188,110,0.08) 55%, transparent 60%)',
                          backgroundSize: '200% 100%',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Front face (revealed card) */}
                <div
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    position: 'absolute',
                    inset: 0,
                  }}
                >
                  {isResult && drawnCard > 0 && (
                    <PlayingCard
                      value={drawnCard}
                      size={cardSize}
                      glow={resultGlow}
                    />
                  )}
                </div>
              </div>
            </div>
            <span
              className="text-base font-black tracking-widest uppercase"
              style={{
                background: 'linear-gradient(20deg, #b89d5a, #6b4f1c)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              DRAWN CARD
            </span>
          </div>
        </div>

        {/* ── Error overlay ── */}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-amber-400/10">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3 border-r border-amber-400/10 sm:border-r-0">
              <p className="text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Bet Amount
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#1a1a1a] px-3 py-2 focus-within:border-amber-400/60 transition-colors">
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-hilo)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount}
                  disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={loading}
                    onClick={() => { playChip(); setAmount((v) => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={loading}
                    onClick={() => { playChip(); setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
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
                      disabled={loading}
                      onClick={() => { playChip(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}>
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* DIRECTION (HIGH / LOW) */}
            <div className="p-4 space-y-3">
              <p className="text-sm font-black uppercase tracking-widest"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                Direction
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([1, 0] as (0 | 1)[]).map((d) => {
                  const active = direction === d;
                  const isHi = d === 1;
                  return (
                    <button
                      key={d}
                      disabled={loading}
                      onClick={() => { playClick(); setDirection(d); }}
                      className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? 'border-green-500/60 bg-green-400/10'
                          : 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600'
                      }`}
                    >
                      {isHi ? (
                        <TrendingUp className={`w-6 h-6 ${active ? 'text-green-400' : 'text-zinc-500'}`} />
                      ) : (
                        <TrendingDown className={`w-6 h-6 ${active ? 'text-green-400' : 'text-zinc-500'}`} />
                      )}
                      <span className={`text-sm font-black ${active ? 'text-green-300' : 'text-zinc-500'}`}>
                        {isHi ? 'HIGH' : 'LOW'}
                      </span>
                      <span className={`text-[10px] font-medium ${active ? 'text-green-400/70' : 'text-zinc-600'}`}>
                        {getMultiplierDisplay(card, d)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-3 text-center">
                <span className="text-zinc-600 text-[10px] uppercase tracking-widest">Win chance</span>
                <span className="text-zinc-400 text-xs font-bold">{currentWinChance}</span>
              </div>
            </div>

            {/* PLAY BUTTON */}
            <div className="col-span-2 sm:col-span-1 p-4 flex items-center justify-center border-t border-amber-400/10 sm:border-t-0">
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
                  PLAY
                </span>
                <span className="text-[10px] text-zinc-500 font-medium">
                  {currentWinChance} · {currentMultiplier}
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

      <GameInfoModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        icon={<TrendingUp className="w-4 h-4" />}
        title="Hi-Lo"
        description="Hi-Lo deals you a single reference card, Ace (1) through King (13), and asks you to call whether the next card drawn from the deck will land Higher or Lower than it. Every one of the 13 reference cards and both directions has its own fixed multiplier and win chance, so the board effectively contains 26 separate bets — extreme reference cards make one side a near-lock at a tiny multiplier and the other side a longshot at a huge one, while a reference card near the middle (6, 7, 8) keeps both sides close to a coin flip. You can redraw the reference card for free as many times as you like before committing your bet, so you're always choosing which risk/reward combination suits you, never stuck with a bad card."
        steps={[
          'A reference card between Ace (1) and King (13) is drawn and displayed face-up.',
          'Use Skip Card as many times as you want before betting to redraw a new, random reference card free of charge.',
          'Choose your direction: HIGH if you think the next card drawn will beat the reference card, or LOW if you think it will fall short of it.',
          'Enter your bet amount and press Play — a new card is drawn from the deck and compared against the reference card.',
          'If the drawn card satisfies your chosen direction you win the displayed multiplier; if it ties the reference card your stake is simply returned with no profit or loss.',
        ]}
        sections={[
          {
            title: 'Mechanics & Tie-Breaking',
            content: (
              <div className="text-xs text-zinc-300 space-y-2">
                <p>
                  Win chance is just a count of favorable cards out of 13: betting HI on reference card <span className="text-zinc-200 font-bold">7</span> wins on draws of 8–13 (6 of 13 ≈ 46%), while betting LO on the same card wins on draws of 1–6 (also 6 of 13). The two edge cases on the table have a built-in quirk worth knowing: on reference card <span className="text-zinc-200 font-bold">King (13)</span>, betting HI still wins if the drawn card is also a King (draw ≥ 13), and on reference card <span className="text-zinc-200 font-bold">Ace (1)</span>, betting LO still wins if the drawn card is also an Ace (draw ≤ 1). Every other matching draw (a genuine tie on any other reference card) always loses the bet and simply returns your stake.
                </p>
                <p>
                  Multipliers move inversely with win chance. Betting HI on an Ace pays only about <span className="text-amber-300 font-bold">1.04x</span> because almost every card beats an Ace, whereas betting LO on an Ace pays the table maximum of <span className="text-amber-300 font-bold">12.48x</span> because almost nothing beats it downward. The card 7 sits closest to even money, paying roughly <span className="text-amber-300 font-bold">2.08x</span> on either HI or LO since both directions win with 6 of 13 cards.
                </p>
              </div>
            ),
          },
          {
            title: 'Full Payout Table',
            content: (
              <div className="text-xs text-zinc-300 space-y-1.5">
                <p className="text-zinc-400">Multiplier by reference card and direction (HI = drawn card higher, LO = drawn card lower):</p>
                <div className="grid grid-cols-1 gap-1 font-mono">
                  {CARD_LABELS.slice(1).map((label, idx) => {
                    const card = idx + 1;
                    return (
                      <div key={card} className="flex items-center gap-2 rounded bg-zinc-800/60 px-2 py-0.5">
                        <span className="w-6 text-zinc-200 font-bold">{label}</span>
                        <span className="text-zinc-500">HI</span>
                        <span className="text-amber-300 font-bold w-16">{getMultiplierDisplay(card, 1)}</span>
                        <span className="text-zinc-500">LO</span>
                        <span className="text-amber-300 font-bold w-16">{getMultiplierDisplay(card, 0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ),
          },
        ]}
        tip="The house edge is spread evenly across the whole table — every single card and direction combination returns roughly the same ~96% RTP, so no reference card or direction is mathematically better than another; pick based on the risk profile (steady small wins vs. rare big multipliers) you prefer, not on hunting for an edge."
        rtp="~96.00%"
      />
    </div>
  );
}
