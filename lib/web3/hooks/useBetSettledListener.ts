'use client';

import { useEffect, useRef } from 'react';
import { createPublicClient, webSocket, http, Address, Hex, decodeEventLog, PublicClient } from 'viem';
import { base } from 'viem/chains';
import { abis } from '../constants/abis';
import { addresses } from '../constants/addresses';

export type BetSettledEvent = {
  betId: bigint;
  player: Address;
  payout: bigint;
  totalBet: bigint;
  outcomes: bigint[];
};

const WSS_URL = 'wss://base-rpc.publicnode.com';

const GAME_CONFIGS: { address: Address; abi: readonly unknown[] }[] = [
  { address: addresses.games.crash, abi: abis.crash as readonly unknown[] },
  { address: addresses.games.flip, abi: abis.flip as readonly unknown[] },
  { address: addresses.games.rps, abi: abis.rps as readonly unknown[] },
  { address: addresses.games.wheel, abi: abis.wheel as readonly unknown[] },
];

/**
 * Listens for BetSettled events across all game contracts via WebSocket.
 *
 * When a BetSettled log arrives for the specified `playerAddress`, the
 * `onSettled` callback fires with the decoded event data. If WSS fails,
 * falls back to HTTP polling via wagmi's default transport.
 *
 * The hook automatically cleans up subscriptions on unmount or when
 * dependencies change.
 */
export function useBetSettledListener(
  playerAddress: Address | undefined,
  onSettled: (event: BetSettledEvent) => void
) {
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const activeRef = useRef(true);

  useEffect(() => {
    if (!playerAddress) return;
    activeRef.current = true;

    const player = playerAddress;
    const unwatchers: (() => void)[] = [];

    const gameAbis = [abis.crash, abis.flip, abis.wheel, abis.rps];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleLogs(logs: any[]) {
      if (!activeRef.current) return;

      for (const log of logs) {
        for (const abi of gameAbis) {
          try {
            const decoded = decodeEventLog({
              abi,
              data: log.data as Hex,
              topics: log.topics as [Hex, ...Hex[]],
            });

            if (decoded.eventName !== 'BetSettled') continue;

            const args = decoded.args as unknown as Record<string, unknown>;
            const eventPlayer = args.player as Address;

            if (eventPlayer.toLowerCase() !== player.toLowerCase()) continue;

            onSettledRef.current({
              betId: (args.betId as bigint) ?? BigInt(0),
              player: eventPlayer,
              payout: (args.payout as bigint) ?? BigInt(0),
              totalBet: (args.totalBetAmount as bigint) ?? BigInt(0),
              outcomes: [...((args.outcomes as bigint[]) ?? [])],
            });
            return; // Found and processed, exit
          } catch {
            // not a BetSettled log with this ABI, try next
          }
        }
      }
    }

    let client: PublicClient;

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

    for (const gameConfig of GAME_CONFIGS) {
      const unwatch = client.watchContractEvent({
        address: gameConfig.address,
        abi: gameConfig.abi,
        eventName: 'BetSettled',
        onLogs: handleLogs,
      });
      unwatchers.push(unwatch);
    }

    return () => {
      activeRef.current = false;
      for (const unwatch of unwatchers) {
        try { unwatch(); } catch { /* cleanup */ }
      }
    };
  }, [playerAddress]);
}
