'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from '@/lib/web3/config'
import { useEffect, useState } from 'react'
import { GlobalEventListeners } from '@/lib/web3/components/GlobalEventListeners'
import { TxModeProvider } from '@/lib/web3/context/TxModeContext'
import { PrivyProvider } from '@privy-io/react-auth'
import { base } from 'wagmi/chains'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [mounted, setMounted] = useState(false)
  const privyAppId = (
    process.env.NEXT_PUBLIC_PRIVY_APP_ID ??
    process.env.NEXT_PUBLIC_PRIVY_AppID ??
    ''
  ).trim()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['google', 'wallet'],
        defaultChain: base,
        supportedChains: [base],
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        appearance: {
          theme: 'dark',
          accentColor: '#18181b',
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <GlobalEventListeners />
          <TxModeProvider>
            {children}
          </TxModeProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}