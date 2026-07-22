'use client';

import { useCallback, useMemo, useState } from 'react';
import { Address, Hex, erc20Abi, formatUnits, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { useWriteContractBase } from './useWriteContractBase';
import { usePlayerState } from './usePlayerState';
import { useGamePlay } from './useGamePlay';
import { useDelegatedPlay } from './useDelegatedPlay';
import { usePreflightCheck } from './usePreflightCheck';
import { useTxMode } from '../context/TxModeContext';
import { useBetTokenContext } from '../context/BetTokenContext';
import { useReferralContext } from '../context/ReferralContext';
import { useTxActivity } from '../context/TxActivityContext';
import { PAYMENT_METHODS } from '../constants/tokens';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

/** Subset of the useGameResultFlow API the controller drives. */
interface ResultFlow {
  startPlacing: (delegated?: boolean) => void;
  betPlaced: (betId: bigint, gameAddress: Address) => void;
  settled: (payout: bigint, totalBet: bigint, outcomes: bigint[]) => void;
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

function createPreviewSeed(): bigint {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

/**
 * Shared bet flow for all games. Handles the selected payment method
 * (WILD / USDC / Credits), decimal-aware parsing, balance clamping and the
 * standard / credits / delegated execution paths.
 */
export function useBetController(gameAddress: Address) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContractBase();
  const { balanceForMethod } = usePlayerState();
  const { playStandard, playWithCredits, requestSettle, requestDelegatedPlay } = useGamePlay();
  const { authorizedPlays, setupDelegatedPlay } = useDelegatedPlay();
  const { check } = usePreflightCheck();
  const { mode: txMode } = useTxMode();
  const { method, setMethod, funBalance, settleFunBet } = useBetTokenContext();
  const { referrerAddress } = useReferralContext();
  const { beginTx, endTx } = useTxActivity();

  const meta = PAYMENT_METHODS[method];
  const balanceWei = meta.isFun ? funBalance : balanceForMethod(method);
  const decimals = meta.decimals;
  const [isApproving, setIsApproving] = useState(false);
  const approvalEnabled = !!address && !meta.useCredits && !meta.isFun;
  const approvalAmount = parseUnits('10000', decimals);
  const approvalThreshold = parseUnits('100', decimals);
  const { data: allowance, isLoading: allowanceLoading, refetch: refetchAllowance } = useReadContract({
    address: meta.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, addresses.gameRouter] : undefined,
    query: { enabled: approvalEnabled },
  });
  const needsApproval =
    approvalEnabled && (allowance === undefined || allowance < approvalThreshold);

  const approveSelectedToken = useCallback(async () => {
    if (!approvalEnabled || !publicClient) return;
    setIsApproving(true);
    beginTx();
    try {
      const hash = await writeContractAsync({
        address: meta.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.gameRouter, approvalAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refetchAllowance();
    } finally {
      endTx();
      setIsApproving(false);
    }
  }, [
    approvalEnabled,
    publicClient,
    writeContractAsync,
    meta.address,
    approvalAmount,
    refetchAllowance,
    beginTx,
    endTx,
  ]);

  const formattedBalance = useMemo(() => {
    if (balanceWei === undefined) return '0.00';
    return Number(formatUnits(balanceWei, decimals)).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  }, [balanceWei, decimals]);

  /** Hard cap on the MAX chip, independent of the user's actual balance. */
  const MAX_CHIP_CAP = 100;

  /** Balance as a plain numeric string for the MAX chip / clamping. */
  const maxAmount = useMemo(() => {
    if (balanceWei === undefined || balanceWei === 0n) return '0';
    const balance = Number(formatUnits(balanceWei, decimals));
    return Math.min(balance, MAX_CHIP_CAP).toFixed(2);
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
      if (!address && !meta.isFun) throw new Error('Wallet no conectada');

      const desired = safeParseUnits(amountStr, decimals);
      if (desired <= 0n) throw new Error('Ingresá un monto de apuesta válido.');

      // Point 6: never let the bet exceed the available balance — clamp to max.
      let weiAmount = desired;
      if (balanceWei !== undefined && desired > balanceWei) {
        weiAmount = balanceWei;
        if (onClamp) onClamp(Number(formatUnits(weiAmount, decimals)).toFixed(2));
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

      if (meta.isFun) {
        if (!publicClient) throw new Error('Public client not available');
        result.startPlacing();
        const previewPromise = publicClient.readContract({
          address: addresses.gameRouter,
          abi: abis.router,
          functionName: 'previewGame',
          args: [
            gameAddress,
            gameChoice,
            addresses.wildToken,
            weiAmount,
            createPreviewSeed(),
            false,
          ],
        });
        const [previewData] = await Promise.all([
          previewPromise,
          new Promise((resolve) => setTimeout(resolve, 700)),
        ]);
        const [payout, outcomes] = previewData as [bigint, readonly bigint[]];
        settleFunBet(weiAmount, payout);
        result.settled(payout, weiAmount, [...outcomes]);
        return;
      }

      if (allowance === undefined || allowance < weiAmount) {
        throw new Error(`Primero aprobá ${meta.symbol} para jugar.`);
      }

      beginTx();
      try {
        if (!address) throw new Error('Wallet no conectada');

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
            await setupDelegatedPlay(100n);
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
      publicClient,
      decimals,
      balanceWei,
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
      settleFunBet,
      allowance,
    ],
  );

  const actionLabel = (defaultLabel: string) => {
    if (isApproving) return 'APPROVING…';
    if (needsApproval) return 'APPROVE GAME';
    if (meta.isFun) return 'FUN PLAY';
    return defaultLabel;
  };

  return {
    method,
    setMethod,
    meta,
    decimals,
    balanceWei,
    formattedBalance,
    maxAmount,
    needsApproval,
    allowanceLoading,
    isApproving,
    approveSelectedToken,
    actionLabel,
    play,
  };
}
