'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatUnits } from 'viem';
import { ChevronDown, CircleDollarSign, Gamepad2, Coins } from 'lucide-react';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useBetTokenContext } from '@/lib/web3/context/BetTokenContext';
import { PAYMENT_METHOD_LIST, PaymentMethodKey } from '@/lib/web3/constants/tokens';

const ICONS: Record<PaymentMethodKey, React.ReactNode> = {
  WILD: <CircleDollarSign className="w-4 h-4" />,
  USDC: <Coins className="w-4 h-4" />,
  CREDITS: <Gamepad2 className="w-4 h-4" />,
};

function fmt(balance: bigint | undefined, decimals: number) {
  if (balance === undefined) return '0.00';
  return Number(formatUnits(balance, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

interface DropdownPos { top: number; left: number; width: number }

/** Compact dropdown to choose the bet payment method (WILD / USDC / Credits).
 *  The dropdown is rendered via a portal at the body level so it is never
 *  clipped or hidden by parent overflow or stacking contexts (e.g. the sidebar).
 */
export function PaymentSelector({ disabled = false }: { disabled?: boolean }) {
  const { method, setMethod } = useBetTokenContext();
  const { balanceForMethod } = usePlayerState();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const openDropdown = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || dropRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const current = PAYMENT_METHOD_LIST.find((m) => m.key === method)!;

  const dropdown = open && pos ? (
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="rounded-xl border border-amber-400/30 bg-[#0d0d0d] shadow-2xl overflow-hidden"
    >
      <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Bet with</p>
      {PAYMENT_METHOD_LIST.map((m) => {
        const active = m.key === method;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => { setMethod(m.key); setOpen(false); }}
            className={`flex items-center justify-between w-full px-3 py-2.5 text-sm transition-colors ${
              active ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-300 hover:bg-[#161616]'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={active ? 'text-amber-300' : 'text-zinc-500'}>{ICONS[m.key]}</span>
              <span className="font-bold">{m.label}</span>
            </span>
            <span className="text-xs font-bold tabular-nums text-zinc-400">
              {fmt(balanceForMethod(m.key), m.decimals)}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="relative shrink-0" data-tour="payment-selector">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-black tracking-wide text-amber-100 bg-[#161616] border border-amber-400/30 hover:border-amber-400/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-amber-300">{ICONS[current.key]}</span>
        <span>{current.label}</span>
        <span className="text-[11px] font-bold text-zinc-500 tabular-nums">
          {fmt(balanceForMethod(current.key), current.decimals)}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-amber-200/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {typeof window !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
