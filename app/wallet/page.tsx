'use client';

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useGamePlay } from '@/lib/web3/hooks/useGamePlay';
import { WalletButton } from '@/components/WalletButton';

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  unit,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1"
      style={{
        background: accent
          ? 'linear-gradient(135deg, rgba(212,160,23,0.12) 0%, rgba(200,146,10,0.06) 100%)'
          : 'rgba(255,255,255,0.03)',
        border: accent ? '1px solid rgba(212,160,23,0.25)' : '1px solid rgba(255,255,255,0.06)',
        boxShadow: accent ? '0 0 24px rgba(200,146,10,0.08)' : 'none',
      }}
    >
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</p>
      <div className="flex items-end gap-1.5 mt-1">
        <span className="text-3xl font-black tabular-nums text-zinc-100 leading-none">{value}</span>
        <span className={`text-sm font-bold mb-0.5 ${accent ? 'text-amber-400' : 'text-zinc-500'}`}>{unit}</span>
      </div>
      {sub && <p className="text-[11px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const { address } = useAccount();
  const { wildBalance, creditsBalance } = usePlayerState();
  const { purchaseCredits } = useGamePlay();

  const [buyAmount, setBuyAmount] = useState('10');
  const [status, setStatus] = useState<'idle' | 'pending' | 'ok' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const fmt = (b?: bigint) => b ? Number(formatEther(b)).toFixed(2) : '0.00';

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleBuy = async () => {
    setStatus('pending');
    setStatusMsg('');
    try {
      await purchaseCredits(parseEther(buyAmount));
      setStatus('ok');
      setStatusMsg('Credits purchased successfully.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e as { shortMessage?: string; message: string }).shortMessage ?? e.message : 'Error';
      setStatus('error');
      setStatusMsg(msg.length > 100 ? msg.slice(0, 100) + '…' : msg);
    }
  };

  const QUICK_AMOUNTS = ['10', '50', '100', '500'];

  // ── Not connected ────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.2)' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black text-amber-100">Wallet</h1>
          <p className="text-zinc-500 text-sm mt-1">Connect your wallet to view balances.</p>
        </div>
        <WalletButton />
      </div>
    );
  }

  const short = `${address.slice(0, 8)}...${address.slice(-6)}`;

  // ── Connected ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex-1 p-5 space-y-4 max-w-xl w-full mx-auto">

        {/* ── Address card ── */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: 'linear-gradient(135deg, #0e0e0e 0%, #111111 100%)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Avatar */}
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-black"
            style={{
              background: 'linear-gradient(135deg, #d4a017, #8b6000)',
              color: '#1a0e00',
            }}
          >
            {address.slice(2, 4).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Connected Address</p>
            <p className="text-sm font-mono text-zinc-300 truncate mt-0.5">{short}</p>
          </div>

          <button
            onClick={handleCopy}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: copied ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
              border: copied ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.08)',
              color: copied ? '#4ade80' : '#a1a1aa',
            }}
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        {/* ── Balances ── */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="WILD Balance"
            value={fmt(wildBalance)}
            unit="WILD"
            sub="Available to bet"
            accent
          />
          <StatCard
            label="Game Credits"
            value={fmt(creditsBalance)}
            unit="CRED"
            sub="Usable across all games"
          />
        </div>

        {/* ── Buy credits ── */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {/* Header */}
          <div
            className="px-5 py-3 flex items-center gap-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
            </svg>
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Buy Credits</span>
          </div>

          <div className="p-5 space-y-4">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Convert WILD tokens into Game Credits. Credits let you play without separate token approvals each round.
            </p>

            {/* Quick amounts */}
            <div className="flex gap-2">
              {QUICK_AMOUNTS.map((v) => (
                <button
                  key={v}
                  onClick={() => setBuyAmount(v)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    buyAmount === v
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                      : 'bg-zinc-800/60 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Input + button */}
            <div className="flex gap-2">
              <div
                className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <span className="text-amber-400 font-bold">♦</span>
                <input
                  type="number"
                  min="1"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-sm font-bold text-zinc-100 focus:outline-none placeholder:text-zinc-600"
                  placeholder="Amount in WILD"
                />
                <span className="text-xs text-zinc-600 font-bold">WILD</span>
              </div>
              <button
                onClick={handleBuy}
                disabled={status === 'pending'}
                className="px-5 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #d4a017 0%, #c8920a 50%, #8b6000 100%)',
                  color: '#1a0e00',
                  border: '1px solid rgba(200,146,10,0.4)',
                  boxShadow: status === 'pending' ? 'none' : '0 0 16px rgba(200,146,10,0.2)',
                }}
              >
                {status === 'pending' ? 'Buying…' : 'Buy'}
              </button>
            </div>

            {/* Status */}
            {status === 'ok' && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium text-green-300"
                style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {statusMsg}
              </div>
            )}
            {status === 'error' && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium text-red-300"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {statusMsg}
              </div>
            )}
          </div>
        </div>

        {/* ── Info row ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', label: 'Non-custodial', sub: 'Your keys, your funds' },
            { icon: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z', label: 'Fast TX', sub: 'One-click plays' },
            { icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', label: 'Base Chain', sub: 'Low fees' },
          ].map(({ icon, label, sub }) => (
            <div
              key={label}
              className="rounded-xl p-3 flex flex-col items-center gap-1.5 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <svg className="w-4 h-4 text-amber-400/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon}/>
              </svg>
              <span className="text-[11px] font-bold text-zinc-400">{label}</span>
              <span className="text-[10px] text-zinc-600">{sub}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
