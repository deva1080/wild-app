'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatUnits } from 'viem';
import { ChevronDown, CircleDollarSign, Gamepad2, Coins, Fuel, Sparkles, ArrowLeftRight, Plus } from 'lucide-react';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { useBetTokenContext } from '@/lib/web3/context/BetTokenContext';
import { PAYMENT_METHOD_LIST, PaymentMethodKey } from '@/lib/web3/constants/tokens';
import { useTxActivity } from '@/lib/web3/context/TxActivityContext';

const ICONS: Record<PaymentMethodKey, React.ReactNode> = {
  WILD: <CircleDollarSign className="w-4 h-4" />,
  USDC: <Coins className="w-4 h-4" />,
  CREDITS: <Gamepad2 className="w-4 h-4" />,
  FUN: <Sparkles className="w-4 h-4" />,
};

function fmt(balance: bigint | undefined, decimals: number) {
  if (balance === undefined) return '0.00';
  return Number(formatUnits(balance, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

interface DropdownPos { top: number; left: number; width: number }
type ManageTarget = 'wild' | 'credits';

/** Compact dropdown to choose the bet payment method (WILD / USDC / Credits).
 *  The dropdown is rendered via a portal at the body level so it is never
 *  clipped or hidden by parent overflow or stacking contexts (e.g. the sidebar).
 */
export function PaymentSelector({
  disabled = false,
  onManage,
}: {
  disabled?: boolean;
  onManage?: (target: ManageTarget) => void;
}) {
  const { method, setMethod, funBalance } = useBetTokenContext();
  const { address, ethBalance, balanceForMethod } = usePlayerState();
  const { isTxActive } = useTxActivity();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const locked = disabled || isTxActive;

  useEffect(() => {
    if (!address && method !== 'FUN') setMethod('FUN');
  }, [address, method, setMethod]);

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
  const currentBalance = current.isFun ? funBalance : balanceForMethod(current.key);
  const ethLow = ethBalance === undefined || ethBalance < 100000000000000n;

  const dropdown = open && pos ? (
    <div
      ref={dropRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="rounded-xl border border-amber-400/30 bg-[#0d0d0d] shadow-2xl overflow-hidden"
    >
      <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Play with</p>
      {PAYMENT_METHOD_LIST.map((m) => {
        const active = m.key === method;
        const rowDisabled = locked || (!address && !m.isFun);
        const balance = m.isFun ? funBalance : balanceForMethod(m.key);
        const manageTarget: ManageTarget | null =
          m.key === 'WILD' ? 'wild' : m.key === 'CREDITS' ? 'credits' : null;
        return (
          <div
            key={m.key}
            className={`flex items-center transition-colors ${
              active ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-300 hover:bg-[#161616]'
            }`}
          >
            <button
              type="button"
              disabled={rowDisabled}
              onClick={() => { setMethod(m.key); setOpen(false); }}
              className="flex flex-1 items-center justify-between px-3 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-2">
                <span className={active ? 'text-amber-300' : 'text-zinc-500'}>{ICONS[m.key]}</span>
                <span className="font-bold">{m.label}</span>
              </span>
              <span className="text-xs font-bold tabular-nums text-zinc-400">
                {fmt(balance, m.decimals)}
              </span>
            </button>
            {address && manageTarget && onManage && (
              <button
                type="button"
                disabled={locked}
                title={manageTarget === 'wild' ? 'Swap WILD / USDC' : 'Buy Credits'}
                onClick={() => {
                  setOpen(false);
                  onManage(manageTarget);
                }}
                className="mr-2 grid place-items-center w-7 h-7 rounded-md text-amber-200 hover:bg-amber-400/15 disabled:opacity-40"
              >
                {manageTarget === 'wild'
                  ? <ArrowLeftRight className="w-3.5 h-3.5" />
                  : <Plus className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        );
      })}
      <div className={`flex items-center justify-between w-full px-3 py-2.5 text-sm border-t border-amber-400/15 ${
        ethLow ? 'text-red-300' : 'text-zinc-400'
      }`}>
        <span className="flex items-center gap-2">
          <Fuel className="w-4 h-4" />
          <span className="font-bold">ETH Gas</span>
          <span className="text-[9px] uppercase tracking-wider opacity-60">Info</span>
        </span>
        <span className="text-xs font-bold tabular-nums">
          {ethBalance === undefined ? '0.0000' : Number(formatUnits(ethBalance, 18)).toFixed(4)}
        </span>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative shrink-0" data-tour="payment-selector">
      <button
        ref={btnRef}
        type="button"
        disabled={locked}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex items-center gap-2 max-w-[190px] sm:max-w-none px-3 py-1.5 rounded-lg text-sm font-black tracking-wide text-amber-100 bg-[#161616] border border-amber-400/30 hover:border-amber-400/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-amber-300">{ICONS[current.key]}</span>
        <span className="truncate">{current.label}</span>
        <span className="text-[11px] font-bold text-zinc-500 tabular-nums">
          {fmt(currentBalance, current.decimals)}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-amber-200/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {typeof window !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
