'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Address, Hex, formatEther, decodeEventLog } from 'viem';
import { usePublicClient, useAccount } from 'wagmi';
import { abis } from '@/lib/web3/constants/abis';
import { useGamePlay } from '@/lib/web3/hooks/useGamePlay';
import { useBetSettledListener, BetSettledEvent } from '@/lib/web3/hooks/useBetSettledListener';

const RESULT_RECEIPT_CONFIRMATIONS = 2;
const RESULT_RECEIPT_REFETCH_DELAY_MS = 1500;

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
    { name: 'crash', abi: abis.crash },
    { name: 'flip', abi: abis.flip },
    { name: 'wheel', abi: abis.wheel },
    { name: 'rps', abi: abis.rps },
  ];
  let bestResult: DecodedResult | null = null;
  let wheelRollResult: DecodedResult | null = null;
  
  console.log('[DecodeLogs] Total logs:', logs.length, 'Player filter:', playerAddress);
  
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    for (const { name: abiName, abi } of gameAbis) {
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
          
          console.log(`[DecodeLogs] Found BetSettled at log[${i}] using ${abiName} ABI:`, {
            betId: eventBetId.toString(),
            player: eventPlayer,
            token: args.token,
            payout: ((args.payout as bigint) ?? BigInt(0)).toString(),
            totalBet: ((args.totalBetAmount as bigint) ?? BigInt(0)).toString(),
            outcomes: ((args.outcomes as bigint[]) ?? []).map(o => o.toString()),
            rawTopics: log.topics,
            rawData: log.data,
          });
          
          // Filter by player address if provided
          if (playerAddress && eventPlayer.toLowerCase() !== playerAddress.toLowerCase()) {
            console.log(`[DecodeLogs] Skipping - player mismatch`);
            continue;
          }
          
          // Take the event with the highest betId (most recent bet)
          if (!bestResult || eventBetId > bestResult.betId) {
            bestResult = {
              betId: eventBetId,
              payout: (args.payout as bigint) ?? BigInt(0),
              totalBet: (args.totalBetAmount as bigint) ?? BigInt(0),
              outcomes: [...((args.outcomes as bigint[]) ?? [])],
            };
            console.log(`[DecodeLogs] New best result with betId:`, eventBetId.toString());
          }
          // Found BetSettled for this log, no need to try other ABIs
          break;
        }
      } catch {
        // not a BetSettled log with this ABI
      }
    }

    try {
      const decodedRoll = decodeEventLog({
        abi: abis.wheel,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });

      if (decodedRoll.eventName === 'Roll') {
        const args = decodedRoll.args as unknown as Record<string, unknown>;
        const receiver = args.receiver as Address;
        const betId = (args.id as bigint) ?? BigInt(0);

        if (!playerAddress || receiver.toLowerCase() === playerAddress.toLowerCase()) {
          const rolled = ((args.rolled as Array<bigint | number>) ?? []).map((outcome) => BigInt(outcome));
          const rollResult = {
            betId,
            payout: (args.payout as bigint) ?? BigInt(0),
            totalBet: (args.totalBetAmount as bigint) ?? BigInt(0),
            outcomes: rolled,
          };

          console.log(`[DecodeLogs] Found Wheel Roll at log[${i}]:`, {
            betId: rollResult.betId.toString(),
            receiver,
            payout: rollResult.payout.toString(),
            totalBet: rollResult.totalBet.toString(),
            outcomes: rollResult.outcomes.map(o => o.toString()),
            rawTopics: log.topics,
            rawData: log.data,
          });

          if (!wheelRollResult || rollResult.betId > wheelRollResult.betId) {
            wheelRollResult = rollResult;
          }
        }
      }
    } catch {
      // not a Wheel Roll log
    }
  }

  if (bestResult && wheelRollResult && bestResult.betId === wheelRollResult.betId) {
    const sameOutcomes =
      bestResult.outcomes.length === wheelRollResult.outcomes.length &&
      bestResult.outcomes.every((outcome, index) => outcome === wheelRollResult.outcomes[index]);
    const sameResult =
      bestResult.payout === wheelRollResult.payout &&
      bestResult.totalBet === wheelRollResult.totalBet &&
      sameOutcomes;

    if (!sameResult) {
      console.warn('[DecodeLogs] BetSettled / Wheel Roll mismatch. Using Wheel Roll result.', {
        betSettled: {
          betId: bestResult.betId.toString(),
          payout: bestResult.payout.toString(),
          totalBet: bestResult.totalBet.toString(),
          outcomes: bestResult.outcomes.map(o => o.toString()),
        },
        roll: {
          betId: wheelRollResult.betId.toString(),
          payout: wheelRollResult.payout.toString(),
          totalBet: wheelRollResult.totalBet.toString(),
          outcomes: wheelRollResult.outcomes.map(o => o.toString()),
        },
      });

      return {
        payout: wheelRollResult.payout,
        totalBet: wheelRollResult.totalBet,
        outcomes: wheelRollResult.outcomes,
      };
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

  const startPlacing = useCallback(() => {
    resolvedRef.current = false;
    activeBetIdRef.current = null;
    isDelegatedModeRef.current = false;
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
    setState({ phase: 'error', message });
  }, []);

  const close = useCallback(() => {
    resolvedRef.current = false;
    activeBetIdRef.current = null;
    isDelegatedModeRef.current = false;
    setState(null);
  }, []);

  const waitForStableReceipt = async (txHash: Hex) => {
    const initialReceipt = await publicClient!.waitForTransactionReceipt({
      hash: txHash,
      confirmations: RESULT_RECEIPT_CONFIRMATIONS,
    });

    // Base RPCs can briefly serve unsafe receipts. Re-read after confirmations
    // so the decoded event matches the canonical receipt shown by BaseScan.
    await new Promise((resolve) => setTimeout(resolve, RESULT_RECEIPT_REFETCH_DELAY_MS));

    return publicClient!.getTransactionReceipt({ hash: txHash }).catch(() => initialReceipt);
  };

  // --- WSS listener: resolves the moment the on-chain event is seen ---
  // Only used for standard/credits mode where we know the betId.
  // In delegated mode, we rely solely on the tx receipt to avoid race conditions.
  const handleWssSettled = useCallback((event: BetSettledEvent) => {
    if (resolvedRef.current) return;
    
    // In delegated mode, ignore WSS events - use only the tx receipt
    if (isDelegatedModeRef.current) return;

    const currentBetId = activeBetIdRef.current;
    // Only accept if we have a known betId and it matches
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
      setState({ phase: 'error', message: msg });
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
   * Wait for a delegated play tx (1-tx mode) to be mined and decode BetSettled.
   * In delegated mode, we ONLY use the tx receipt to avoid race conditions with
   * the WSS listener potentially capturing unrelated BetSettled events.
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

      console.log('[Delegated Debug] Processing receipt for txHash:', txHash, 'logs count:', receipt.logs.length);
      const result = decodeBetSettledFromLogs(receipt.logs as { data: Hex; topics: Hex[] }[], address);
      console.log('[Delegated Debug] Final result for player', address, ':', result ? {
        payout: result.payout.toString(),
        totalBet: result.totalBet.toString(),
        outcomes: result.outcomes.map(o => o.toString()),
      } : null);
      
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
