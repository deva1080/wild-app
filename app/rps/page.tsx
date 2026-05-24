'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay, extractRevertReason } from '@/lib/web3/hooks/useGamePlay';
import { useDelegatedPlay } from '@/lib/web3/hooks/useDelegatedPlay';
import { usePreflightCheck } from '@/lib/web3/hooks/usePreflightCheck';
import { encodeRPSChoice } from '@/lib/web3/utils/encoders';
import { addresses } from '@/lib/web3/constants/addresses';
import { WalletButton } from '@/components/WalletButton';
import { PendingBetBanner } from '@/components/PendingBetBanner';
import { useGameResultFlow } from '@/components/GameResultModal';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

const CHIP_VALUES = ['1', '5', '10', '50', '100'];
const CHOICE_NAMES = ['Rock', 'Paper', 'Scissors'] as const;
type RpsChoice = 0 | 1 | 2;

// ── Icons ──────────────────────────────────────────────────────────────────

function RockSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" fill={color} />
      <ellipse cx="10" cy="9" rx="2.5" ry="1.4" fill="rgba(255,255,255,0.17)" />
      <path d="M8.5 14.5 Q10.5 17 14.5 15.5" stroke="rgba(0,0,0,0.22)" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function PaperSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3" width="14" height="18" rx="1.5" fill={color} />
      <line x1="8.5" y1="8"    x2="15.5" y2="8"    stroke="rgba(0,0,0,0.28)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8.5" y1="11.5" x2="15.5" y2="11.5" stroke="rgba(0,0,0,0.28)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8.5" y1="15"   x2="12.5" y2="15"   stroke="rgba(0,0,0,0.28)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ScissorsSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6"  cy="19" r="3"   fill="none" strokeWidth="2" />
      <circle cx="18" cy="19" r="3"   fill="none" strokeWidth="2" />
      <line x1="8.6"  y1="16.6" x2="12" y2="11" strokeWidth="2.5" />
      <line x1="15.4" y1="16.6" x2="12" y2="11" strokeWidth="2.5" />
      <line x1="12"   y1="11"   x2="8"  y2="4"  strokeWidth="2.5" />
      <line x1="12"   y1="11"   x2="16" y2="4"  strokeWidth="2.5" />
    </svg>
  );
}

function RpsIcon({ choice, size, active = false }: { choice: RpsChoice; size: number; active?: boolean }) {
  const color = active ? '#d4a017' : 'rgba(255,255,255,0.45)';
  if (choice === 0) return <RockSvg    color={color} size={size} />;
  if (choice === 1) return <PaperSvg   color={color} size={size} />;
  return                   <ScissorsSvg color={color} size={size} />;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function RPSPage() {
  const { address } = useAccount();
  const { wildBalance, pendingBetId: contractPendingBet, refetchAll } = usePlayerState(addresses.games.rps);
  const { playStandard, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const result = useGameResultFlow();
  const { mode: txMode } = useTxMode();

  const [choice, setChoice] = useState<RpsChoice>(0);
  const [amount, setAmount] = useState('1');
  const [loading, setLoading] = useState(false);

  const pendingBetId =
    typeof contractPendingBet === 'bigint' && contractPendingBet !== BigInt(0)
      ? contractPendingBet
      : null;
  const balStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toFixed(2) : '0.00';

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

  const handlePlay = async () => {
    if (!address) return;
    if (result.state !== null) result.close();
    setLoading(true);
    try {
      const gameChoice = encodeRPSChoice(choice, 1);
      const weiAmount  = parseEther(amount);

      if (pendingBetId) { result.stuck(pendingBetId, addresses.games.rps); return; }

      if (txMode !== 'delegated') {
        const issues = await check(addresses.games.rps, weiAmount);
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length > 0) { result.error(errors.map((e) => e.message).join('\n')); return; }
      }

      if (txMode === 'delegated') {
        result.startPlacing();
        if (!authorizedPlays || authorizedPlays === BigInt(0)) await setupDelegatedPlay(BigInt(100));
        const txHash = await requestDelegatedPlay(addresses.games.rps, address, addresses.wildToken, weiAmount, gameChoice, false);
        await result.waitForDelegatedTx(txHash);
      } else {
        result.startPlacing();
        const playResult = await playStandard(addresses.games.rps, gameChoice, weiAmount);
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

  // ── Wallet not connected ──────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex gap-6">
          {([0, 1, 2] as RpsChoice[]).map((c) => (
            <RpsIcon key={c} choice={c} size={52} active />
          ))}
        </div>
        <h1 className="text-3xl font-black text-amber-100 tracking-tight">Rock Paper Scissors</h1>
        <p className="text-zinc-400 text-center max-w-xs">Choose your hand. Win pays 2×. Tie returns your bet.</p>
        <WalletButton />
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-amber-500/10 bg-[#0d0d0d]/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm font-bold">
          <span className="text-amber-400">♦</span>
          $WILD
          <svg className="w-3 h-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
        <div className="ml-auto flex-shrink-0 flex items-center gap-1 text-[11px] font-medium text-zinc-600">
          <svg xmlns="http://www.w3.org/2000/svg"
            className={`w-3 h-3 ${txMode === 'delegated' ? 'text-amber-400' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          {txMode === 'delegated' ? <span className="text-amber-400">Fast TX</span> : 'Standard TX'}
        </div>
      </div>

      {/* ── Pending bet banner ── */}
      {pendingBetId !== null && (
        <div className="px-5 pt-3">
          <PendingBetBanner gameAddress={addresses.games.rps} betId={pendingBetId} onSettled={refetchAll} />
        </div>
      )}

      {/* ── Center: game display ── */}
      <div
        className="flex-1 relative overflow-hidden min-h-0 mx-4 my-3 rounded-2xl flex flex-col items-center justify-center"
        style={{
          background: 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 32px rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
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

        {/* Decorative faint flanking icons */}
        {!isResult && !isError && (
          <>
            <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-[0.06]">
              <RpsIcon choice={((choice + 1) % 3) as RpsChoice} size={90} active />
            </div>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-[0.06]">
              <RpsIcon choice={((choice + 2) % 3) as RpsChoice} size={70} active />
            </div>
          </>
        )}

        {/* ── Idle / Loading: single large icon centered ── */}
        {!isResult && !isError && (
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div
              style={{
                animation: loading ? 'rpsGlow 1.4s ease-in-out infinite' : undefined,
                filter: loading
                  ? 'drop-shadow(0 0 22px rgba(200,146,10,0.6))'
                  : 'drop-shadow(0 0 10px rgba(200,146,10,0.22))',
                transition: 'filter 0.4s',
              }}
            >
              <RpsIcon choice={choice} size={104} active />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-amber-300/70 text-base font-black tracking-widest uppercase">
                {CHOICE_NAMES[choice]}
              </span>
              {loading && spinLabel && (
                <p className="text-amber-300/40 text-[11px] font-medium animate-pulse tracking-widest uppercase">
                  {spinLabel}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Result: both hands face-off ── */}
        {isResult && (
          <div
            className="relative z-10 flex flex-col items-center gap-5"
            style={{ animation: 'resultFadeIn 0.35s ease-out both' }}
          >
            <div className="flex items-center gap-8">
              {/* Player */}
              <div className="flex flex-col items-center gap-2">
                <div style={{ filter: `drop-shadow(0 0 18px ${resultGlow})` }}>
                  <RpsIcon choice={choice} size={80} active />
                </div>
                <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">You</span>
                <span className="text-[11px] font-bold text-amber-300/70 tracking-wider uppercase">
                  {CHOICE_NAMES[choice]}
                </span>
              </div>

              {/* VS */}
              <div className="flex flex-col items-center">
                <span
                  className="text-3xl font-black"
                  style={{ color: resultColor, textShadow: `0 0 20px ${resultGlow}` }}
                >
                  VS
                </span>
              </div>

              {/* House */}
              <div className="flex flex-col items-center gap-2">
                <div style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.08))' }}>
                  <RpsIcon choice={houseChoice} size={80} />
                </div>
                <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">House</span>
                <span className="text-[11px] font-bold text-zinc-500 tracking-wider uppercase">
                  {CHOICE_NAMES[houseChoice]}
                </span>
              </div>
            </div>

            {/* WIN / TIE / LOSS */}
            <div className="flex flex-col items-center gap-1">
              <div
                className="text-5xl font-black tracking-tight"
                style={{ color: resultColor, textShadow: `0 0 32px ${resultGlow}` }}
              >
                {resultLabel}
              </div>
              {isWin && resultPayout !== undefined && (
                <p className="text-lg font-bold text-green-300">
                  +{Number(formatEther(resultPayout)).toFixed(2)}{' '}
                  <span className="text-green-400/60 text-sm">WILD</span>
                </p>
              )}
              {isTie && (
                <p className="text-sm text-amber-300/60 font-medium">Bet returned</p>
              )}
              {isLoss && resultTotalBet !== undefined && (
                <p className="text-sm text-zinc-400">
                  −{Number(formatEther(resultTotalBet)).toFixed(2)} WILD
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {isError && result.state?.phase === 'error' && (
          <div
            className="relative z-10 flex flex-col items-center gap-2"
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
        <div className="rounded-2xl bg-[#111111] border border-zinc-800/80 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-zinc-800/80">

            {/* BET AMOUNT */}
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet Amount</p>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">♦</span>
                <input
                  type="number" min="0.01" step="0.01"
                  value={amount} disabled={loading}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-xl font-black text-zinc-100 focus:outline-none disabled:opacity-40"
                />
                <div className="flex flex-col gap-0.5">
                  <button disabled={loading}
                    onClick={() => setAmount((v) => (parseFloat(v) + 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                  <button disabled={loading}
                    onClick={() => setAmount((v) => Math.max(0.01, parseFloat(v) - 1).toFixed(2))}
                    className="w-6 h-5 rounded bg-zinc-800 text-zinc-300 text-xs flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {CHIP_VALUES.map((v) => (
                  <button key={v} disabled={loading} onClick={() => setAmount(v)}
                    className={`px-2 py-1 rounded text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      amount === v
                        ? 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                        : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                    }`}>{v}</button>
                ))}
                {wildBalance && (
                  <button disabled={loading}
                    onClick={() => setAmount(Number(formatEther(wildBalance as bigint)).toFixed(2))}
                    className="px-2 py-1 rounded text-xs font-bold border bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    MAX
                  </button>
                )}
              </div>
              <p className="text-[10px] text-zinc-600">Balance: {balStr} WILD</p>
            </div>

            {/* CHOICE */}
            <div className="p-4 space-y-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Choose</p>
              <div className="flex flex-col gap-1.5 h-[calc(100%-22px)]">
                {([0, 1, 2] as RpsChoice[]).map((c) => (
                  <button
                    key={c}
                    disabled={loading}
                    onClick={() => setChoice(c)}
                    className={`flex-1 flex items-center gap-2.5 px-3 rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      choice === c
                        ? 'border-amber-400/55 bg-amber-500/10 shadow-[0_0_14px_rgba(200,146,10,0.18)]'
                        : 'border-zinc-700/60 bg-zinc-800/30 hover:border-zinc-600'
                    }`}
                  >
                    <RpsIcon choice={c} size={22} active={choice === c} />
                    <span className={`text-xs font-bold tracking-wider ${choice === c ? 'text-amber-200' : 'text-zinc-500'}`}>
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
                className="w-full h-full min-h-[90px] rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #d4a017 0%, #c8920a 40%, #8b6000 100%)',
                  boxShadow: loading ? 'none' : '0 0 30px rgba(200,146,10,0.3), inset 0 1px 0 rgba(255,220,80,0.3)',
                  border: '1px solid rgba(200,146,10,0.4)',
                  color: '#1a0e00',
                }}
              >
                {/* Hand throw icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 11V9a2 2 0 0 0-4 0v1"/>
                  <path d="M14 10V8a2 2 0 0 0-4 0v2"/>
                  <path d="M10 9.9V9a2 2 0 0 0-4 0v5a7 7 0 0 0 14 0v-4a2 2 0 0 0-4 0v2"/>
                </svg>
                <span className="font-black text-xl tracking-widest" style={{ letterSpacing: '0.1em' }}>
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
