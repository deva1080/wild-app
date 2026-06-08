'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  X, Wallet, Zap, Gamepad2, Coins, CircleDollarSign, ArrowRight, Check, Sparkles,
} from 'lucide-react';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useTxMode } from '@/lib/web3/context/TxModeContext';

const SEEN_KEY = 'wc_onboarded_v1';
export const OPEN_ONBOARDING_EVENT = 'wc:open-onboarding';

type FundState = 'empty' | 'eth-only' | 'has-usdc' | 'ready';

const has = (b: unknown): boolean => typeof b === 'bigint' && b > 0n;

function gold(text = false) {
  return {
    background: 'linear-gradient(20deg, #debc6e, #8c6825)',
    ...(text
      ? { WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }
      : {}),
  } as React.CSSProperties;
}

interface StepDef {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  cta?: { label: string; onClick: () => void };
}

export function OnboardingFlow() {
  const { address } = useAccount();
  const router = useRouter();
  const { wildBalance, usdcBalance, creditsBalance, ethBalance } = usePlayerState();
  const { isFastTx, setMode } = useTxMode();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const fundState: FundState = useMemo(() => {
    if (has(wildBalance) || has(creditsBalance)) return 'ready';
    if (has(usdcBalance)) return 'has-usdc';
    if (has(ethBalance)) return 'eth-only';
    return 'empty';
  }, [wildBalance, usdcBalance, creditsBalance, ethBalance]);

  // Auto-open once per wallet that hasn't seen onboarding.
  useEffect(() => {
    if (!address) return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (!seen) {
      setStep(0);
      setOpen(true);
    }
  }, [address]);

  // Allow manual re-open (e.g. from Account settings).
  useEffect(() => {
    const handler = () => { setStep(0); setOpen(true); };
    window.addEventListener(OPEN_ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, handler);
  }, []);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, []);

  const goAccount = useCallback(() => {
    finish();
    router.push('/account');
  }, [finish, router]);

  // ── Adaptive welcome step ────────────────────────────────────────────────
  const welcome: StepDef = useMemo(() => {
    switch (fundState) {
      case 'empty':
        return {
          icon: <Wallet className="w-7 h-7" />,
          title: 'Welcome to Wildcard',
          body: (
            <>
              <p>Your wallet has no funds yet. To start playing you first need to add money.</p>
              <p className="mt-2 text-zinc-400">
                The easiest path: add <strong className="text-amber-200">USDC</strong> on Base (card or transfer), then bet with USDC — or convert it to <strong className="text-amber-200">WILD</strong> for the best rewards.
              </p>
            </>
          ),
          cta: { label: 'Add funds', onClick: goAccount },
        };
      case 'eth-only':
        return {
          icon: <CircleDollarSign className="w-7 h-7" />,
          title: 'You have ETH — get USDC to play',
          body: (
            <>
              <p>Nice, you have ETH for gas. To place bets you need a betting balance.</p>
              <p className="mt-2 text-zinc-400">
                Get <strong className="text-amber-200">USDC</strong> on Base and start playing with it. You can later swap USDC → <strong className="text-amber-200">WILD</strong> in your account.
              </p>
            </>
          ),
          cta: { label: 'Get USDC', onClick: goAccount },
        };
      case 'has-usdc':
        return {
          icon: <Sparkles className="w-7 h-7" />,
          title: "You're ready to play with USDC",
          body: (
            <>
              <p>You have USDC — pick <strong className="text-amber-200">USDC</strong> in any game and start betting.</p>
              <p className="mt-2 text-zinc-400">
                Want better rewards? Swap some USDC for <strong className="text-amber-200">WILD</strong>, our native token, from the Swap tab in your account.
              </p>
            </>
          ),
          cta: { label: 'Buy WILD', onClick: goAccount },
        };
      case 'ready':
      default:
        return {
          icon: <Sparkles className="w-7 h-7" />,
          title: "You're all set",
          body: (
            <>
              <p>You have a betting balance ready. Jump into any game and play.</p>
              <p className="mt-2 text-zinc-400">Take a quick look at the features below so you get the most out of Wildcard.</p>
            </>
          ),
        };
    }
  }, [fundState, goAccount]);

  const steps: StepDef[] = useMemo(() => [
    welcome,
    {
      icon: <Coins className="w-7 h-7" />,
      title: 'Your balances',
      body: (
        <ul className="space-y-2 text-zinc-300">
          <li><strong className="text-amber-200">WILD</strong> — native token, best rewards.</li>
          <li><strong className="text-amber-200">USDC</strong> — stablecoin, bet without price swings.</li>
          <li><strong className="text-amber-200">Credits</strong> — prepaid game balance (no per-round approvals).</li>
          <li><strong className="text-amber-200">ETH</strong> — only used to pay gas on Base.</li>
        </ul>
      ),
    },
    {
      icon: <Zap className="w-7 h-7" />,
      title: 'Turbo (Fast TX) — recommended',
      body: (
        <>
          <p>With <strong className="text-amber-200">Turbo</strong> on, you play instantly without confirming a wallet popup every round.</p>
          <p className="mt-2 text-zinc-400">It&apos;s on by default. You can toggle it anytime from the ⚡ button in any game or your wallet menu.</p>
        </>
      ),
      cta: {
        label: isFastTx ? 'Turbo is on ✓' : 'Turn Turbo on',
        onClick: () => setMode('delegated'),
      },
    },
    {
      icon: <Gamepad2 className="w-7 h-7" />,
      title: 'Game Credits',
      body: (
        <>
          <p>Convert WILD or USDC into <strong className="text-amber-200">Credits</strong> to play smoothly without token approvals each round.</p>
          <p className="mt-2 text-zinc-400">Manage and top up Credits from your account.</p>
        </>
      ),
      cta: { label: 'Open account', onClick: goAccount },
    },
  ], [welcome, isFastTx, setMode, goAccount]);

  if (!open) return null;

  const isLast = step >= steps.length - 1;
  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-[#0d0d0d] border border-amber-400/25 shadow-2xl overflow-hidden"
        style={{ animation: 'resultFadeIn 0.2s ease-out both' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-400/20 bg-[#161616]">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6' : 'w-1.5'} ${i <= step ? '' : 'bg-zinc-700'}`}
                style={i <= step ? gold() : undefined}
              />
            ))}
          </div>
          <button onClick={finish} className="text-zinc-500 hover:text-amber-300 transition-colors" aria-label="Skip">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-[#1a0e00]"
            style={gold()}
          >
            {current.icon}
          </div>
          <h3 className="text-2xl font-black mb-3" style={gold(true)}>{current.title}</h3>
          <div className="text-sm text-zinc-300 leading-relaxed">{current.body}</div>

          {current.cta && (
            <button
              onClick={current.cta.onClick}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-[#1a0e00]"
              style={gold()}
            >
              {current.cta.label}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-amber-400/15 bg-[#0a0a0a]">
          <button
            onClick={finish}
            className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-300 bg-[#161616] border border-zinc-700 hover:border-zinc-600 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
              className="px-5 py-2 rounded-xl text-sm font-black text-[#1a0e00] flex items-center gap-1.5"
              style={gold()}
            >
              {isLast ? (<><Check className="w-4 h-4" /> Done</>) : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
