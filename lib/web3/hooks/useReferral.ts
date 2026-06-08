'use client';

import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { Address } from 'viem';
import { addresses } from '../constants/addresses';
import { abis } from '../constants/abis';

/**
 * Reads and manages the current player's referral state from ReferalRegistry.
 * - referrerOf: who referred this player (zero if none)
 * - referralLocked: whether the referral is finalized (first bet has been made)
 * - pendingRewards: claimable rewards per token
 * - registerReferral: register a referrer before the first bet
 * - claimRewards: claim accrued rewards as GameCredits
 */
export function useReferral() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const { data: referrerOf, refetch: refetchReferrer } = useReadContract({
    address: addresses.referalRegistry as Address,
    abi: abis.referalRegistry,
    functionName: 'referrerOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: referralLocked, refetch: refetchLocked } = useReadContract({
    address: addresses.referalRegistry as Address,
    abi: abis.referalRegistry,
    functionName: 'referralLocked',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: pendingRewardsWild, refetch: refetchRewardsWild } = useReadContract({
    address: addresses.referalRegistry as Address,
    abi: abis.referalRegistry,
    functionName: 'pendingRewards',
    args: address ? [address, addresses.wildToken as Address] : undefined,
    query: { enabled: !!address },
  });

  const { data: pendingRewardsUsdc, refetch: refetchRewardsUsdc } = useReadContract({
    address: addresses.referalRegistry as Address,
    abi: abis.referalRegistry,
    functionName: 'pendingRewards',
    args: address ? [address, addresses.usdc as Address] : undefined,
    query: { enabled: !!address },
  });

  const registerReferral = async (referrer: Address) => {
    if (!address) throw new Error('Wallet no conectada');
    return writeContractAsync({
      address: addresses.referalRegistry as Address,
      abi: abis.referalRegistry,
      functionName: 'registerReferral',
      args: [referrer],
    });
  };

  const claimRewards = async (token: Address) => {
    if (!address) throw new Error('Wallet no conectada');
    return writeContractAsync({
      address: addresses.referalRegistry as Address,
      abi: abis.referalRegistry,
      functionName: 'claimRewards',
      args: [token],
    });
  };

  const refetchAll = () => {
    refetchReferrer();
    refetchLocked();
    refetchRewardsWild();
    refetchRewardsUsdc();
  };

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const hasReferrer =
    !!referrerOf && (referrerOf as string).toLowerCase() !== ZERO_ADDRESS;

  return {
    referrerOf: referrerOf as Address | undefined,
    hasReferrer,
    referralLocked: referralLocked as boolean | undefined,
    pendingRewardsWild: pendingRewardsWild as bigint | undefined,
    pendingRewardsUsdc: pendingRewardsUsdc as bigint | undefined,
    registerReferral,
    claimRewards,
    refetchAll,
  };
}
