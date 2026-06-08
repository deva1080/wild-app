'use client';

import { usePublicClient, useAccount } from 'wagmi';
import { Address, erc20Abi, formatEther, formatUnits } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

const treasuryAbi = [
  {
    type: 'function',
    name: 'acceptedTokens',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'authorizedContracts',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const baseGameAbi = [
  {
    type: 'function',
    name: 'gameIsLive',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'callers',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'supportedTokenInfo',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'minBetAmount', type: 'uint128' },
      { name: 'maxBetAmount', type: 'uint128' },
      { name: 'houseEdgeBP', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'pendingBetId',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const routerAbi = [
  {
    type: 'function',
    name: 'registeredGames',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export type PreflightIssue = {
  level: 'error' | 'warning';
  message: string;
  code?: string;
  meta?: Record<string, unknown>;
};

export interface PreflightOptions {
  /** Token used to fund the bet (ignored when useCredits is true). */
  token: Address;
  /** Decimals of the funding token, for human-readable amounts. */
  decimals: number;
  /** Bet symbol for messages (e.g. WILD / USDC). */
  symbol: string;
  /** Whether the bet is paid from Game Credits. */
  useCredits: boolean;
}

const DEFAULT_OPTIONS: PreflightOptions = {
  token: addresses.wildToken,
  decimals: 18,
  symbol: 'WILD',
  useCredits: false,
};

const creditsBalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function usePreflightCheck() {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const check = async (
    gameAddress: Address,
    amount: bigint,
    opts: PreflightOptions = DEFAULT_OPTIONS
  ): Promise<PreflightIssue[]> => {
    if (!publicClient || !address) return [];

    const issues: PreflightIssue[] = [];
    const { token, decimals, symbol, useCredits } = opts;
    // On-chain the bet always settles against the bet token: WILD for credits,
    // otherwise the chosen token. min/max bet config is denominated in it.
    const betToken: Address = useCredits ? addresses.wildToken : token;
    const betDecimals = useCredits ? 18 : decimals;

    try {
      const [
        ethBalance,
        fundingBalance,
        gameRegistered,
        treasuryAuthorized,
        tokenAccepted,
        treasuryBalance,
        gameLive,
        gameCallerOk,
        tokenInfo,
        pendingBet,
      ] = await Promise.all([
        publicClient.getBalance({ address }),
        useCredits
          ? publicClient.readContract({
              address: addresses.gameCredits,
              abi: creditsBalanceAbi,
              functionName: 'balanceOf',
              args: [address],
            })
          : publicClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            }),
        publicClient.readContract({
          address: addresses.gameRouter,
          abi: routerAbi,
          functionName: 'registeredGames',
          args: [gameAddress],
        }),
        publicClient.readContract({
          address: addresses.treasury,
          abi: treasuryAbi,
          functionName: 'authorizedContracts',
          args: [addresses.gameRouter],
        }),
        useCredits
          ? Promise.resolve(true)
          : publicClient.readContract({
              address: addresses.treasury,
              abi: treasuryAbi,
              functionName: 'acceptedTokens',
              args: [token],
            }),
        publicClient.readContract({
          address: betToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [addresses.treasury as Address],
        }),
        publicClient.readContract({
          address: gameAddress,
          abi: baseGameAbi,
          functionName: 'gameIsLive',
        }),
        publicClient.readContract({
          address: gameAddress,
          abi: baseGameAbi,
          functionName: 'callers',
          args: [addresses.gameRouter],
        }),
        publicClient.readContract({
          address: gameAddress,
          abi: baseGameAbi,
          functionName: 'supportedTokenInfo',
          args: [betToken],
        }),
        publicClient.readContract({
          address: gameAddress,
          abi: baseGameAbi,
          functionName: 'pendingBetId',
          args: [address],
        }),
      ]);

      const GAS_THRESHOLD = BigInt('100000000000000');

      // ETH balance
      if (ethBalance < GAS_THRESHOLD) {
        issues.push({
          level: 'error',
          message: `Sin ETH para gas. Tienes ${formatEther(ethBalance)} ETH en Base.`,
        });
      }

      // Funding balance (token or credits)
      if ((fundingBalance as bigint) < amount) {
        const have = formatUnits(fundingBalance as bigint, useCredits ? 18 : decimals);
        const need = formatUnits(amount, useCredits ? 18 : decimals);
        issues.push({
          level: 'error',
          message: useCredits
            ? `Sin Credits suficientes. Tienes ${have}, necesitas ${need}.`
            : `Sin ${symbol} suficiente. Tienes ${have} ${symbol}, necesitas ${need}.`,
        });
      }

      // Contract setup
      if (!gameRegistered) {
        issues.push({
          level: 'error',
          message: 'Juego no registrado en GameRouter. Contactá al admin.',
        });
      }

      if (!treasuryAuthorized) {
        issues.push({
          level: 'error',
          message: 'GameRouter no está autorizado en Treasury. Contactá al admin.',
        });
      }

      if (!tokenAccepted) {
        issues.push({
          level: 'error',
          message: `${symbol} no está aceptado en Treasury. Contactá al admin.`,
        });
      }

      // Treasury liquidity check (mirrors Treasury.depositTokens require)
      if ((treasuryBalance as bigint) < amount) {
        const have = formatUnits(treasuryBalance as bigint, betDecimals);
        const need = formatUnits(amount, betDecimals);
        const betSymbol = useCredits ? 'WILD' : symbol;
        issues.push({
          level: 'error',
          message: `Treasury sin liquidez suficiente (tiene ${have} ${betSymbol}, apuesta ${need} ${betSymbol}). Contactá al admin.`,
        });
      }

      if (!gameLive) {
        issues.push({
          level: 'error',
          message: 'El juego no está activo (gameIsLive = false). Contactá al admin.',
        });
      }

      if (!gameCallerOk) {
        issues.push({
          level: 'error',
          message: 'GameRouter no es caller autorizado en el juego. Contactá al admin.',
        });
      }

      // Token config — readContract returns tuple as array [minBetAmount, maxBetAmount, houseEdgeBP]
      const minBetAmount = tokenInfo[0];
      const maxBetAmount = tokenInfo[1];
      const ZERO = BigInt(0);
      const betSymbol = useCredits ? 'WILD' : symbol;
      if (maxBetAmount === ZERO) {
        issues.push({
          level: 'error',
          message: `${betSymbol} no está configurado como token de apuesta en este juego. Contactá al admin.`,
        });
      } else {
        if (amount < minBetAmount) {
          issues.push({
            level: 'error',
            message: `Apuesta muy baja. Mínimo: ${formatUnits(minBetAmount, betDecimals)} ${betSymbol}.`,
          });
        }
        if (amount > maxBetAmount) {
          issues.push({
            level: 'error',
            message: `Apuesta muy alta. Máximo: ${formatUnits(maxBetAmount, betDecimals)} ${betSymbol}.`,
          });
        }
      }

      // Pending bet
      if (pendingBet !== ZERO) {
        issues.push({
          level: 'error',
          code: 'PENDING_BET',
          message: `Apuesta pendiente sin resolver (betId: ${pendingBet}).`,
          meta: { betId: pendingBet },
        });
      }
    } catch (e) {
      issues.push({
        level: 'warning',
        message: 'No se pudo verificar el estado del contrato. Verificá tu conexión.',
      });
    }

    return issues;
  };

  return { check };
}
