'use client';

import React, { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, isAddress } from 'viem';
import { Address } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay } from '@/lib/web3/hooks/useGamePlay';
import { useReferral } from '@/lib/web3/hooks/useReferral';
import { useReferrerStats } from '@/lib/web3/hooks/useReferrerStats';
import { useWildVault } from '@/lib/web3/hooks/useWildVault';
import { useReferralContext } from '@/lib/web3/context/ReferralContext';
import { WalletButton } from '@/components/WalletButton';
import { JackpotWidget } from '@/components/JackpotWidget';
import { OPEN_ONBOARDING_EVENT } from '@/components/OnboardingFlow';
import { addresses } from '@/lib/web3/constants/addresses';
import { abis } from '@/lib/web3/constants/abis';
import {
  CircleDollarSign, Hash, CreditCard, Users, History,
  Settings, ChevronRight, X, Copy, Check, ArrowLeftRight,
  Star, TrendingUp, Gift,
} from 'lucide-react';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, unit, sub, accent = false,
}: {
  label: string; value: string; unit: string; sub?: string; accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1 relative overflow-hidden bg-[#161616]"
      style={{
        border: accent ? '1px solid rgba(222,188,110,0.25)' : '1px solid rgba(255,255,255,0.06)',
        boxShadow: accent ? '0 0 24px rgba(222,188,110,0.08)' : 'none',
      }}
    >
      {accent && <div className="absolute -right-10 -top-10 w-32 h-32 bg-[#debc6e]/10 rounded-full blur-2xl" />}
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest relative z-10">{label}</p>
      <div className="flex items-end gap-1.5 mt-1 relative z-10">
        <span
          className="text-3xl font-black tabular-nums leading-none"
          style={accent ? {
            background: 'linear-gradient(20deg, #debc6e, #8c6825)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent', color: 'transparent',
          } : { color: '#f4f4f5' }}
        >{value}</span>
        {accent ? (
          <span className="text-sm font-bold mb-0.5" style={{
            background: 'linear-gradient(20deg, #debc6e, #8c6825)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent', color: 'transparent',
          }}>{unit}</span>
        ) : (
          <span className="text-sm font-bold mb-0.5 text-zinc-500">{unit}</span>
        )}
      </div>
      {sub && <p className="text-[11px] text-zinc-600 mt-0.5 relative z-10">{sub}</p>}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function ModalTemplate({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0d0d0d] border border-amber-400/25 shadow-2xl overflow-hidden" style={{ animation: 'resultFadeIn 0.2s ease-out both' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-400/20 bg-[#161616]">
          <h3 className="text-lg font-black text-amber-100 tracking-wide">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-amber-300 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(Math.round(value * 100), 100)}%`,
          background: 'linear-gradient(90deg, #debc6e, #f0d080)',
        }}
      />
    </div>
  );
}

// ── Status feedback ───────────────────────────────────────────────────────────
function StatusMsg({ status, msg }: { status: 'idle' | 'pending' | 'ok' | 'error'; msg: string }) {
  if (status === 'idle' || !msg) return null;
  if (status === 'ok') return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-green-300" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
      <Check className="w-4 h-4 flex-shrink-0" />{msg}
    </div>
  );
  if (status === 'error') return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-xl text-sm font-medium text-red-300" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
      <X className="w-4 h-4 flex-shrink-0 mt-0.5" />{msg}
    </div>
  );
  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { address } = useAccount();
  const { wildBalance, usdcBalance, creditsBalance, ethBalance, refetchAll } = usePlayerState();
  const { purchaseCredits } = useGamePlay();
  const { writeContractAsync } = useWriteContract();
  const referral = useReferral();
  const referrerStats = useReferrerStats();
  const wildVault = useWildVault();
  const { referrerAddress: contextReferrer } = useReferralContext();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (address) refetchAll();
  }, [address, refetchAll]);

  const [activeTab, setActiveTab] = useState<'overview' | 'referrals' | 'swap' | 'settings'>('overview');

  // Credits state
  const [buyAmount, setBuyAmount] = useState('10');
  const [creditStatus, setCreditStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [creditMsg, setCreditMsg] = useState('');

  // Copy
  const [copied, setCopied] = useState(false);
  const [refLinkCopied, setRefLinkCopied] = useState(false);

  // Modals
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositView, setDepositView] = useState<'options' | 'crypto'>('options');
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false);

  // Seed
  const [newSeed, setNewSeed] = useState('');
  const [seedStatus, setSeedStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [seedMsg, setSeedMsg] = useState('');

  // Referral - register
  const [registerInput, setRegisterInput] = useState('');
  const [regStatus, setRegStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [regMsg, setRegMsg] = useState('');

  // Referral - claim
  const [claimStatus, setClaimStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [claimMsg, setClaimMsg] = useState('');
  const [origin, setOrigin] = useState('');

  // Swap
  const [swapDir, setSwapDir] = useState<'buy' | 'sell'>('buy');
  const [swapInput, setSwapInput] = useState('');
  const [swapPreview, setSwapPreview] = useState<bigint | null>(null);
  const [swapStatus, setSwapStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [swapMsg, setSwapMsg] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: currentSeed, refetch: refetchSeed } = useReadContract({
    address: addresses.games.crash,
    abi: abis.crash,
    functionName: 'playerSeeds',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const fmtWild = (b?: unknown) => typeof b === 'bigint' ? Number(formatEther(b)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';
  const fmtUsdc = (b?: unknown) => typeof b === 'bigint' ? Number(formatUnits(b, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const copyRefLink = () => {
    if (!address) return;
    const url = `${window.location.origin}?ref=${address}`;
    navigator.clipboard.writeText(url);
    setRefLinkCopied(true);
    setTimeout(() => setRefLinkCopied(false), 1800);
  };

  const QUICK_AMOUNTS = ['10', '50', '100', '500'];

  const handleBuyCredits = async () => {
    setCreditStatus('pending'); setCreditMsg('');
    try {
      await purchaseCredits(parseEther(buyAmount));
      setCreditStatus('ok');
      setCreditMsg('Credits purchased successfully.');
      refetchAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setCreditStatus('error');
      setCreditMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  const handleSetSeed = async () => {
    if (!newSeed) return;
    setSeedStatus('pending'); setSeedMsg('');
    try {
      await writeContractAsync({ address: addresses.games.crash, abi: abis.crash, functionName: 'setPlayerSeed', args: [BigInt(newSeed)] });
      setSeedStatus('ok'); setSeedMsg('Seed updated.');
      refetchSeed(); setNewSeed('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setSeedStatus('error'); setSeedMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  const handleRegisterReferral = async () => {
    if (!registerInput || !isAddress(registerInput)) { setRegStatus('error'); setRegMsg('Invalid address.'); return; }
    setRegStatus('pending'); setRegMsg('');
    try {
      await referral.registerReferral(registerInput as Address);
      setRegStatus('ok'); setRegMsg('Referrer registered!');
      referral.refetchAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setRegStatus('error'); setRegMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  const handleClaimRewards = async (token: Address) => {
    setClaimStatus('pending'); setClaimMsg('');
    try {
      await referral.claimRewards(token);
      setClaimStatus('ok'); setClaimMsg('Rewards claimed as Game Credits!');
      referral.refetchAll(); refetchAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setClaimStatus('error'); setClaimMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  // Swap preview with debounce
  useEffect(() => {
    if (!swapInput || Number(swapInput) <= 0) { setSwapPreview(null); return; }
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        if (swapDir === 'buy') {
          const amt = parseUnits(swapInput, 6);
          const out = await wildVault.previewBuy(amt);
          setSwapPreview(out);
        } else {
          const amt = parseEther(swapInput);
          const out = await wildVault.previewSell(amt);
          setSwapPreview(out);
        }
      } catch {
        setSwapPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [swapInput, swapDir]);

  const handleSwap = async () => {
    if (!address || !swapInput || Number(swapInput) <= 0) return;
    setSwapStatus('pending'); setSwapMsg('');
    try {
      if (swapDir === 'buy') {
        const amt = parseUnits(swapInput, 6);
        await wildVault.buyWild(amt, address);
        setSwapStatus('ok'); setSwapMsg(`Bought WILD with ${swapInput} USDC.`);
      } else {
        const amt = parseEther(swapInput);
        await wildVault.sellWild(amt, address);
        setSwapStatus('ok'); setSwapMsg(`Sold ${swapInput} WILD for USDC.`);
      }
      setSwapInput(''); setSwapPreview(null);
      refetchAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setSwapStatus('error'); setSwapMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.2)' }}>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-[52px] font-black uppercase tracking-tight leading-none" style={{ background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>My Account</h1>
          <p className="text-zinc-500 text-sm mt-1">Connect your wallet to view your account.</p>
        </div>
        <WalletButton />
      </div>
    );
  }

  const short = `${address.slice(0, 8)}…${address.slice(-6)}`;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-8 border-b border-amber-400/20 bg-[#0d0d0d]">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-[52px] font-black uppercase tracking-tight leading-none" style={{ background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85))' }}>
              My Account
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm font-mono text-zinc-400 whitespace-nowrap">{short}</p>
              <button onClick={handleCopy} className="text-amber-400/70 hover:text-amber-300 transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setIsDepositModalOpen(true)} className="px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00', border: '1px solid rgba(222,188,110,0.4)', boxShadow: '0 0 16px rgba(222,188,110,0.2)' }}>
              <CreditCard className="w-4 h-4" /> Deposit
            </button>
            <button onClick={() => setIsBuyModalOpen(true)} className="px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 bg-[#161616] text-[#debc6e] hover:bg-[#1a1a1a] border border-amber-400/20 hover:border-amber-400/40">
              <CircleDollarSign className="w-4 h-4" /> Buy WILD
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-amber-400/20 bg-[#0a0a0a] px-6">
        <div className="max-w-4xl mx-auto flex gap-6 overflow-x-auto">
          {[
            { id: 'overview',  label: 'Overview',  icon: CircleDollarSign },
            { id: 'referrals', label: 'Referrals', icon: Users },
            { id: 'swap',      label: 'Swap',      icon: ArrowLeftRight },
            { id: 'settings',  label: 'Settings',  icon: Settings },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 py-4 text-sm font-bold transition-colors relative whitespace-nowrap ${activeTab === tab.id ? 'text-[#debc6e]' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#debc6e] rounded-t-full" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* ── OVERVIEW ── */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Balances */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="WILD Balance" value={fmtWild(wildBalance)} unit="WILD" sub="Available to bet" accent />
                <StatCard label="USDC Balance" value={fmtUsdc(usdcBalance)} unit="USDC" sub="Stablecoin" />
                <StatCard label="Game Credits" value={fmtWild(creditsBalance)} unit="CRED" sub="Usable across all games" />
                <StatCard
                  label="ETH (Gas)"
                  value={typeof ethBalance === 'bigint' ? Number(formatEther(ethBalance)).toFixed(4) : '0.0000'}
                  unit="ETH"
                  sub="Used to pay gas on Base"
                />
              </div>

              {/* Jackpot */}
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.15)' }}>
                <div className="px-5 py-3 border-b border-amber-400/10 bg-[#0a0a0a] flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400/70" />
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Live Jackpot</span>
                </div>
                <JackpotWidget />
              </div>

              {/* Buy credits */}
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-5 py-3 flex items-center gap-2 border-b border-amber-400/20 bg-[#0a0a0a]">
                  <CreditCard className="w-4 h-4 text-amber-400/70" />
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Convert to Game Credits</span>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-zinc-400 leading-relaxed">Convert WILD or USDC into Game Credits to play without per-round approvals.</p>
                  <div className="flex gap-2">
                    {QUICK_AMOUNTS.map((v) => (
                      <button key={v} onClick={() => setBuyAmount(v)} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${buyAmount === v ? 'bg-[#debc6e]/20 border-[#debc6e]/50 text-[#debc6e]' : 'bg-[#1a1a1a] border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'}`}>{v}</button>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1a1a1a]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      <span className="text-[#debc6e] font-bold">♦</span>
                      <input type="number" min="1" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} className="flex-1 min-w-0 bg-transparent text-base font-black text-zinc-100 focus:outline-none placeholder:text-zinc-600" placeholder="Amount in WILD" />
                      <span className="text-xs text-zinc-500 font-bold">WILD</span>
                    </div>
                    <button onClick={handleBuyCredits} disabled={creditStatus === 'pending'} className="px-6 py-3 rounded-xl text-sm font-black transition-all disabled:opacity-50" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00' }}>
                      {creditStatus === 'pending' ? 'Converting…' : 'Convert'}
                    </button>
                  </div>
                  <StatusMsg status={creditStatus} msg={creditMsg} />
                </div>
              </div>
            </div>
          )}

          {/* ── REFERRALS ── */}
          {activeTab === 'referrals' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

              {/* My referrer */}
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-5 py-3 border-b border-amber-400/20 bg-[#0a0a0a] flex items-center gap-2">
                  <Gift className="w-4 h-4 text-amber-400/70" />
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">My Referrer</span>
                </div>
                <div className="p-5 space-y-4">
                  {referral.hasReferrer ? (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Referred by</p>
                      <p className="font-mono text-sm text-zinc-300 break-all">{referral.referrerOf}</p>
                      {referral.referralLocked && (
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20">Locked — first bet placed</span>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-400">Enter a referrer address to link your account. You can only do this before your first bet.</p>
                      {contextReferrer && contextReferrer !== '0x0000000000000000000000000000000000000000' && (
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-400/5 border border-amber-400/20">
                          <div className="flex-1">
                            <p className="text-xs text-amber-400 font-bold uppercase tracking-widest mb-0.5">Detected from link</p>
                            <p className="text-xs font-mono text-zinc-400">{contextReferrer}</p>
                          </div>
                          <button onClick={() => setRegisterInput(contextReferrer)} className="text-xs font-bold text-amber-400 hover:text-amber-300 px-2 py-1 rounded-lg bg-amber-400/10">Use</button>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <input
                          value={registerInput}
                          onChange={(e) => setRegisterInput(e.target.value)}
                          placeholder="0x referrer address"
                          className="flex-1 px-4 py-3 rounded-xl bg-[#1a1a1a] border border-amber-400/30 text-zinc-100 text-sm focus:outline-none focus:border-amber-400/60 transition-colors font-mono"
                        />
                        <button onClick={handleRegisterReferral} disabled={regStatus === 'pending'} className="px-5 py-3 rounded-xl text-sm font-black disabled:opacity-50" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00' }}>
                          {regStatus === 'pending' ? 'Registering…' : 'Register'}
                        </button>
                      </div>
                      <StatusMsg status={regStatus} msg={regMsg} />
                    </div>
                  )}
                </div>
              </div>

              {/* My referrer stats (if I'm a referrer) */}
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-5 py-3 border-b border-amber-400/20 bg-[#0a0a0a] flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-400/70" />
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">My Referral Stats</span>
                </div>
                <div className="p-5 space-y-5">
                  {/* Level */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl p-4 bg-[#1a1a1a]" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Level</p>
                      <div className="flex items-end gap-1">
                        <span className="text-3xl font-black" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'transparent' }}>
                          {referrerStats.level}
                        </span>
                        <span className="text-zinc-600 text-sm mb-0.5">/ {referrerStats.maxLevel}</span>
                      </div>
                    </div>
                    <div className="rounded-xl p-4 bg-[#1a1a1a]" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Commission</p>
                      <span className="text-3xl font-black text-zinc-100">{referrerStats.commissionPct.toFixed(2)}%</span>
                    </div>
                  </div>
                  {/* Weekly volume */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Weekly Volume (USD)</p>
                      <span className="text-xs font-black text-zinc-300">
                        ${referrerStats.weekVolumeUSD ? Number(formatEther(referrerStats.weekVolumeUSD)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00'}
                      </span>
                    </div>
                    <ProgressBar value={referrerStats.levelProgress} />
                    {referrerStats.nextLevelThreshold && referrerStats.level < referrerStats.maxLevel && (
                      <p className="text-[10px] text-zinc-600 mt-1">
                        Next level at ${Number(formatEther(referrerStats.nextLevelThreshold)).toLocaleString('en-US', { maximumFractionDigits: 0 })} / week
                      </p>
                    )}
                  </div>

                  {/* Pending rewards */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Pending Rewards</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'WILD', balance: referral.pendingRewardsWild, fmt: fmtWild, token: addresses.wildToken as Address },
                        { label: 'USDC', balance: referral.pendingRewardsUsdc, fmt: fmtUsdc, token: addresses.usdc as Address },
                      ].map(({ label, balance, fmt, token }) => (
                        <div key={label} className="rounded-xl p-3 bg-[#1a1a1a] space-y-2" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-zinc-500">{label}</span>
                            <span className="text-sm font-black text-zinc-200">{fmt(balance)}</span>
                          </div>
                          <button
                            onClick={() => handleClaimRewards(token)}
                            disabled={claimStatus === 'pending' || !balance || balance === 0n}
                            className="w-full py-1.5 rounded-lg text-xs font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00' }}
                          >
                            {claimStatus === 'pending' ? '…' : 'Claim'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <StatusMsg status={claimStatus} msg={claimMsg} />
                  </div>

                  {/* Share link */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Referral Link</p>
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a1a]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      <span className="text-xs font-mono text-zinc-500 flex-1 truncate">
                        {origin ? `${origin}?ref=${address}` : `...?ref=${address}`}
                      </span>
                      <button onClick={copyRefLink} className="flex-shrink-0 text-amber-400 hover:text-amber-300 transition-colors">
                        {refLinkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── SWAP ── */}
          {activeTab === 'swap' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-5 py-3 border-b border-amber-400/20 bg-[#0a0a0a] flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-amber-400/70" />
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Swap WILD ↔ USDC</span>
                </div>
                <div className="p-5 space-y-5">
                  {!wildVault.usdcAccepted && (
                    <div className="px-4 py-3 rounded-xl text-sm text-zinc-400 bg-zinc-800/50 border border-zinc-700">
                      WildVault: USDC pool not yet active.
                    </div>
                  )}

                  {/* Direction toggle */}
                  <div className="flex rounded-xl overflow-hidden border border-amber-400/20">
                    {(['buy', 'sell'] as const).map((dir) => (
                      <button key={dir} onClick={() => { setSwapDir(dir); setSwapInput(''); setSwapPreview(null); }}
                        className={`flex-1 py-3 text-sm font-black transition-all ${swapDir === dir ? 'bg-[#debc6e]/10 text-[#debc6e]' : 'text-zinc-500 hover:text-zinc-300 bg-transparent'}`}>
                        {dir === 'buy' ? 'Buy WILD with USDC' : 'Sell WILD for USDC'}
                      </button>
                    ))}
                  </div>

                  {/* Input */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                      {swapDir === 'buy' ? 'USDC amount' : 'WILD amount'}
                    </label>
                    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1a1a1a]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={swapInput}
                        onChange={(e) => setSwapInput(e.target.value)}
                        className="flex-1 min-w-0 bg-transparent text-base font-black text-zinc-100 focus:outline-none placeholder:text-zinc-600"
                        placeholder="0.00"
                      />
                      <span className="text-xs font-bold text-zinc-500">{swapDir === 'buy' ? 'USDC' : 'WILD'}</span>
                    </div>
                    {/* Balances */}
                    <div className="flex justify-between text-[10px] text-zinc-600">
                      <span>Balance: {swapDir === 'buy' ? `${fmtUsdc(usdcBalance)} USDC` : `${fmtWild(wildBalance)} WILD`}</span>
                      <button
                        onClick={() => {
                          if (swapDir === 'buy' && usdcBalance) setSwapInput(formatUnits(usdcBalance as bigint, 6));
                          if (swapDir === 'sell' && wildBalance) setSwapInput(formatEther(wildBalance as bigint));
                        }}
                        className="font-bold text-amber-400/70 hover:text-amber-300"
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  {(swapPreview !== null || previewLoading) && (
                    <div className="px-4 py-3 rounded-xl bg-[#1a1a1a] border border-amber-400/10 flex items-center justify-between">
                      <span className="text-xs text-zinc-500">You receive</span>
                      <span className="text-sm font-black text-zinc-200">
                        {previewLoading
                          ? '…'
                          : swapPreview !== null
                            ? `${swapDir === 'buy' ? fmtWild(swapPreview) : fmtUsdc(swapPreview)} ${swapDir === 'buy' ? 'WILD' : 'USDC'}`
                            : '—'}
                      </span>
                    </div>
                  )}

                  <button
                    onClick={handleSwap}
                    disabled={swapStatus === 'pending' || !swapInput || Number(swapInput) <= 0 || !wildVault.usdcAccepted}
                    className="w-full py-3.5 rounded-xl text-sm font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00' }}
                  >
                    {swapStatus === 'pending' ? 'Swapping…' : swapDir === 'buy' ? 'Buy WILD' : 'Sell WILD'}
                  </button>
                  <StatusMsg status={swapStatus} msg={swapMsg} />

                  {/* Rate info */}
                  {wildVault.usdcBuyRate && (
                    <p className="text-[10px] text-zinc-600 text-center">
                      Buy rate: 1 USDC = {fmtWild(wildVault.usdcBuyRate)} WILD
                      {wildVault.usdcSellRate ? ` · Sell rate: 1 WILD = ${fmtUsdc(wildVault.usdcSellRate)} USDC` : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {activeTab === 'settings' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-6 py-4 border-b border-amber-400/20 bg-[#0a0a0a] flex items-center gap-3">
                  <Hash className="w-5 h-5 text-[#debc6e]" />
                  <div>
                    <h3 className="font-bold text-lg text-zinc-100">Provably Fair Seed</h3>
                    <p className="text-xs text-zinc-500">Customize your client seed for randomness generation</p>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Current Seed</label>
                    <div className="px-4 py-3 rounded-xl bg-[#1a1a1a] border border-amber-400/20 font-mono text-sm text-zinc-300 break-all">
                      {currentSeed != null ? currentSeed.toString() : 'Default (Address)'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Set New Seed (Numeric)</label>
                    <div className="flex gap-3">
                      <input type="number" value={newSeed} onChange={(e) => setNewSeed(e.target.value)} placeholder="e.g. 123456789" className="flex-1 px-4 py-3 rounded-xl bg-[#1a1a1a] border border-amber-400/30 text-zinc-100 focus:outline-none focus:border-amber-400/60 transition-colors" />
                      <button onClick={handleSetSeed} disabled={seedStatus === 'pending' || !newSeed} className="px-6 py-3 rounded-xl text-sm font-bold bg-[#1a1a1a] text-[#debc6e] hover:bg-[#222222] border border-amber-400/30 disabled:opacity-50 transition-all">
                        {seedStatus === 'pending' ? 'Updating...' : 'Update'}
                      </button>
                    </div>
                  </div>
                  <StatusMsg status={seedStatus} msg={seedMsg} />
                </div>
              </div>

              {/* Tutorial / walkthrough */}
              <div className="rounded-2xl overflow-hidden bg-[#161616]" style={{ border: '1px solid rgba(222,188,110,0.25)' }}>
                <div className="px-6 py-4 border-b border-amber-400/20 bg-[#0a0a0a] flex items-center gap-3">
                  <Star className="w-5 h-5 text-[#debc6e]" />
                  <div>
                    <h3 className="font-bold text-lg text-zinc-100">How it works</h3>
                    <p className="text-xs text-zinc-500">Replay the welcome tour: balances, Turbo (Fast TX) and Credits</p>
                  </div>
                </div>
                <div className="p-6">
                  <button
                    onClick={() => window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT))}
                    className="px-5 py-3 rounded-xl text-sm font-black transition-all"
                    style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', color: '#1a0e00' }}
                  >
                    Show me around
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modals */}
      <ModalTemplate isOpen={isDepositModalOpen} onClose={() => { setIsDepositModalOpen(false); setTimeout(() => setDepositView('options'), 200); }} title="Deposit Funds">
        {depositView === 'options' ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400 mb-6">Choose how you want to add funds to your wallet.</p>
            <button className="w-full flex items-center justify-between p-4 rounded-xl border border-amber-400/20 bg-[#161616] hover:bg-[#1a1a1a] hover:border-amber-400/40 transition-all group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#debc6e]/10 flex items-center justify-center text-[#debc6e]"><CreditCard className="w-5 h-5" /></div>
                <div className="text-left">
                  <div className="font-bold text-zinc-100">Credit / Debit Card</div>
                  <div className="text-xs text-zinc-500">Via MoonPay or Transak</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-[#debc6e] transition-colors" />
            </button>
            <button onClick={() => setDepositView('crypto')} className="w-full flex items-center justify-between p-4 rounded-xl border border-amber-400/20 bg-[#161616] hover:bg-[#1a1a1a] hover:border-amber-400/40 transition-all group">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#debc6e]/10 flex items-center justify-center text-[#debc6e]">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="5"/></svg>
                </div>
                <div className="text-left">
                  <div className="font-bold text-zinc-100">Crypto Deposit</div>
                  <div className="text-xs text-zinc-500">Transfer from another wallet</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-[#debc6e] transition-colors" />
            </button>
          </div>
        ) : (
          <div className="space-y-6 text-center animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="bg-white p-4 rounded-2xl inline-block mx-auto shadow-[0_0_30px_rgba(222,188,110,0.15)]">
              <QRCode value={address || ''} size={180} />
            </div>
            <div>
              <h4 className="text-xl font-black text-zinc-100 mb-2">Send Crypto (Base Network)</h4>
              <p className="text-sm text-zinc-400 max-w-[280px] mx-auto leading-relaxed">Send WILD or USDC on the <strong className="text-amber-100">Base</strong> network to this address.</p>
            </div>
            <div className="bg-[#161616] border border-amber-400/20 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="text-sm font-mono text-zinc-300 truncate pl-2">{address}</div>
              <button onClick={handleCopy} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-[#debc6e] hover:bg-[#222222] transition-colors text-xs font-bold border border-amber-400/20">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setDepositView('options')} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Back to options</button>
          </div>
        )}
      </ModalTemplate>

      <ModalTemplate isOpen={isBuyModalOpen} onClose={() => setIsBuyModalOpen(false)} title="Buy WILD Token">
        <div className="space-y-6 text-center">
          <div className="w-20 h-20 mx-auto rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(222,188,110,0.3)]" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)' }}>
            <span className="text-3xl font-black text-[#1a0e00]">$</span>
          </div>
          <div>
            <h4 className="text-xl font-black text-zinc-100 mb-2">Get WILD Tokens</h4>
            <p className="text-sm text-zinc-400">Buy WILD on Uniswap (Base) or swap USDC directly via the Swap tab above.</p>
          </div>
          <button className="w-full py-3.5 rounded-xl font-black text-[#1a0e00] transition-all shadow-lg" style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', boxShadow: '0 0 16px rgba(222,188,110,0.2)' }}>
            Buy on Uniswap
          </button>
          <p className="text-xs text-zinc-500">Contract: <span className="font-mono text-zinc-400">{addresses.wildToken.slice(0, 6)}...{addresses.wildToken.slice(-4)}</span></p>
        </div>
      </ModalTemplate>
    </div>
  );
}
