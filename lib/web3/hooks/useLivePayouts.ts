'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPublicClient, webSocket, http, Address, Hex, decodeEventLog, formatEther, PublicClient } from 'viem';
import { base } from 'viem/chains';
import { abis } from '../constants/abis';
import { addresses } from '../constants/addresses';

const WSS_URL = 'wss://base-rpc.publicnode.com';
const MAX_FEED_SIZE = 50;
const SEED_BLOCK_RANGE = 5_000n;

export interface LivePayoutEntry {
  id: string;
  player: Address;
  game: Address;
  currency: Address;
  gameIdentifier: bigint;
  payout: bigint;
  payoutFormatted: string;
  isWin: boolean;
  timestamp: number;
  gameName: string;
}

const GAME_NAMES: Record<string, string> = {
  [addresses.games.crash.toLowerCase()]: 'Crash',
  [addresses.games.flip.toLowerCase()]: 'Flip',
  [addresses.games.rps.toLowerCase()]: 'RPS',
  [addresses.games.wheel.toLowerCase()]: 'Wheel',
};

const GAME_ADDRESSES: Address[] = [
  addresses.games.crash,
  addresses.games.flip,
  addresses.games.rps,
  addresses.games.wheel,
];

function decodeLivePayoutLog(log: { data: Hex; topics: readonly Hex[] }): LivePayoutEntry | null {
  try {
    const decoded = decodeEventLog({
      abi: abis.crash,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== 'LivePayout') return null;

    const args = decoded.args as unknown as Record<string, unknown>;
    const player = args.player as Address;
    const game = args.game as Address;
    const currency = args.currency as Address;
    const gameIdentifier = (args.gameIdentifier as bigint) ?? 0n;
    const payout = (args.payout as bigint) ?? 0n;

    return {
      id: '',
      player,
      game,
      currency,
      gameIdentifier,
      payout,
      payoutFormatted: formatEther(payout),
      isWin: payout > 0n,
      timestamp: Date.now(),
      gameName: GAME_NAMES[game.toLowerCase()] ?? 'Unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Listens for LivePayout events across all game contracts.
 * Seeds the feed with recent historical events on mount, then watches real-time.
 */
export function useLivePayouts() {
  const [feed, setFeed] = useState<LivePayoutEntry[]>([]);

  useEffect(() => {
    let client: PublicClient;
    const unwatchers: (() => void)[] = [];

    try {
      client = createPublicClient({
        chain: base,
        transport: webSocket(WSS_URL, { retryCount: 3 }),
      }) as PublicClient;
    } catch {
      client = createPublicClient({
        chain: base,
        transport: http(),
      }) as PublicClient;
    }

    // Seed with recent historical events
    (async () => {
      try {
        const head = await client.getBlockNumber();
        const fromBlock = head > SEED_BLOCK_RANGE ? head - SEED_BLOCK_RANGE : 0n;
        const now = Date.now();
        const historical: LivePayoutEntry[] = [];

        for (const gameAddress of GAME_ADDRESSES) {
          try {
            const logs = await client.getContractEvents({
              address: gameAddress,
              abi: abis.crash as readonly unknown[],
              eventName: 'LivePayout',
              fromBlock,
            });

            for (const log of logs) {
              const entry = decodeLivePayoutLog(log as unknown as { data: Hex; topics: readonly Hex[] });
              if (!entry) continue;
              const blockDiff = Number(head - ((log as unknown as { blockNumber: bigint }).blockNumber ?? head));
              entry.timestamp = now - blockDiff * 2_000;
              entry.id = `${(log as unknown as { transactionHash: string }).transactionHash}-${(log as unknown as { logIndex: number }).logIndex}`;
              historical.push(entry);
            }
          } catch { /* skip game */ }
        }

        historical.sort((a, b) => b.timestamp - a.timestamp);

        setFeed((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const fresh = historical.filter((e) => !ids.has(e.id));
          return [...prev, ...fresh].slice(0, MAX_FEED_SIZE);
        });
      } catch { /* seed failed, real-time still works */ }
    })();

    // Watch real-time events
    for (const gameAddress of GAME_ADDRESSES) {
      const unwatch = client.watchContractEvent({
        address: gameAddress,
        abi: abis.crash,
        eventName: 'LivePayout',
        onLogs: (logs) => {
          const entries: LivePayoutEntry[] = [];
          for (const log of logs) {
            const entry = decodeLivePayoutLog(log as unknown as { data: Hex; topics: readonly Hex[] });
            if (!entry) continue;
            entry.id = `${(log as unknown as { transactionHash: string }).transactionHash}-${(log as unknown as { logIndex: number }).logIndex}`;
            entries.push(entry);
          }
          if (entries.length > 0) {
            setFeed((prev) => {
              const ids = new Set(prev.map((e) => e.id));
              const fresh = entries.filter((e) => !ids.has(e.id));
              return [...fresh, ...prev].slice(0, MAX_FEED_SIZE);
            });
          }
        },
      });
      unwatchers.push(unwatch);
    }

    return () => {
      for (const unwatch of unwatchers) {
        try { unwatch(); } catch { /* cleanup */ }
      }
    };
  }, []);

  const clearFeed = useCallback(() => setFeed([]), []);

  return { feed, clearFeed };
}
