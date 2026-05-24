'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAccount } from 'wagmi';
import { WalletButton } from '@/components/WalletButton';

const games = [
  { slug: 'crash',   name: 'Crash',       image: '/images/crash.webp',  description: 'Multiplayer crash rounds with instant cashout.',    mode: 'Arcade',       live: true  },
  { slug: 'flip',    name: 'Flip',        image: '/images/flip.webp',   description: 'Heads or tails, fast 50/50 payout.',                mode: 'Classic',      live: true  },
  { slug: 'rps',     name: 'RPS',         image: '/images/rps.webp',    description: 'Rock, paper, scissors against the house.',          mode: 'Classic',      live: true  },
  { slug: 'wheel',   name: 'Wheel',       image: '/images/wheel.webp',  description: 'Spin and land on your target segment.',             mode: 'Strategy',     live: true  },
  { slug: 'penalty', name: 'Penalty',     image: '/images/box.webp',    description: 'Pick your shot and beat the keeper.',               mode: 'Skill',        live: false },
  { slug: 'plinko',  name: 'Plinko',      image: '/images/plinko.webp', description: 'Drop the chip and chase multipliers.',              mode: 'High Variance', live: false },
  { slug: 'boxes',   name: 'Gacha Boxes', image: '/images/boxes.webp',  description: 'Open mystery boxes for instant reveals.',           mode: 'Loot',         live: false },
  { slug: 'slots',   name: 'Slots',       image: '/images/slot.webp',   description: 'Classic slots feel with on-chain results.',         mode: 'Jackpot',      live: false },
];

const recentPlays = [
  '0x9f...2aa won 84 USDC on Crash',
  '0x44ef played Plinko',
  '0xbf7e hit 12x on Wheel',
];

const featurePills = [
  { title: 'Provably Fair', text: 'Verifiable and transparent' },
  { title: 'Instant Settlement', text: 'Payouts in seconds' },
  { title: 'Multichain Access', text: 'Play across leading chains' },
  { title: 'Secure Wallet Login', text: 'Non-custodial and secure' },
];

export default function Home() {
  const { address } = useAccount();

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1220px] mx-auto">
      {/* Hero */}
      <section className="relative overflow-hidden border border-amber-400/30 rounded-2xl h-[215px] md:h-[250px] shadow-[0_0_0_1px_rgba(251,191,36,0.1)]">
        <Image
          src="/hero.webp"
          alt="Hero illustration"
          fill
          sizes="100vw"
          className="object-cover object-center"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#111111] via-[#111111]/80 to-transparent" />
        <div className="relative h-full p-5 md:p-7 flex items-center">
          <div className="max-w-xl">
            <p className="text-[10px] md:text-xs font-bold text-amber-200/80 tracking-widest mb-2">WILDCARD ORIGINALS</p>
            <h1 className="text-2xl md:text-[44px] font-black text-zinc-100 leading-tight mb-2">
              PLAY ON-CHAIN.
              <br />
              WIN <span className="text-amber-300">INSTANTLY.</span>
            </h1>
            <p className="text-xs md:text-sm text-zinc-300 mb-4 max-w-md">
              Multichain games with wallet-based access, transparent prize pools, and fast settlement.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {!address && <WalletButton />}
              <Link
                href="/crash"
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-amber-400/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25 transition-colors"
              >
                Explore Games
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Games Row + Right Panel */}
      <section className="border border-amber-400/25 rounded-2xl bg-[#161616] p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold text-amber-200/80 tracking-widest">GAMES</h2>
          <button className="px-3 py-1.5 text-xs font-medium border border-amber-400/30 rounded-lg bg-[#1e1e1e] text-amber-100 hover:bg-[#222222] transition-colors">
            View all
          </button>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_180px] gap-4 items-start">
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {games.map((g) => {
                const cardContent = (
                  <>
                    <div className="relative w-full aspect-square">
                      <Image
                        src={g.image}
                        alt={g.name}
                        fill
                        sizes="140px"
                        className={`object-cover transition-transform ${g.live ? 'group-hover:scale-[1.03]' : 'opacity-40 grayscale'}`}
                      />
                      {!g.live && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] font-bold tracking-widest text-zinc-300 bg-black/60 px-2 py-1 rounded">
                            SOON
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <h3 className={`font-bold text-xs md:text-sm uppercase tracking-wide ${g.live ? 'text-zinc-100' : 'text-zinc-500'}`}>{g.name}</h3>
                      <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{g.description}</p>
                      <span className={`inline-flex mt-1.5 text-[10px] font-medium border rounded px-1.5 py-0.5 ${g.live ? 'text-amber-200 border-amber-400/35 bg-amber-500/10' : 'text-zinc-600 border-zinc-700 bg-zinc-800/40'}`}>
                        {g.mode}
                      </span>
                    </div>
                  </>
                );

                return g.live ? (
                  <Link
                    key={g.slug}
                    href={`/${g.slug}`}
                    className="group w-[128px] md:w-[140px] border border-amber-400/25 rounded-lg bg-[#1a1a1a] hover:border-amber-300/60 transition-colors overflow-hidden"
                  >
                    {cardContent}
                  </Link>
                ) : (
                  <div
                    key={g.slug}
                    className="w-[128px] md:w-[140px] border border-zinc-800 rounded-lg bg-[#1a1a1a] overflow-hidden cursor-not-allowed"
                  >
                    {cardContent}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="border border-amber-400/25 rounded-lg bg-[#1a1a1a] p-2.5 space-y-2">
            <p className="text-[10px] font-bold tracking-widest text-amber-200/80 px-1">RECENT PLAYS</p>
            <div className="space-y-1.5">
              {recentPlays.map((play) => (
                <div key={play} className="text-[11px] text-zinc-300 bg-[#111111] border border-amber-500/20 rounded-md px-2 py-1.5">
                  {play}
                </div>
              ))}
            </div>
            <div className="relative w-full aspect-square rounded-md overflow-hidden border border-amber-400/25">
              <Image src="/images/boxes.webp" alt="Promo box game" fill sizes="180px" className="object-cover" />
            </div>
          </aside>
        </div>
      </section>

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
  );
}