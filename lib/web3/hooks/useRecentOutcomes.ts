'use client';

import { useEffect, useState } from 'react';
import { createPublicClient, webSocket, http, Address, Hex, decodeEventLog, PublicClient } from 'viem';
import { base } from 'viem/chains';
import { abis } from '../constants/abis';

const WSS_URL = 'wss://base-rpc.publicnode.com';
const SEED_BLOCK_RANGE = 10_000n; // look back further to ensure we find 10 outcomes

export function useRecentOutcomes(gameAddress: Address, maxItems = 10) {
  const [outcomes, setOutcomes] = useState<number[]>([]);

  useEffect(() => {
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

    let isMounted = true;

    // 1. Seed with historical events
    (async () => {
      try {
        const head = await client.getBlockNumber();
        const fromBlock = head > SEED_BLOCK_RANGE ? head - SEED_BLOCK_RANGE : 0n;

        const logs = await client.getContractEvents({
          address: gameAddress,
          abi: abis.crash as readonly unknown[],
          eventName: 'BetSettled',
          fromBlock,
        });

        if (!isMounted) return;

        // Process from newest to oldest
        const recentOutcomes: number[] = [];
        for (let i = logs.length - 1; i >= 0; i--) {
          const log = logs[i] as unknown as { data: Hex; topics: readonly Hex[] };
          try {
            const decoded = decodeEventLog({
              abi: abis.crash,
              data: log.data,
              topics: log.topics as [Hex, ...Hex[]],
            });
            if (decoded.eventName !== 'BetSettled') continue;
            const args = decoded.args as unknown as Record<string, unknown>;
            const eventOutcomes = (args.outcomes as bigint[]) || [];
            
            // Add outcomes in reverse order (last roll of the bet first)
            for (let j = eventOutcomes.length - 1; j >= 0; j--) {
              recentOutcomes.push(Number(eventOutcomes[j]));
              if (recentOutcomes.length >= maxItems) break;
            }
          } catch {
            // ignore malformed logs
          }
          if (recentOutcomes.length >= maxItems) break;
        }

        setOutcomes(recentOutcomes);
      } catch (err) {
        console.error('Failed to fetch historical outcomes:', err);
      }
    })();

    // 2. Watch for real-time events
    const unwatch = client.watchContractEvent({
      address: gameAddress,
      abi: abis.crash,
      eventName: 'BetSettled',
      onLogs: (logs) => {
        setOutcomes((prev) => {
          const newOutcomes: number[] = [];
          for (const log of logs) {
            try {
              const decoded = decodeEventLog({
                abi: abis.crash,
                data: (log as unknown as { data: Hex }).data,
                topics: (log as unknown as { topics: readonly Hex[] }).topics as [Hex, ...Hex[]],
              });
              if (decoded.eventName !== 'BetSettled') continue;
              const args = decoded.args as unknown as Record<string, unknown>;
              const eventOutcomes = (args.outcomes as bigint[]) || [];
              
              // Newest rolls go to the front
              for (let i = eventOutcomes.length - 1; i >= 0; i--) {
                newOutcomes.push(Number(eventOutcomes[i]));
              }
            } catch {
              // ignore
            }
          }
          if (newOutcomes.length === 0) return prev;
          return [...newOutcomes, ...prev].slice(0, maxItems);
        });
      },
    });

    return () => {
      isMounted = false;
      try { unwatch(); } catch { /* cleanup */ }
    };
  }, [gameAddress, maxItems]);

  return outcomes;
}