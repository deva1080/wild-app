'use client';

import { useCallback, useMemo } from 'react';
import { Address, Hex, formatUnits, parseUnits } from 'viem';
import { useAccount } from 'wagmi';
import { usePlayerState } from './usePlayerState';
import { useGamePlay } from './useGamePlay';
import { useDelegatedPlay } from './useDelegatedPlay';
import { usePreflightCheck } from './usePreflightCheck';
import { useTxMode } from '../context/TxModeContext';
import { useBetTokenContext } from '../context/BetTokenContext';
import { useReferralContext } from '../context/ReferralContext';
import { useTxActivity } from '../context/TxActivityContext';
import { PAYMENT_METHODS } from '../constants/tokens';

/** Subset of the useGameResultFlow API the controller drives. */
interface ResultFlow {
  startPlacing: (delegated?: boolean) => void;
  betPlaced: (betId: bigint, gameAddress: Address) => void;
  waitForSettleTx: (txHash: Hex, gameAddress?: Address) => Promise<void>;
  waitForDelegatedTx: (txHash: Hex) => Promise<void>;
}

function safeParseUnits(value: string, decimals: number): bigint {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return 0n;
  }
}

/**
 * Shared bet flow for all games. Handles the selected payment method
 * (WILD / USDC / Credits), decimal-aware parsing, balance clamping and the
 * standard / credits / delegated execution paths.
 */
export function useBetController(gameAddress: Address) {
  const { address } = useAccount();
  const { balanceForMethod } = usePlayerState();
  const { playStandard, playWithCredits, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const { mode: txMode } = useTxMode();
  const { method, setMethod } = useBetTokenContext();
  const { referrerAddress } = useReferralContext();
  const { beginTx, endTx } = useTxActivity();

  const meta = PAYMENT_METHODS[method];
  const balanceWei = balanceForMethod(method);
  const decimals = meta.decimals;

  const formattedBalance = useMemo(() => {
    if (balanceWei === undefined) return '0.00';
    return Number(formatUnits(balanceWei, decimals)).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  }, [balanceWei, decimals]);

  /** Balance as a plain numeric string for the MAX chip / clamping. */
  const maxAmount = useMemo(() => {
    if (balanceWei === undefined || balanceWei === 0n) return '0';
    return Number(formatUnits(balanceWei, decimals)).toFixed(2);
  }, [balanceWei, decimals]);

  /**
   * Execute a bet. Throws on validation/contract errors so the calling page
   * can route the message through its result flow and clean up animations.
   */
  const play = useCallback(
    async (
      gameChoice: Hex,
      amountStr: string,
      result: ResultFlow,
      onClamp?: (clampedDisplay: string) => void,
    ) => {
      if (!address) throw new Error('Wallet no conectada');

      const desired = safeParseUnits(amountStr, decimals);
      if (desired <= 0n) throw new Error('Ingresá un monto de apuesta válido.');

      // Point 6: never let the bet exceed the available balance — clamp to max.
      let weiAmount = desired;
      if (balanceWei !== undefined && desired > balanceWei) {
        weiAmount = balanceWei;
        if (onClamp) onClamp(maxAmount);
      }

      if (weiAmount <= 0n) {
        throw new Error(
          meta.useCredits
            ? 'No tenés Game Credits. Convertí WILD o USDC en tu cuenta.'
            : `No tenés saldo de ${meta.symbol}. Depositá o cambiá de token.`,
        );
      }

      const token: Address = meta.address;
      const useCredits = meta.useCredits;

      beginTx();
      try {
        if (txMode !== 'delegated') {
          const issues = await check(gameAddress, weiAmount, {
            token,
            decimals,
            symbol: meta.symbol,
            useCredits,
          });
          const errors = issues.filter((i) => i.level === 'error');
          if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('\n'));
        }

        if (txMode === 'delegated') {
          result.startPlacing(true);
          if (!authorizedPlays || authorizedPlays === 0n) {
            await setupDelegatedPlay(100n, useCredits ? null : token);
          }
          const { txHash } = await requestDelegatedPlay(
            gameAddress,
            address,
            token,
            weiAmount,
            gameChoice,
            useCredits,
            referrerAddress,
          );
          await result.waitForDelegatedTx(txHash);
        } else if (useCredits) {
          result.startPlacing();
          const playResult = await playWithCredits(gameAddress, gameChoice, weiAmount, referrerAddress);
          result.betPlaced(playResult.betId, playResult.gameAddress);
          const settleTxHash = await requestSettle(playResult.gameAddress, playResult.betId);
          await result.waitForSettleTx(settleTxHash);
        } else {
          result.startPlacing();
          const playResult = await playStandard(gameAddress, gameChoice, weiAmount, token, referrerAddress);
          result.betPlaced(playResult.betId, playResult.gameAddress);
          const settleTxHash = await requestSettle(playResult.gameAddress, playResult.betId);
          await result.waitForSettleTx(settleTxHash);
        }
      } finally {
        endTx();
      }
    },
    [
      address,
      decimals,
      balanceWei,
      maxAmount,
      meta,
      txMode,
      authorizedPlays,
      setupDelegatedPlay,
      requestDelegatedPlay,
      playWithCredits,
      playStandard,
      requestSettle,
      check,
      gameAddress,
      referrerAddress,
      beginTx,
      endTx,
    ],
  );

  return {
    method,
    setMethod,
    meta,
    decimals,
    balanceWei,
    formattedBalance,
    maxAmount,
    play,
  };
}
