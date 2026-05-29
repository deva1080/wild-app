'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Gamepad2, Scissors, Wallet } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { usePlayerState } from '@/lib/web3/hooks/usePlayerState';
import { WalletButton } from '@/components/WalletButton';

const IconCrown = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
  </svg>
);

const IconGamepad = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 12h4m-2-2v4m10-2h.01M15 14h.01" />
  </svg>
);

const IconFileText = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const IconSettings = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconCoin = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="12" y1="2" x2="12" y2="6" />
  </svg>
);

const IconBase = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    <circle cx="12" cy="12" r="5" />
  </svg>
);

const navItems = [
  { href: '/', label: 'Play', icon: Gamepad2 },
  { href: '/crash', label: 'Crash', icon: IconCrown },
  { href: '/flip', label: 'Flip', icon: IconCoin },
  { href: '/rps', label: 'RPS', icon: Scissors },
  { href: '/wheel', label: 'Wheel', icon: IconSettings },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/transactions', label: 'Transactions', icon: IconFileText },
];

const formatBalance = (bal?: unknown) => {
  if (typeof bal === 'bigint') {
    return (Number(bal) / 1e18).toFixed(2);
  }
  if (typeof bal === 'number') {
    return (bal / 1e18).toFixed(2);
  }
  return '0.00';
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { address, wildBalance, creditsBalance } = usePlayerState();

  return (
    <div className="flex h-screen bg-transparent text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="border-r border-amber-400/20 bg-[#111111] hidden md:flex flex-col justify-between flex-shrink-0">
        <div>
          <Link href="/" className="flex flex-col items-start gap-1 p-5 pb-6">
            
            <Image
              src="/title.webp"
              alt="Wildcard Games"
              width={500}
              height={100}
              className="h-auto w-48"
              priority
            />
          </Link>

          <nav className="px-4 space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-3 pl-5 pr-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-gradient-to-r from-amber-400/15 to-amber-400/0 text-amber-100 border border-amber-400/35'
                      : 'text-zinc-300 hover:bg-[#1a1a1a] hover:text-zinc-100 border border-transparent hover:border-amber-400/25'
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-1 top-2 bottom-2 w-[3px] rounded-full"
                      style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)' }}
                    />
                  )}
                  <Icon className={`w-5 h-5 ${active ? 'text-amber-300' : ''}`} /> {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-amber-400/20">
          <div className="flex items-center gap-2 bg-[#1a1a1a] border border-amber-400/25 rounded-lg px-3 py-2 text-[11px] font-medium tracking-wide text-zinc-200">
            <IconBase className="w-3.5 h-3.5 text-amber-300" /> Base Network
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-amber-400/20 bg-[#0d0d0d] text-white flex items-center justify-between px-6 flex-shrink-0">
          {/* Mobile logo */}
          <Link href="/" className="flex md:hidden items-center gap-2">
            <IconCrown className="w-6 h-6 text-amber-300" />
            <span
              className="font-black tracking-wider"
              style={{
                background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              WILDCARD
            </span>
          </Link>

          <div className="hidden md:block" />

          <div className="flex items-center gap-3">
            {address && (
              <>
                <div className="hidden sm:flex items-center gap-2 border border-amber-400/25 hover:border-amber-300/60 transition-colors rounded-lg pl-3 pr-2 h-9 text-sm font-semibold bg-[#1a1a1a] text-amber-100">
                  <span className="leading-none">{formatBalance(wildBalance)}</span>
                  <span className="text-[14px] font-bold tracking-widest text-amber-200/70 leading-none">WILD</span>
                  <span
                    aria-hidden
                    className="grid place-items-center w-5 h-5 rounded-md text-[#1a1205] font-black text-[13px] leading-none"
                    style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)' }}
                  >
                    $
                  </span>
                </div>
                <div className="hidden sm:flex items-center gap-2 border border-amber-400/25 hover:border-amber-300/60 transition-colors rounded-lg pl-3 pr-2 h-9 text-sm font-semibold bg-[#1a1a1a] text-amber-100">
                  <span className="leading-none">{formatBalance(creditsBalance)}</span>
                  <span className="text-[14px] font-bold tracking-widest text-amber-200/70 leading-none">CREDITS</span>
                  <span
                    aria-hidden
                    className="grid place-items-center w-5 h-5 rounded-md text-[#1a1205]"
                    style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)' }}
                  >
                    <IconGamepad className="w-3 h-3" />
                  </span>
                </div>
              </>
            )}
            <WalletButton />
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}