'use client';

import { useReadContract, usePublicClient } from 'wagmi';
import { useWriteContractBase } from './useWriteContractBase';
import { Address, erc20Abi, maxUint256 } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

/**
 * Interacts with the WildVault contract for swapping USDC ↔ WILD.
 * Rates are stored as: wildAmount = tokenAmount * buyRate  (for buying WILD)
 *                      tokenAmount = wildAmount / sellRate (for selling WILD)
 * Both rates use the token's native decimals.
 */
export function useWildVault() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContractBase();

  const { data: usdcBuyRate } = useReadContract({
    address: addresses.wildVault as Address,
    abi: abis.wildVault,
    functionName: 'buyRate',
    args: [addresses.usdc as Address],
    query: { refetchInterval: 30_000 },
  });

  const { data: usdcSellRate } = useReadContract({
    address: addresses.wildVault as Address,
    abi: abis.wildVault,
    functionName: 'sellRate',
    args: [addresses.usdc as Address],
    query: { refetchInterval: 30_000 },
  });

  const { data: usdcAccepted } = useReadContract({
    address: addresses.wildVault as Address,
    abi: abis.wildVault,
    functionName: 'acceptedTokens',
    args: [addresses.usdc as Address],
  });

  /** Preview: how much WILD you receive for `tokenAmount` of USDC */
  const previewBuy = async (tokenAmount: bigint): Promise<bigint> => {
    if (!publicClient) throw new Error('Public client not available');
    return publicClient.readContract({
      address: addresses.wildVault as Address,
      abi: abis.wildVault,
      functionName: 'previewBuy',
      args: [addresses.usdc as Address, tokenAmount],
    }) as Promise<bigint>;
  };

  /** Preview: how much USDC you receive for `wildAmount` of WILD */
  const previewSell = async (wildAmount: bigint): Promise<bigint> => {
    if (!publicClient) throw new Error('Public client not available');
    return publicClient.readContract({
      address: addresses.wildVault as Address,
      abi: abis.wildVault,
      functionName: 'previewSell',
      args: [addresses.usdc as Address, wildAmount],
    }) as Promise<bigint>;
  };

  /**
   * Buy WILD with USDC.
   * Approves USDC to WildVault if needed, then calls buyWild.
   */
  const buyWild = async (usdcAmount: bigint, userAddress: Address): Promise<bigint> => {
    if (!publicClient) throw new Error('Public client not available');

    const allowance = await publicClient.readContract({
      address: addresses.usdc as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAddress, addresses.wildVault as Address],
    });

    if (allowance < usdcAmount) {
      await writeContractAsync({
        address: addresses.usdc as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.wildVault as Address, maxUint256],
      });
    }

    const hash = await writeContractAsync({
      address: addresses.wildVault as Address,
      abi: abis.wildVault,
      functionName: 'buyWild',
      args: [addresses.usdc as Address, usdcAmount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status === 'reverted') throw new Error('buyWild transaction reverted');

    // Return estimated wild received (previewBuy result)
    return previewBuy(usdcAmount);
  };

  /**
   * Sell WILD for USDC.
   * Approves WILD to WildVault if needed, then calls sellWild.
   */
  const sellWild = async (wildAmount: bigint, userAddress: Address): Promise<bigint> => {
    if (!publicClient) throw new Error('Public client not available');

    const allowance = await publicClient.readContract({
      address: addresses.wildToken as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [userAddress, addresses.wildVault as Address],
    });

    if (allowance < wildAmount) {
      await writeContractAsync({
        address: addresses.wildToken as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [addresses.wildVault as Address, maxUint256],
      });
    }

    const hash = await writeContractAsync({
      address: addresses.wildVault as Address,
      abi: abis.wildVault,
      functionName: 'sellWild',
      args: [addresses.usdc as Address, wildAmount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status === 'reverted') throw new Error('sellWild transaction reverted');

    return previewSell(wildAmount);
  };

  return {
    usdcBuyRate: usdcBuyRate as bigint | undefined,
    usdcSellRate: usdcSellRate as bigint | undefined,
    usdcAccepted: usdcAccepted as boolean | undefined,
    previewBuy,
    previewSell,
    buyWild,
    sellWild,
  };
}
