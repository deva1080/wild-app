'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CircleDollarSign, Scissors, File } from 'lucide-react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useBetController } from '@/lib/web3/hooks/useBetController';
import { encodeRPSChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { PaymentSelector } from '@/components/PaymentSelector';
import { FastTxToggle } from '@/components/FastTxToggle';
import { RecentOutcomes } from '@/components/RecentOutcomes';
import { useGameAudio } from '@/lib/sound/useGameAudio';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const CHOICE_NAMES = ['Rock', 'Paper', 'Scissors'] as const;
type RpsChoice = 0 | 1 | 2;

// ── Icons ──────────────────────────────────────────────────────────────────

function RockSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.035 17.012a3 3 0 0 0-3-3l-.311-.002a.72.72 0 0 1-.505-1.229l1.195-1.195A2 2 0 0 1 10.828 11H12a2 2 0 0 0 0-4H9.243a3 3 0 0 0-2.122.879l-2.707 2.707A4.83 4.83 0 0 0 3 14a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8V7a2 2 0 1 0-4 0v2a2 2 0 1 0 4 0"/>
      <path d="M13.888 9.662A2 2 0 0 0 17 8V5A2 2 0 1 0 13 5"/>
      <path d="M9 5A2 2 0 1 0 5 5V10"/>
      <path d="M9 7V4A2 2 0 1 1 13 4V7.268"/>
    </svg>
  );
}

function PaperSvg({ color, size }: { color: string; size: number }) {
  return <File size={size} color={color} strokeWidth={2} />;
}

function ScissorsSvg({ color, size }: { color: string; size: number }) {
  return <Scissors size={size} color={color} strokeWidth={2} />;
}

function RpsIcon({ choice, size, active = false }: { choice: RpsChoice; size: number; active?: boolean }) {
  const color = active ? '#debc6e' : '#52525b';
  if (choice === 0) return <RockSvg    color={color} size={size} />;
  if (choice === 1) return <PaperSvg   color={color} size={size} />;
  return                   <ScissorsSvg color={color} size={size} />;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function RPSPage() {
  const { address } = useAccount();
  const { pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.rps);
  const result = useGameResultFlow();
  const bet = useBetController(addresses.games.rps);
  const { playClick, playChip, playRandom, playSfx } = useGameAudio('rps');

  const [choice, setChoice] = useState<RpsChoice>(0);
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);
  const resultHandledRef = useRef(false);
  // WIN/LOSS/TIE text waits for this instead of `isResult` directly, so it
  // appears together with the result sound, in sync with the dealer card's
  // 0.8s flip reveal instead of popping in the instant the result arrives.
  const [showResultText, setShowResultText] = useState(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const fmtAmt = (v: bigint) => Number(formatUnits(v, bet.decimals)).toFixed(2);

  const resultPhase  = result.state?.phase ?? 'idle';
  const resultPayout = result.state?.phase === 'result' ? result.state.payout    : undefined;
  const resultTotalBet = result.state?.phase === 'result' ? result.state.totalBet : undefined;

  const isResult = resultPhase === 'result';
  const isError  = resultPhase === 'error';
  const isWin    = isResult && resultPayout !== undefined && resultTotalBet !== undefined && resultPayout > resultTotalBet;
  const isTie    = isResult && resultPayout !== undefined && resultTotalBet !== undefined && resultPayout > BigInt(0) && resultPayout <= resultTotalBet;
  const isLoss   = isResult && (resultPayout === undefined || resultPayout === BigInt(0));

  // Outcome: 0=Rock 1=Paper 2=Scissors 3=tie(same as player)
  const outcomeVal =
    result.state?.phase === 'result'
      ? Number(result.state.outcomes?.[0] ?? 0)
      : -1;
  const houseChoice: RpsChoice = outcomeVal === 3 ? choice : (outcomeVal as RpsChoice);

  const spinLabel =
    resultPhase === 'placing'        ? 'Placing bet…' :
    resultPhase === 'waiting-settle' ? 'Confirming…'  :
    resultPhase === 'settling'       ? 'Resolving…'   : '';

  const resultColor = isWin ? '#4ade80' : isTie ? '#d4a017' : '#f87171';
  const resultGlow  = isWin ? 'rgba(74,222,128,0.5)' : isTie ? 'rgba(212,160,23,0.45)' : 'rgba(248,113,113,0.5)';
  const resultLabel = isWin ? 'WIN' : isTie ? 'TIE' : 'LOSS';

  // Card-loss / default-result are tied to when the bet actually settles, not
  // to `loading` — the WSS-driven result can land before bet.play()'s promise
  // resolves. Delayed 500ms so both the sound and the WIN/LOSS/TIE text line
  // up with the dealer card's 0.8s flip reveal instead of firing/popping in
  // ahead of it.
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
      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.rps); return; }

      const gameChoice = encodeRPSChoice(choice, 1);
      await bet.play(gameChoice, amount, result, setAmount);
      refetchAll();
    } catch (e: unknown) {
      result.error(extractRevertReason(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Wallet not connected ──────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex gap-6 opacity-30">
          <img src="/rps/rock.webp" alt="rock" className="w-16 h-16 object-contain" />
          <img src="/rps/paper.webp" alt="paper" className="w-16 h-16 object-contain" />
          <img src="/rps/scissors.webp" alt="scissors" className="w-16 h-16 object-contain" />
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
        >Rock Paper Scissors</h1>
        <p className="text-zinc-400 text-center max-w-xs">Choose your hand. Win pays 2×. Tie returns your bet.</p>
        <WalletButton />
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Global gradient defs for lucide icon strokes */}
      <svg width="0" height="0" className="absolute overflow-hidden" aria-hidden="true">
        <defs>
          <linearGradient id="gold-icon-grad-rps" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#debc6e" />
            <stop offset="100%" stopColor="#8c6825" />
          </linearGradient>
        </defs>
      </svg>

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-400/20 bg-[#0d0d0d] flex-shrink-0">
        <PaymentSelector disabled={loading} />

        <div className="flex-1 overflow-hidden border-l border-amber-400/20 pl-3">
          <RecentOutcomes 
            gameAddress={addresses.games.rps}
            renderOutcome={(o, i) => {
              // RPS: 0 = Rock, 1 = Paper, 2 = Scissors, 3 = Draw
              let label = '';
              let bg = '';
              if (o === 0) { label = 'R'; bg = 'bg-red-400/10 text-red-400 border-red-500/30'; }
              else if (o === 1) { label = 'P'; bg = 'bg-blue-400/10 text-blue-400 border-blue-500/30'; }
              else if (o === 2) { label = 'S'; bg = 'bg-green-400/10 text-green-400 border-green-500/30'; }
              else { label = 'D'; bg = 'bg-zinc-800 text-zinc-400 border-zinc-600'; }

              return (
                <div 
                  className={`w-6 h-6 rounded-full flex items-center justify-center border font-bold text-[10px] mx-0.5 ${bg}`}
                >
                  {label}
                </div>
              );
            }}
          />
        </div>

        <FastTxToggle disabled={loading} />
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.rps} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: game display ── */}
      <div
        className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex items-center justify-center border border-amber-400/25 bg-[#0a0a0a]"
      >
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

        {/* ── Cards layout ── */}
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-4 md:gap-16 px-6">

          {/* Player card */}
          <div className="flex flex-col items-center gap-3 order-2 md:order-1">
            <img 
              src={`/rps/${choice === 0 ? 'rock' : choice === 1 ? 'paper' : 'scissors'}.webp`} 
              alt={CHOICE_NAMES[choice]} 
              className="h-48 md:h-80 w-auto object-contain" 
              style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.6))' }}
            />
            <span
              className="text-lg font-black tracking-widest uppercase"
              style={{
                background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >YOU</span>
          </div>

          {/* VS */}
          <div className="flex flex-col items-center order-1 md:order-2">
            <span className="text-3xl font-black text-zinc-600">VS</span>
            {loading && spinLabel && (
              <p className="text-amber-300/40 text-[10px] font-medium animate-pulse tracking-widest uppercase mt-2">
                {spinLabel}
              </p>
            )}
            {showResultText && (
              <div className="flex flex-col items-center gap-1 mt-2" style={{ animation: 'resultFadeIn 0.35s ease-out both' }}>
                <div
                  className="text-4xl font-black tracking-tight"
                  style={{ color: resultColor, textShadow: `0 0 32px ${resultGlow}` }}
                >
                  {resultLabel}
                </div>
                {isWin && resultPayout !== undefined && (
                  <p className="text-base font-bold text-green-300">
                    +{fmtAmt(resultPayout)} <span className="text-green-400/60 text-sm">{bet.meta.symbol}</span>
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

          {/* Dealer card */}
          <div className="flex flex-col items-center gap-3 order-3">
            <div className="relative h-48 md:h-80" style={{ perspective: '800px' }}>
              <div
                className="h-full relative"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.8s ease-in-out',
                  transform: isResult ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                {/* Back face (wildcard / idle) */}
                <div
                  className="relative h-full"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                  }}
                >
                  <img 
                    src="/rps/wildcard.webp" 
                    alt="Dealer" 
                    className="h-48 md:h-80 w-auto object-contain" 
                    style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.6))' }}
                  />
                  {loading && (
                    <div 
                      className="absolute inset-0 pointer-events-none rounded-2xl"
                      style={{ animation: 'cardPulseGlow 2s ease-in-out infinite' }}
                    />
                  )}
                  {loading && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                      <div className="absolute inset-0" style={{ animation: 'cardGlint 2.5s ease-in-out infinite', background: 'linear-gradient(105deg, transparent 40%, rgba(222,188,110,0.08) 45%, rgba(222,188,110,0.2) 50%, rgba(222,188,110,0.08) 55%, transparent 60%)', backgroundSize: '200% 100%' }} />
                    </div>
                  )}
                </div>

                {/* Front face (result) */}
                <div
                  className="absolute inset-0 h-full flex items-center justify-center"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  {isResult && (
                    <img 
                      src={`/rps/${houseChoice === 0 ? 'rock' : houseChoice === 1 ? 'paper' : 'scissors'}.webp`} 
                      alt={CHOICE_NAMES[houseChoice]} 
                      className="h-48 md:h-80 w-auto object-contain" 
                      style={{ filter: `drop-shadow(0 4px 16px rgba(0,0,0,0.6)) drop-shadow(0 0 20px ${resultGlow})` }}
                    />
                  )}
                </div>
              </div>
            </div>
            <span
              className="text-lg font-black tracking-widest uppercase"
              style={{
                background: 'linear-gradient(20deg, #b89d5a, #6b4f1c)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >DEALER</span>
          </div>
        </div>

        {/* ── Error ── */}
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
      <div className="flex-shrink-0 p-4">
        <div className="rounded-2xl bg-[#161616] border border-amber-400/25 overflow-hidden">
          <div className="grid grid-cols-3">

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
                <CircleDollarSign className="w-5 h-5 shrink-0" stroke="url(#gold-icon-grad-rps)" strokeWidth={2} />
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={loading}
                    onClick={() => { playChip(); setAmount((v) => (parseFloat(v) + 1).toFixed(2)); }}
                    className="w-5 h-4 rounded bg-zinc-700 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 15l-6-6-6 6"/></svg>
                  </button>
                  <button disabled={loading}
                    onClick={() => { playChip(); setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2)); }}
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
                    <button key={v} disabled={loading} onClick={() => { playChip(); setAmount(val); }}
                      className={`py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!active ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'border-transparent text-[#1a1205]'}`}
                      style={active ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}
                    >{v}</button>
                  );
                })}
              </div>
            </div>

            {/* CHOICE */}
            <div className="p-4 space-y-2 border-x border-amber-400/10">
              <p
                className="text-sm font-black uppercase tracking-widest"
                style={{
                  background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >Choose</p>
              <div className="flex flex-col gap-1.5 h-[calc(100%-30px)]">
                {([0, 1, 2] as RpsChoice[]).map((c) => (
                  <button
                    key={c}
                    disabled={loading}
                    onClick={() => { playClick(); setChoice(c); }}
                    className={`flex-1 flex items-center gap-2.5 px-3 rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      choice === c
                        ? 'border-[#debc6e] bg-[linear-gradient(145deg,#a87d32_0%,#debc6e_60%,#8c6825_100%)] shadow-[0_0_14px_rgba(200,146,10,0.18)]'
                        : 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600'
                    }`}
                  >
                    <RpsIcon choice={c} size={22} active={choice === c} />
                    <span 
                      className={`text-xs font-bold tracking-wider uppercase ${choice === c ? 'text-[#111111]' : 'text-zinc-500'}`}
                      style={{ textShadow: choice === c ? '-1px -1px 1px rgba(0,0,0,0.6), 1px 1px 1px rgba(255,255,255,0.4)' : 'none' }}
                    >
                      {CHOICE_NAMES[c]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* PLAY */}
            <div className="p-4 flex items-center justify-center">
              <button
                onClick={handlePlay}
                disabled={loading}
                className="relative w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-3 bg-[#0d0d0d]"
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
                <div className="relative w-12 h-12 flex items-center justify-center text-[#debc6e]" style={{ filter: 'drop-shadow(0 0 8px rgba(222,188,110,0.5))' }}>
                   <RpsIcon choice={choice} size={48} active={true} />
                </div>
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
                  PLAY
                </span>
              </button>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
