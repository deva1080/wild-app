import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

export const config = createConfig({
  chains: [base],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'Wildcard Games' }),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  transports: {
    [base.id]: http(),
  },
})