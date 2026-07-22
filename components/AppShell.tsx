'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Gamepad2, Scissors, Wallet } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { WalletButton } from '@/components/WalletButton';
import { PaymentSelector } from '@/components/PaymentSelector';
import { VolumeControl } from '@/components/VolumeControl';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { QuickSwapModal, QuickSwapVariant } from '@/components/QuickSwapModal';

const IconCrown = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
  </svg>
);

const IconSettings = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconPlinko = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className}>
    <circle cx="12" cy="4" r="1.4" />
    <circle cx="8" cy="9" r="1.4" />
    <circle cx="16" cy="9" r="1.4" />
    <circle cx="4" cy="14" r="1.4" />
    <circle cx="12" cy="14" r="1.4" />
    <circle cx="20" cy="14" r="1.4" />
    <circle cx="8" cy="19" r="1.4" />
    <circle cx="16" cy="19" r="1.4" />
  </svg>
);

const IconRocket = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </svg>
);

const IconFrog = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <ellipse cx="12" cy="14" rx="7" ry="6" />
    <circle cx="7" cy="7" r="2.2" />
    <circle cx="17" cy="7" r="2.2" />
    <circle cx="9.5" cy="13" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="13" r="0.8" fill="currentColor" stroke="none" />
    <path d="M9 17.5c1 .8 5 .8 6 0" />
  </svg>
);

const IconModernSlot = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <rect x="4" y="6" width="3" height="4" rx="1" />
    <rect x="8.5" y="6" width="3" height="4" rx="1" />
    <rect x="13" y="6" width="3" height="4" rx="1" />
    <rect x="17" y="6" width="3" height="4" rx="1" />
    <rect x="4" y="12" width="3" height="4" rx="1" />
    <rect x="8.5" y="12" width="3" height="4" rx="1" />
    <rect x="13" y="12" width="3" height="4" rx="1" />
    <rect x="17" y="12" width="3" height="4" rx="1" />
  </svg>
);

const IconSlot = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <rect x="5" y="7" width="4" height="5" rx="1" />
    <rect x="10" y="7" width="4" height="5" rx="1" />
    <rect x="15" y="7" width="4" height="5" rx="1" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const IconKeno = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="5"  cy="5"  r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5"  r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5"  r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5"  cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5"  cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const IconDice = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2" width="20" height="20" rx="3" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const IconHiLo = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="2" width="18" height="20" rx="3" />
    <path d="M12 7v10" />
    <path d="M9 10l3-3 3 3" />
    <path d="M9 14l3 3 3-3" />
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
  { href: '/plinko', label: 'Plinko', icon: IconPlinko },
  { href: '/hilo', label: 'Hi-Lo', icon: IconHiLo },
  { href: '/dice', label: 'Dice', icon: IconDice },
  { href: '/keno', label: 'Keno', icon: IconKeno },
  { href: '/slot', label: 'Slots', icon: IconSlot },
  { href: '/modernslot', label: 'Modern Slots', icon: IconModernSlot },
  { href: '/rocket', label: 'Rocket', icon: IconRocket },
  { href: '/frogger', label: 'Frogger', icon: IconFrog },
  { href: '/account', label: 'My Account', icon: Wallet },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [swapModal, setSwapModal] = useState<QuickSwapVariant>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen bg-transparent text-zinc-100 font-sans overflow-hidden">
      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Floating drawer toggle (mobile) */}
      {!drawerOpen && (
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
          className="md:hidden fixed bottom-5 left-4 z-30 grid place-items-center w-12 h-12 rounded-full border border-amber-400/40 bg-[#161616]/95 backdrop-blur text-amber-200 shadow-lg shadow-black/40 hover:bg-[#1f1f1f] active:scale-95 transition-all"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      )}

      {/* Sidebar — static on desktop, slide-in drawer on mobile */}
      <aside
        className={`border-r border-amber-400/20 bg-[#111111] flex flex-col justify-between flex-shrink-0 z-50
          fixed inset-y-0 left-0 w-64 max-w-[80vw] overflow-y-auto transform transition-transform duration-300 ease-in-out
          md:static md:translate-x-0 md:w-auto md:max-w-none md:overflow-visible md:z-auto
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div>
          <Link href="/" onClick={() => setDrawerOpen(false)} className="flex flex-col items-start gap-1 p-5 pb-6">

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
                  onClick={() => setDrawerOpen(false)}
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

        <div className="p-4 border-t border-amber-400/20 space-y-2">
          <VolumeControl />
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

          <div className="flex-1 flex justify-center min-w-0 px-2">
            <PaymentSelector onManage={(target) => setSwapModal(target)} />
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <WalletButton />
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>

      {/* Adaptive welcome + feature walkthrough */}
      <OnboardingFlow />

      {/* Quick-action swap modal (header WILD / CREDITS pills) */}
      <QuickSwapModal variant={swapModal} onClose={() => setSwapModal(null)} />
    </div>
  );
}