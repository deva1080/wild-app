'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAccount } from 'wagmi';
import { WalletButton } from '@/components/WalletButton';
import { LiveFeed } from '@/components/LiveFeed';

const featurePills = [
  { title: 'Provably Fair', text: 'Verifiable and transparent' },
  { title: 'Instant Settlement', text: 'Payouts in seconds' },
  { title: 'Multichain Access', text: 'Play across leading chains' },
  { title: 'Secure Wallet Login', text: 'Non-custodial and secure' },
];

const games = [
  { slug: 'crash',   name: 'Crash',   image: '/images/crash.webp',   description: 'Multiplayer crash rounds with instant cashout.',                     mode: 'Arcade',        live: true },
  { slug: 'flip',    name: 'Flip',    image: '/images/flip.webp',    description: 'Heads or tails, fast 50/50 payout.',                                 mode: 'Classic',       live: true },
  { slug: 'rps',     name: 'RPS',     image: '/images/rps.webp',     description: 'Rock, paper, scissors against the house.',                           mode: 'Classic',       live: true },
  { slug: 'wheel',   name: 'Wheel',   image: '/images/wheel.webp',   description: 'Spin and land on your target segment.',                              mode: 'Strategy',      live: true },
  { slug: 'dice',    name: 'Dice',    image: '/images/dice.webp',    description: 'Roll the dice and predict the outcome for instant payouts.',          mode: 'Classic',       live: true },
  { slug: 'keno',    name: 'Keno',    image: '/images/keno.webp',    description: 'Pick your numbers and match the draw for big payouts.',              mode: 'Lottery',       live: true },
  { slug: 'hilo',    name: 'HiLo',    image: '/images/HiLo.webp',    description: 'Predict higher or lower on each card to multiply your bet.',         mode: 'Strategy',      live: true },
  { slug: 'frogger', name: 'Frogger', image: '/images/frogger.webp', description: 'Navigate the lanes and cash out before the multiplier crashes.',     mode: 'Arcade',        live: true },
  { slug: 'plinko',  name: 'Plinko',  image: '/images/plinko.webp',  description: 'Drop the chip and chase multipliers.',                               mode: 'High Variance', live: true },
  { slug: 'slot',    name: 'Slots',   image: '/images/slot.webp',    description: 'Classic slots feel with on-chain results.',                          mode: 'Jackpot',       live: true },
];

export default function Home() {
  const { address } = useAccount();
  const playersBySlug = React.useMemo(
    () =>
      Object.fromEntries(
        games.map((g) => [g.slug, Math.floor(Math.random() * 5000) + 1])
      ) as Record<string, number>,
    []
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const updateScrollButtons = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [updateScrollButtons]);

  const scrollByCards = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.8, 200);
    el.scrollBy({ left: direction === 'right' ? step : -step, behavior: 'smooth' });
  };

  return (
    <>
    <div className="p-4 md:p-6 mx-auto flex w-full max-w-full flex-col gap-4 overflow-x-hidden lg:h-full lg:overflow-hidden">
      {/* Hero */}
      <section className="relative overflow-hidden border border-amber-400/30 rounded-2xl h-[50vh] md:h-[400px] lg:h-[450px] shrink-0 shadow-[0_0_0_1px_rgba(251,191,36,0.1)]">
        <Image
          src="/hero.webp"
          alt="Hero illustration"
          fill
          sizes="100vw"
          className="object-cover object-center"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#111111] via-[#111111]/80 to-transparent" />
        <div className="relative h-full pl-[44px] md:pl-[52px] pr-6 md:pr-8 py-7 md:py-9 flex items-center">
          <div className="max-w-[692px]">
            <p className="text-[12px] md:text-[14px] font-bold text-amber-200/80 tracking-widest mb-4">WILDCARD ORIGINALS</p>
            <h1 className="text-[52px] md:text-[106px] leading-[0.85] mb-2.5 flex flex-col gap-0">
              <span style={{ background: 'linear-gradient(20deg, #f1f1f1, #b5b1ac)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                PLAY ON-CHAIN.
              </span>
              <span style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                WIN INSTANTLY.
              </span>
            </h1>
            <p className="text-[14px] md:text-[17px] text-zinc-300 mb-5 max-w-[538px]">
              Multichain games with wallet-based access, transparent prize pools, and fast settlement.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!address && <WalletButton />}
              <Link
                href="/crash"
                className="px-5 py-2.5 text-[17px] font-semibold rounded-lg text-[#1a1205] transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(20deg, #debc6e, #8c6825)' }}
              >
                Explore Games
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Games Row + Right Panel */}
      <section className="min-w-0 overflow-x-hidden lg:flex-1 lg:min-h-0 lg:overflow-hidden">
        <div className="grid min-w-0 gap-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative min-w-0 group/carousel lg:min-h-0">
            <div
              ref={scrollRef}
              className="w-full max-w-full overflow-x-auto overscroll-x-contain scroll-smooth touch-pan-x lg:h-full [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
            <div className="flex gap-3 min-w-max lg:h-full">
              {games.map((g) => {
                const textShadow = '0 2px 4px #000, 0 0 10px rgba(0,0,0,0.95), 0 0 22px rgba(0,0,0,0.85), 0 0 36px rgba(0,0,0,0.6)';
                const cardContent = (
                  <div className="relative w-full h-full">
                    <Image
                      src={g.image}
                      alt={g.name}
                      fill
                      sizes="172px"
                      className={`object-cover transition-transform ${g.live ? 'group-hover:scale-[1.03]' : 'opacity-40 grayscale'}`}
                    />
                    {!g.live && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] font-bold tracking-widest text-zinc-300 bg-black/60 px-2 py-1 rounded">
                          SOON
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 px-2.5 pb-3 text-center">
                      <h3
                        className={`font-black text-[42px] uppercase leading-[0.9] tracking-tight ${g.live ? '' : 'text-zinc-400'}`}
                        style={
                          g.live
                            ? {
                                background:
                                  'linear-gradient(20deg, rgb(241, 241, 241), rgb(181, 177, 172))',
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                color: 'transparent',
                                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.85)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',
                              }
                            : { textShadow }
                        }
                      >
                        {g.name}
                      </h3>
                      <p
                        className={`mt-2 flex items-center justify-center gap-1.5 text-[15px] font-semibold ${g.live ? 'text-zinc-100/90' : 'text-zinc-500'}`}
                        style={{ textShadow }}
                      >
                        <svg
                          aria-hidden
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          className="shrink-0"
                        >
                          <defs>
                            <linearGradient id={`player-icon-${g.slug}`} x1="0" y1="0" x2="0" y2="1" gradientTransform="rotate(20)">
                              <stop offset="0%" stopColor="#debc6e" />
                              <stop offset="100%" stopColor="#8c6825" />
                            </linearGradient>
                          </defs>
                          <path
                            fill={`url(#player-icon-${g.slug})`}
                            d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.42 0-8 2.69-8 6v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-3.31-3.58-6-8-6Z"
                          />
                        </svg>
                        {playersBySlug[g.slug].toLocaleString('en-US')} playing
                      </p>
                    </div>
                  </div>
                );

                return g.live ? (
                  <Link
                    key={g.slug}
                    href={`/${g.slug}`}
                    className="group w-[160px] lg:w-auto aspect-[9/16] lg:h-full shrink-0 border border-amber-400/25 rounded-xl bg-[#1a1a1a] hover:border-amber-300/60 transition-colors overflow-hidden"
                  >
                    {cardContent}
                  </Link>
                ) : (
                  <div
                    key={g.slug}
                    className="w-[160px] lg:w-auto aspect-[9/16] lg:h-full shrink-0 border border-zinc-800 rounded-xl bg-[#1a1a1a] overflow-hidden cursor-not-allowed"
                  >
                    {cardContent}
                  </div>
                );
              })}
            </div>
            </div>

            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollByCards('left')}
              className={`absolute left-1 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-9 h-9 rounded-full bg-black/70 backdrop-blur border border-amber-400/30 text-amber-100 hover:bg-black/85 transition-opacity ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollByCards('right')}
              className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 grid place-items-center w-9 h-9 rounded-full bg-black/70 backdrop-blur border border-amber-400/30 text-amber-100 hover:bg-black/85 transition-opacity ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
              
          <div className="hidden lg:contents">
            <LiveFeed />
          </div>
              
        </div>
      </section>
    </div>

    <div className="px-4 md:px-6 pb-4 md:pb-6 pt-2">
      <section className="border border-amber-400/20 rounded-2xl bg-[#161616] p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {featurePills.map((feature) => (
            <div key={feature.title} className="rounded-lg border border-amber-400/20 bg-[#1a1a1a] px-3 py-2.5">
              <p className="text-xs md:text-sm font-semibold text-zinc-100">{feature.title}</p>
              <p className="text-[11px] text-zinc-400">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
    </>
  );
}