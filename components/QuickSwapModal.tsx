'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeftRight, Gamepad2, Check } from 'lucide-react';
import { useAccount } from 'wagmi';
import { parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useWildVault } from '@/lib/web3/hooks/useWildVault';
import { useGamePlay } from '@/lib/web3/hooks/useGamePlay';
import { useTxActivity } from '@/lib/web3/context/TxActivityContext';
import { addresses } from '@/lib/web3/constants/addresses';

export type QuickSwapVariant = 'wild' | 'credits' | null;

interface Props {
  variant: QuickSwapVariant;
  onClose: () => void;
}

type Status = 'idle' | 'pending' | 'ok' | 'error';

function goldBtn(extra = '') {
  return {
    className: `w-full py-3 rounded-xl text-sm font-black text-[#1a0e00] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${extra}`,
    style: { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } as React.CSSProperties,
  };
}

function StatusLine({ status, msg }: { status: Status; msg: string }) {
  if (status === 'idle' || !msg) return null;
  if (status === 'ok') return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-green-300"
      style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
      <Check className="w-3.5 h-3.5" />{msg}
    </div>
  );
  return (
    <div className="px-4 py-2.5 rounded-xl text-xs font-medium text-red-300 break-words"
      style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
      {msg}
    </div>
  );
}

// ── Wild ↔ USDC swap panel ─────────────────────────────────────────────────
function WildSwapPanel({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const { wildBalance, usdcBalance, refetchAll } = usePlayerState();
  const vault = useWildVault();
  const { refreshBalances } = useTxActivity();

  const [dir, setDir] = useState<'buy' | 'sell'>('buy');
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<bigint | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState('');

  const wildStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';
  const usdcStr = usdcBalance ? Number(formatUnits(usdcBalance as bigint, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';

  useEffect(() => {
    if (!input || Number(input) <= 0) { setPreview(null); return; }
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        if (dir === 'buy') setPreview(await vault.previewBuy(parseUnits(input, 6)));
        else setPreview(await vault.previewSell(parseEther(input)));
      } catch { setPreview(null); }
      finally { setPreviewLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [input, dir]);

  const handleSwap = async () => {
    if (!address || !input || Number(input) <= 0) return;
    setStatus('pending'); setMsg('');
    try {
      if (dir === 'buy') {
        await vault.buyWild(parseUnits(input, 6), address);
        setMsg(`Bought WILD with ${input} USDC`);
      } else {
        await vault.sellWild(parseEther(input), address);
        setMsg(`Sold ${input} WILD for USDC`);
      }
      setStatus('ok');
      setInput(''); setPreview(null);
      refetchAll(); refreshBalances();
    } catch (e: unknown) {
      setStatus('error');
      const raw = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      setMsg(raw.length > 120 ? raw.slice(0, 120) + '…' : raw);
    }
  };

  const maxVal = dir === 'buy'
    ? (usdcBalance ? Number(formatUnits(usdcBalance as bigint, 6)).toFixed(2) : '0')
    : (wildBalance ? Number(formatEther(wildBalance as bigint)).toFixed(4) : '0');

  return (
    <div className="space-y-4">
      {/* Direction toggle */}
      <div className="flex rounded-xl overflow-hidden border border-amber-400/20">
        {(['buy', 'sell'] as const).map((d) => (
          <button key={d} type="button"
            onClick={() => { setDir(d); setInput(''); setPreview(null); setStatus('idle'); }}
            className={`flex-1 py-2.5 text-sm font-black transition-all ${d === dir ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {d === 'buy' ? 'Buy WILD with USDC' : 'Sell WILD for USDC'}
          </button>
        ))}
      </div>

      {/* Balances bar */}
      <div className="flex justify-between text-xs text-zinc-500 px-1">
        <span>WILD: <span className="text-zinc-300 font-bold">{wildStr}</span></span>
        <span>USDC: <span className="text-zinc-300 font-bold">{usdcStr}</span></span>
      </div>

      {/* Amount input */}
      <div>
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">
          {dir === 'buy' ? 'USDC amount' : 'WILD amount'}
        </label>
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1a1a1a]"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <input
            type="number" min="0" step="any" value={input}
            onChange={(e) => { setInput(e.target.value); setStatus('idle'); }}
            placeholder="0.00"
            className="flex-1 min-w-0 bg-transparent text-lg font-black text-zinc-100 focus:outline-none placeholder:text-zinc-700"
          />
          <button type="button" onClick={() => setInput(maxVal)}
            className="text-[11px] font-black text-amber-400 hover:text-amber-300 transition-colors">
            MAX
          </button>
          <span className="text-xs font-bold text-zinc-500">{dir === 'buy' ? 'USDC' : 'WILD'}</span>
        </div>
      </div>

      {/* Preview */}
      {(preview !== null || previewLoading) && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#1a1a1a] border border-amber-400/10">
          <span className="text-xs text-zinc-500">You receive</span>
          <span className="text-sm font-black text-zinc-200">
            {previewLoading ? '…' : preview !== null
              ? `${dir === 'buy' ? Number(formatEther(preview)).toFixed(4) : Number(formatUnits(preview, 6)).toFixed(2)} ${dir === 'buy' ? 'WILD' : 'USDC'}`
              : '—'}
          </span>
        </div>
      )}

      {!vault.usdcAccepted && (
        <p className="text-xs text-zinc-500 text-center">USDC pool not yet active on this vault.</p>
      )}

      <button {...goldBtn()} disabled={status === 'pending' || !input || Number(input) <= 0 || !vault.usdcAccepted}
        onClick={handleSwap}>
        {status === 'pending' ? 'Swapping…' : dir === 'buy' ? 'Buy WILD' : 'Sell WILD'}
      </button>

      <StatusLine status={status} msg={msg} />
    </div>
  );
}

// ── Credits convert panel ──────────────────────────────────────────────────
function CreditsPanel({ onClose }: { onClose: () => void }) {
  const { wildBalance, usdcBalance, creditsBalance, refetchAll } = usePlayerState();
  const { purchaseCredits } = useGamePlay();
  const { refreshBalances } = useTxActivity();

  const [input, setInput] = useState('10');
  const [tokenSrc, setTokenSrc] = useState<'WILD' | 'USDC'>('WILD');
  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState('');

  const wildStr = wildBalance ? Number(formatEther(wildBalance as bigint)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';
  const usdcStr = usdcBalance ? Number(formatUnits(usdcBalance as bigint, 6)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';
  const credStr = creditsBalance ? Number(formatEther(creditsBalance as bigint)).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';

  const handleBuy = async () => {
    setStatus('pending'); setMsg('');
    try {
      const token = tokenSrc === 'USDC' ? addresses.usdc : addresses.wildToken;
      const decimals = tokenSrc === 'USDC' ? 6 : 18;
      const amount = parseUnits(input, decimals);
      await purchaseCredits(amount, token);
      setStatus('ok'); setMsg('Credits purchased!');
      setInput('10');
      refetchAll(); refreshBalances();
    } catch (e: unknown) {
      setStatus('error');
      const raw = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      setMsg(raw.length > 120 ? raw.slice(0, 120) + '…' : raw);
    }
  };

  return (
    <div className="space-y-4">
      {/* Current credits */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-400/5 border border-amber-400/20">
        <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Current Credits</span>
        <span className="text-base font-black text-amber-200">{credStr} CRED</span>
      </div>

      {/* Source token toggle */}
      <div>
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Convert from</p>
        <div className="flex rounded-xl overflow-hidden border border-amber-400/20">
          {(['WILD', 'USDC'] as const).map((t) => (
            <button key={t} type="button"
              onClick={() => { setTokenSrc(t); setStatus('idle'); }}
              className={`flex-1 py-2.5 text-sm font-black transition-all ${t === tokenSrc ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {t} <span className="text-zinc-500 text-xs font-bold">({t === 'WILD' ? wildStr : usdcStr})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Amount</label>
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#1a1a1a]"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <input type="number" min="1" step="1" value={input}
            onChange={(e) => { setInput(e.target.value); setStatus('idle'); }}
            placeholder="10"
            className="flex-1 min-w-0 bg-transparent text-lg font-black text-zinc-100 focus:outline-none placeholder:text-zinc-700"
          />
          <span className="text-xs font-bold text-zinc-500">{tokenSrc}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {['10', '50', '100', '500'].map((v) => (
          <button key={v} type="button" onClick={() => setInput(v)}
            className={`py-1.5 rounded-lg text-xs font-bold border transition-all ${input === v ? 'border-transparent text-[#1a1205]' : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
            style={input === v ? { background: 'linear-gradient(20deg, #debc6e, #8c6825)' } : undefined}>
            {v}
          </button>
        ))}
      </div>

      <button {...goldBtn()} disabled={status === 'pending' || !input || Number(input) <= 0}
        onClick={handleBuy}>
        {status === 'pending' ? 'Converting…' : `Convert ${input} ${tokenSrc} → Credits`}
      </button>

      <StatusLine status={status} msg={msg} />
    </div>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────
export function QuickSwapModal({ variant, onClose }: Props) {
  if (!variant || typeof window === 'undefined') return null;

  const isWild = variant === 'wild';
  const title = isWild ? 'WILD ↔ USDC' : 'Convert to Credits';
  const Icon = isWild ? ArrowLeftRight : Gamepad2;

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0d0d0d] border border-amber-400/25 shadow-2xl overflow-hidden"
        style={{ animation: 'resultFadeIn 0.15s ease-out both' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-400/20 bg-[#161616]">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-amber-400" />
            <span className="font-black text-amber-100 tracking-wide">{title}</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-amber-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {isWild ? <WildSwapPanel onClose={onClose} /> : <CreditsPanel onClose={onClose} />}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
