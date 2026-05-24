'use client'

import { useEffect } from 'react'
import { useConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import type { EIP1193Provider } from 'viem'

/**
 * Syncs a Privy embedded wallet (created after Google login) into wagmi's
 * connector state, using the same internal API that @privy-io/wagmi uses —
 * but WITHOUT replacing the existing connectors (MetaMask, Coinbase, etc.).
 *
 * MetaMask / Coinbase / WalletConnect connect via wagmi natively (no Privy MAU).
 * Google login creates a Privy session (Privy MAU) and gets an embedded wallet
 * that this hook wires into wagmi so all existing hooks keep working.
 */
export function usePrivyWalletSync() {
  const config = useConfig()
  const { authenticated } = usePrivy()
  const { wallets } = useWallets()

  // Wire the Privy embedded wallet into wagmi when it appears
  useEffect(() => {
    if (!authenticated) return

    const embedded = wallets.find((w) => w.walletClientType === 'privy')
    if (!embedded) return

    let cancelled = false

    async function syncEmbeddedWallet() {
      try {
        const provider = await embedded!.getEthereumProvider()
        if (cancelled) return

        const connectorId = `io.privy.wallet.${embedded!.address}`

        // Skip if wagmi is already connected with this wallet
        const currentState = config.state
        if (currentState.status === 'connected' && currentState.current) {
          const currentConn = currentState.connections.get(currentState.current)
          if (currentConn?.connector.id === connectorId) return
        }

        // Create an injected connector backed by Privy's EIP-1193 provider
        const connector = injected({
          target: {
            provider: provider as EIP1193Provider,
            id: connectorId,
            name: 'Privy Wallet',
          },
        })

        const setupConnector = (config as any)._internal.connectors.setup(connector)
        const chainId = config.chains[0].id

        await (config as any).storage?.removeItem(`${connectorId}.disconnected`)
        await (config as any).storage?.setItem('recentConnectorId', connectorId)

        config.setState((state) => ({
          ...state,
          chainId,
          connections: new Map([
            [
              setupConnector.uid,
              {
                accounts: [embedded!.address as `0x${string}`],
                chainId,
                connector: setupConnector,
              },
            ],
          ]),
          current: setupConnector.uid,
          status: 'connected',
        }))
      } catch (err) {
        console.error('[PrivyWalletSync] Failed to sync embedded wallet:', err)
      }
    }

    syncEmbeddedWallet()
    return () => {
      cancelled = true
    }
  }, [wallets, authenticated, config])

  // Disconnect wagmi when Privy session ends
  useEffect(() => {
    if (authenticated) return

    const currentState = config.state
    if (currentState.status !== 'connected') return

    const current = currentState.current
    if (!current) return

    const conn = currentState.connections.get(current)
    if (conn?.connector.id.startsWith('io.privy.wallet.')) {
      config.setState((state) => ({
        ...state,
        connections: new Map(),
        current: null,
        status: 'disconnected',
      }))
    }
  }, [authenticated, config])
}
