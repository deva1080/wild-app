'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Address, Hex, formatEther, decodeEventLog } from 'viem';
import { usePublicClient, useAccount } from 'wagmi';
import { abis } from '@/lib/web3/constants/abis';
import { useGamePlay } from '@/lib/web3/hooks/useGamePlay';
import { useBetSettledListener, BetSettledEvent } from '@/lib/web3/hooks/useBetSettledListener';

const RESULT_RECEIPT_CONFIRMATIONS = 1;

export type GameResultState =
  | { phase: 'placing' }
  | { phase: 'waiting-settle'; betId: bigint; gameAddress: Address }
  | { phase: 'settling'; settleTxHash: Hex; betId?: bigint }
  | { phase: 'result'; payout: bigint; totalBet: bigint; outcomes: bigint[] }
  | { phase: 'stuck'; betId: bigint; gameAddress: Address }
  | { phase: 'error'; message: string };

interface Props {
  state: GameResultState | null;
  onClose: () => void;
  onRetrySettle?: () => void;
}

export function GameResultModal({ state, onClose, onRetrySettle }: Props) {
  if (!state) return null;

  const isWin = state.phase === 'result' && state.payout > BigInt(0);
  const isLoss = state.phase === 'result' && state.payout === BigInt(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d1118] border border-amber-500/20 rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 space-y-4">
        {state.phase === 'placing' && (
          <>
            <div className="flex justify-center">
              <div className="w-10 h-10 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin" />
            </div>
            <p className="text-center text-sm text-zinc-400">Placing bet...</p>
          </>
        )}

        {state.phase === 'waiting-settle' && (
          <>
            <div className="flex justify-center">
              <div className="w-10 h-10 border-4 border-zinc-700 border-t-amber-500 rounded-full animate-spin" />
            </div>
            <p className="text-center text-sm text-zinc-400">Bet placed. Settling...</p>
            <p className="text-center text-xs text-zinc-600">Bet #{state.betId.toString()}</p>
          </>
        )}

        {state.phase === 'settling' && (
          <>
            <div className="flex justify-center">
              <div className="w-10 h-10 border-4 border-zinc-700 border-t-blue-400 rounded-full animate-spin" />
            </div>
            <p className="text-center text-sm text-zinc-400">Resolving... waiting for confirmation</p>
            <p className="text-center text-xs text-zinc-600 font-mono truncate">{state.settleTxHash}</p>
          </>
        )}

        {state.phase === 'result' && (
          <>
            <div className="text-center">
              <div className={`text-5xl font-black ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                {isWin ? 'WIN' : 'LOSS'}
              </div>
            </div>
            {isWin && (
              <div className="text-center">
                <p className="text-2xl font-bold text-green-400">+{parseFloat(formatEther(state.payout)).toFixed(3)} WILD</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Bet: {parseFloat(formatEther(state.totalBet)).toFixed(3)} WILD
                </p>
              </div>
            )}
            {isLoss && (
              <div className="text-center">
                <p className="text-lg text-zinc-400">-{parseFloat(formatEther(state.totalBet)).toFixed(3)} WILD</p>
              </div>
            )}
            {state.outcomes.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center">
                {state.outcomes.map((o, i) => (
                  <span key={i} className="text-xs bg-zinc-800 text-zinc-300 rounded px-2 py-0.5 font-mono">
                    {o.toString()}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-black text-sm font-bold rounded-lg hover:from-amber-400 hover:to-amber-500 transition-all"
            >
              Continue
            </button>
          </>
        )}

        {state.phase === 'stuck' && (
          <>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">Pending</div>
            </div>
            <p className="text-center text-sm text-zinc-400">
              Bet #{state.betId.toString()} was not settled.
            </p>
            <button
              onClick={onRetrySettle}
              className="w-full py-2.5 bg-amber-500 text-black text-sm font-bold rounded-lg hover:bg-amber-400 transition-colors"
            >
              Get Result
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
            >
              Close
            </button>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">Error</div>
            </div>
            <p className="text-center text-sm text-red-400/80 break-all">{state.message}</p>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-zinc-800 text-zinc-100 text-sm font-medium rounded-lg hover:bg-zinc-700 border border-zinc-700 transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Decode BetSettled event from a transaction receipt's logs.
 * Tries multiple game ABIs since they all have the same BetSettled event structure.
 * Filters by player address and takes the event with the HIGHEST betId (most recent bet).
 */
function decodeBetSettledFromLogs(
  logs: { data: Hex; topics: Hex[] }[],
  playerAddress?: Address
): {
  payout: bigint;
  totalBet: bigint;
  outcomes: bigint[];
} | null {
  type DecodedResult = { betId: bigint; payout: bigint; totalBet: bigint; outcomes: bigint[] };

  const gameAbis = [
    abis.crash,
    abis.flip,
    abis.wheel,
    abis.rps,
    abis.hiLo,
    abis.dice,
    abis.keno,
    abis.slot,
    abis.modernSlot,
  ];
  let bestResult: DecodedResult | null = null;

  for (const log of logs) {
    for (const abi of gameAbis) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName === 'BetSettled') {
          const args = decoded.args as unknown as Record<string, unknown>;
          const eventPlayer = args.player as Address;
          const eventBetId = (args.betId as bigint) ?? BigInt(0);

          if (playerAddress && eventPlayer.toLowerCase() !== playerAddress.toLowerCase()) {
            continue;
          }

          if (!bestResult || eventBetId > bestResult.betId) {
            bestResult = {
              betId: eventBetId,
              payout: (args.payout as bigint) ?? BigInt(0),
              totalBet: (args.totalBetAmount as bigint) ?? BigInt(0),
              outcomes: [...((args.outcomes as bigint[]) ?? [])],
            };
          }
          break;
        }
      } catch {
        // not a BetSettled log with this ABI
      }
    }
  }

  if (bestResult) {
    return {
      payout: bestResult.payout,
      totalBet: bestResult.totalBet,
      outcomes: bestResult.outcomes,
    };
  }
  return null;
}

/**
 * Hook to manage the game result modal flow.
 *
 * Resolution strategy (fastest wins):
 * 1. WebSocket `BetSettled` event (typically arrives first)
 * 2. HTTP `waitForTransactionReceipt` fallback (in case WSS is down or slow)
 *
 * Both paths race: whichever delivers the result first wins and the other is
 * ignored via the `resolvedRef` guard.
 */
export function useGameResultFlow() {
  const [state, setState] = useState<GameResultState | null>(null);
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { settlePendingBet } = useGamePlay();

  const resolvedRef = useRef(false);
  const activeBetIdRef = useRef<bigint | null>(null);
  const isDelegatedModeRef = useRef(false);

  const startPlacing = useCallback((delegated = false) => {
    resolvedRef.current = false;
    activeBetIdRef.current = null;
    isDelegatedModeRef.current = delegated;
    setState({ phase: 'placing' });
  }, []);

  const betPlaced = useCallback((betId: bigint, gameAddress: Address) => {
    activeBetIdRef.current = betId;
    setState({ phase: 'waiting-settle', betId, gameAddress });
  }, []);

  const settling = useCallback((settleTxHash: Hex, betId?: bigint) => {
    if (betId !== undefined) activeBetIdRef.current = betId;
    setState({ phase: 'settling', settleTxHash, betId: activeBetIdRef.current ?? undefined });
  }, []);

  const settled = useCallback((payout: bigint, totalBet: bigint, outcomes: bigint[]) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    activeBetIdRef.current = null;
    setState({ phase: 'result', payout, totalBet, outcomes });
  }, []);

  const stuck = useCallback((betId: bigint, gameAddress: Address) => {
    activeBetIdRef.current = betId;
    setState({ phase: 'stuck', betId, gameAddress });
  }, []);

  const error = useCallback((message: string) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    activeBetIdRef.current = null;
    isDelegatedModeRef.current = false;
    setState(null);
    if (typeof window !== 'undefined') alert(message);
  }, []);

  const close = useCallback(() => {
    resolvedRef.current = false;
    activeBetIdRef.current = null;
    isDelegatedModeRef.current = false;
    setState(null);
  }, []);

  const waitForStableReceipt = async (txHash: Hex) => {
    const receipt = await publicClient!.waitForTransactionReceipt({
      hash: txHash,
      confirmations: RESULT_RECEIPT_CONFIRMATIONS,
    });
    return receipt;
  };

  // --- WSS listener: resolves the moment the on-chain event is seen ---
  const handleWssSettled = useCallback((event: BetSettledEvent) => {
    if (resolvedRef.current) return;

    if (isDelegatedModeRef.current) {
      // In delegated mode, we don't know the betId upfront.
      // If we receive a BetSettled for this player while waiting, assume it's ours.
      settled(event.payout, event.totalBet, event.outcomes);
      return;
    }

    const currentBetId = activeBetIdRef.current;
    if (currentBetId === null) return;
    if (event.betId !== currentBetId) return;

    settled(event.payout, event.totalBet, event.outcomes);
  }, [settled]);

  useBetSettledListener(address, handleWssSettled);

  const retrySettle = useCallback(async () => {
    if (!state || state.phase !== 'stuck') return;
    const { gameAddress } = state;
    try {
      resolvedRef.current = false;
      const txHash = await settlePendingBet(gameAddress);
      if (txHash) {
        await waitForSettleTx(txHash as Hex, gameAddress);
      } else {
        close();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      close();
      if (typeof window !== 'undefined') alert(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, settlePendingBet, close]);

  /**
   * Wait for a settle tx to be mined and decode the BetSettled event from it.
   * Acts as a fallback — if the WSS already resolved this bet, this is a no-op.
   */
  const waitForSettleTx = async (txHash: Hex, _gameAddress?: Address) => {
    if (!publicClient) {
      error('Public client not available');
      return;
    }

    settling(txHash);

    try {
      const receipt = await waitForStableReceipt(txHash);

      if (resolvedRef.current) return;

      if (receipt.status === 'reverted') {
        error('La tx de settle fue revertida');
        return;
      }

      const result = decodeBetSettledFromLogs(receipt.logs as { data: Hex; topics: Hex[] }[], address);
      if (result) {
        settled(result.payout, result.totalBet, result.outcomes);
      } else {
        error('No se encontró el evento BetSettled en el receipt');
      }
    } catch (e: unknown) {
      if (resolvedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      error(msg);
    }
  };

  /**
   * Wait for a delegated play tx (1-tx mode).
   * Primary resolution: WSS BetSettled listener (same source as RecentOutcomes).
   * The receipt is only used to detect reverts and as a last-resort fallback.
   */
  const waitForDelegatedTx = async (txHash: Hex) => {
    if (!publicClient) {
      error('Public client not available');
      return;
    }

    isDelegatedModeRef.current = true;
    settling(txHash);

    try {
      const receipt = await waitForStableReceipt(txHash);

      if (resolvedRef.current) return;

      if (receipt.status === 'reverted') {
        error('La tx delegada fue revertida');
        return;
      }

      // WSS listener should resolve shortly — give it up to 8s
      for (let i = 0; i < 16 && !resolvedRef.current; i++) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (resolvedRef.current) return;

      // Last resort: decode from receipt if WSS failed
      const result = decodeBetSettledFromLogs(receipt.logs as { data: Hex; topics: Hex[] }[], address);
      if (result) {
        settled(result.payout, result.totalBet, result.outcomes);
      } else {
        error('No se encontró el evento BetSettled');
      }
    } catch (e: unknown) {
      if (resolvedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      error(msg);
    }
  };

  return {
    state,
    startPlacing,
    betPlaced,
    settling,
    settled,
    stuck,
    error,
    close,
    retrySettle,
    waitForSettleTx,
    waitForDelegatedTx,
  };
}
