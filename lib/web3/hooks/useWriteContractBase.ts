'use client';

import { useAccount, useSwitchChain, useWriteContract } from 'wagmi';
import { base } from 'wagmi/chains';

/**
 * Drop-in replacement for wagmi's useWriteContract that pins every
 * transaction to Base. If the connected wallet is on another network
 * (e.g. MetaMask defaulting to Ethereum mainnet), it prompts a network
 * switch — adding Base to the wallet if missing — before sending, and
 * always passes chainId so the wallet cannot sign on the wrong chain.
 */
export function useWriteContractBase() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, ...rest } = useWriteContract();

  type WriteAsync = typeof writeContractAsync;

  const writeContractAsyncOnBase = (async (
    variables: Parameters<WriteAsync>[0],
    options?: Parameters<WriteAsync>[1],
  ) => {
    if (chainId !== base.id) {
      await switchChainAsync({ chainId: base.id });
    }
    return writeContractAsync(
      { ...variables, chainId: base.id } as Parameters<WriteAsync>[0],
      options,
    );
  }) as WriteAsync;

  return { ...rest, writeContractAsync: writeContractAsyncOnBase };
}
