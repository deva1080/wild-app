'use client';

import { useAccount, usePublicClient } from 'wagmi';
import { useWriteContractBase } from './useWriteContractBase';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';
import { Address, decodeEventLog, erc20Abi, Hex, maxUint256, ContractFunctionRevertedError, BaseError } from 'viem';

const ERROR_HINTS: Record<string, string> = {
  GameNotLive: 'Fix: game.setGameIsLive(true)',
  TokenNotConfigured: 'Fix: game.setTokenConfig(tokenAddr, minBet, maxBet, houseEdgeBP)',
  InvalidBetCount: 'betCount == 0 en gameChoice',
  BetAmountOutOfRange: 'Fix: revisar game.supportedTokenInfo(token) → min/maxBetAmount',
  CallerNotAllowed: 'Fix: game.setCaller(gameRouterAddr, true)',
  PlayerHasPendingBet: 'El player tiene un betId pendiente sin settle/refund',
  BetNotPending: 'El bet ya fue resuelto o no existe',
  RefundTooEarly: 'Deben pasar 256 bloques desde placeBlockNumber',
  BetDoesNotExist: 'betId inválido, baseBets[betId].amount == 0',
  InsufficientBalance: 'IERC20.balanceOf(contract) < amount',
  NotAuthorizedContract: 'Fix: treasury.authorizeContract(gameRouterAddr, true)',
  TokenNotAccepted: 'Fix: treasury.setAcceptedToken(tokenAddr, true)',
  ZeroAmount: 'amount == 0',
  InvalidRecipient: 'recipient == address(0)',
  GameNotRegistered: 'Fix: gameRouter.registerGame(gameAddr, true)',
  NoAuthorizedPlays: 'Fix: gameRouter.authorizePlays(N) — el player no tiene plays',
  NotAuthorizedCaller: 'Fix: gameRouter.setCaller(backendWallet, true)',
  MultiplierNotInRange: 'Fix: revisar game.minMultiplier() / maxMultiplier()',
  InvalidSide: 'side > 1 (Flip) o side > 2 (RPS)',
};

function findRevertError(err: unknown): ContractFunctionRevertedError | null {
  if (err instanceof ContractFunctionRevertedError) return err;
  if (err instanceof BaseError && err.walk) {
    const found = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (found instanceof ContractFunctionRevertedError) return found;
  }
  if (err instanceof Error && 'cause' in err) {
    return findRevertError((err as Error & { cause?: unknown }).cause);
  }
  return null;
}

export function extractRevertReason(error: unknown): string {
  const revertErr = findRevertError(error);
  if (revertErr) {
    const name = revertErr.data?.errorName;
    if (name) {
      const args = revertErr.data?.args ? `(${JSON.stringify(revertErr.data.args)})` : '()';
      const hint = ERROR_HINTS[name] ? ` → ${ERROR_HINTS[name]}` : '';
      return `${name}${args}${hint}`;
    }
    if (revertErr.reason) return revertErr.reason;
  }

  if (error instanceof BaseError) {
    return error.shortMessage ?? error.message;
  }
  if (error instanceof Error) {
    return (error as Error & { shortMessage?: string }).shortMessage ?? error.message;
  }
  return String(error);
}

export type PlayResult = {
  betId: bigint;
  gameAddress: Address;
  playTxHash: Hex;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export function useGamePlay() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContractBase();

  /**
   * Extract betId from play transaction receipt logs.
   */
  const extractBetFromReceipt = async (
    txHash: Hex,
    expectedEvent: 'GamePlayed' | 'GamePlayedWithCredits'
  ): Promise<{ betId: bigint; gameAddress: Address }> => {
    if (!publicClient) throw new Error('Public client not available');

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    if (receipt.status === 'reverted') {
      try {
        const tx = await publicClient.getTransaction({ hash: txHash });
        await publicClient.call({
          to: tx.to ?? undefined,
          data: tx.input,
          account: tx.from,
          value: tx.value,
          blockNumber: receipt.blockNumber,
        });
      } catch (simErr: unknown) {
        throw new Error(extractRevertReason(simErr));
      }
      throw new Error('La transacción de juego fue revertida');
    }

    let gameAddress: Address | undefined;
    let betId: bigint | undefined;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: abis.router,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== expectedEvent) continue;
        gameAddress = (decoded.args as unknown as Record<string, unknown>).game as Address;
        betId = (decoded.args as unknown as Record<string, unknown>).betId as bigint;
        break;
      } catch {
        // non-GameRouter log, skip
      }
    }

    if (!gameAddress || betId === undefined) {
      throw new Error(`No se encontró el evento ${expectedEvent} en la tx.`);
    }

    return { betId, gameAddress };
  };

  /**
   * Ask the backend to settle a bet with automatic retry.
   * Retries up to `maxRetries` times with `retryDelayMs` between attempts to
   * handle cases where the backend RPC hasn't seen the bet block yet.
   */
  const requestSettle = async (
    gameAddress: Address,
    betId: bigint,
    maxRetries = 3,
    retryDelayMs = 2000
  ): Promise<Hex> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('/api/settle-bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameAddress,
            betId: betId.toString(),
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'El backend no pudo enviar la tx de settle');
        }

        const data = await response.json();
        return data.txHash as Hex;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
    }

    throw lastError!;
  };

  /**
   * Fire-and-forget: ask the backend to execute a delegated play.
   * Returns the txHash and playCode for event correlation.
   */
  const requestDelegatedPlay = async (
    gameAddress: Address,
    player: Address,
    token: Address,
    amount: bigint,
    gameChoice: Hex,
    useCredits: boolean,
    referrer: Address = ZERO_ADDRESS,
  ): Promise<{ txHash: Hex; playCode: Hex }> => {
    const response = await fetch('/api/play-delegated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game: gameAddress,
        player,
        token,
        amount: amount.toString(),
        gameChoice,
        useCredits,
        referrer,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || 'Error en jugada delegada');
    }

    const data = await response.json();
    return { txHash: data.txHash as Hex, playCode: data.playCode as Hex };
  };

  /**
   * Mode 1: Standard Play — approve(GameRouter) + playGame
   * Returns betId and txHash. Does NOT settle — caller handles that.
   * token defaults to wildToken, referrer defaults to zero address.
   */
  const playStandard = async (
    gameAddress: Address,
    gameChoice: Hex,
    amount: bigint,
    token: Address = addresses.wildToken,
    referrer: Address = ZERO_ADDRESS,
  ): Promise<PlayResult> => {
    if (!address || !publicClient) throw new Error('Wallet no conectada');

    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, addresses.gameRouter],
    });

    if (allowance < amount) {
      await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.gameRouter, maxUint256],
      });
    }

    const tx = await writeContractAsync({
      address: addresses.gameRouter,
      abi: abis.router,
      functionName: 'playGame',
      args: [gameAddress, gameChoice, token, amount, referrer],
      gas: 500_000n,
    });

    const { betId } = await extractBetFromReceipt(tx, 'GamePlayed');
    return { betId, gameAddress, playTxHash: tx };
  };

  /**
   * Mode 2: Credits — purchase credits
   * token defaults to wildToken.
   */
  const purchaseCredits = async (amount: bigint, token: Address = addresses.wildToken) => {
    if (!address) throw new Error('Wallet no conectada');

    const allowance = await publicClient!.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, addresses.gameCredits],
    });

    if (allowance < amount) {
      await writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.gameCredits, amount],
      });
    }

    return writeContractAsync({
      address: addresses.gameCredits,
      abi: abis.credits,
      functionName: 'purchaseCredits',
      args: [token, amount],
    });
  };

  /**
   * Mode 2: Play with credits.
   * Returns betId and txHash. Does NOT settle — caller handles that.
   */
  const playWithCredits = async (
    gameAddress: Address,
    gameChoice: Hex,
    creditAmount: bigint,
    referrer: Address = ZERO_ADDRESS,
  ): Promise<PlayResult> => {
    if (!address || !publicClient) throw new Error('Wallet no conectada');

    const tx = await writeContractAsync({
      address: addresses.gameRouter,
      abi: abis.router,
      functionName: 'playGameWithCredits',
      args: [gameAddress, gameChoice, creditAmount, referrer],
      gas: 500_000n,
    });

    const { betId } = await extractBetFromReceipt(tx, 'GamePlayedWithCredits');
    return { betId, gameAddress, playTxHash: tx };
  };

  /**
   * Manually settle a pending bet that got stuck.
   */
  const settlePendingBet = async (gameAddress: Address) => {
    if (!address || !publicClient) throw new Error('Wallet no conectada');

    const pendingBetAbi = [
      {
        type: 'function',
        name: 'pendingBetId',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const;

    const betId = await publicClient.readContract({
      address: gameAddress,
      abi: pendingBetAbi,
      functionName: 'pendingBetId',
      args: [address],
    });

    if (betId === BigInt(0)) {
      throw new Error('No hay apuesta pendiente para resolver');
    }

    return requestSettle(gameAddress, betId);
  };

  return {
    playStandard,
    purchaseCredits,
    playWithCredits,
    settlePendingBet,
    requestSettle,
    requestDelegatedPlay,
  };
}
