'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { useCreateWallet, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth'
import { useTxMode } from '@/lib/web3/context/TxModeContext'

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { logout, authenticated } = usePrivy()
  const { createWallet } = useCreateWallet()
  const { isFastTx, toggleMode, authorizedPlays, renewFastTx } = useTxMode()
  const { signMessageAsync } = useSignMessage()

  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [renewError, setRenewError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isNewConnect = useRef(false)
  // Tracks whether we already verified (or established) a session this page load
  const sessionVerifiedRef = useRef(false)

  const forceFullDisconnect = useCallback(() => {
    disconnect()
    if (authenticated) logout()
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    // Clear wagmi's persisted storage so the stale connector isn't restored on reload
    try {
      localStorage.removeItem('wagmi.store')
      localStorage.removeItem('wagmi.cache')
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('wagmi.')) localStorage.removeItem(key)
      }
    } catch { /* localStorage unavailable */ }
  }, [disconnect, authenticated, logout])

  const handleAuth = useCallback(async (walletAddress: string) => {
    try {
      const issuedAt = new Date().toISOString()
      const message = `Sign in to WildBet\n\nAddress: ${walletAddress}\nIssued At: ${issuedAt}`
      const signature = await signMessageAsync({ message })
      await fetch('/api/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, message, signature }),
      })
    } catch (err) {
      console.error('[auth] Sign-in failed:', err)
      forceFullDisconnect()
    }
  }, [signMessageAsync, forceFullDisconnect])

  const { connectors, connect, isPending, error } = useConnect({
    mutation: {
      onSuccess(data) {
        const firstAccount = data.accounts[0]
        const addr =
          typeof firstAccount === 'string'
            ? firstAccount
            : (firstAccount && typeof firstAccount === 'object' && 'address' in firstAccount && typeof firstAccount.address === 'string'
                ? firstAccount.address
                : null)
        if (addr) handleAuth(addr)
      },
    },
  })

  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    onComplete: async ({ user }) => {
      const hasEmbeddedWallet = user.linkedAccounts?.some(
        (a) => a.type === 'wallet' && a.walletClientType === 'privy',
      )
      if (!hasEmbeddedWallet) {
        try {
          await createWallet({ createAdditional: false })
        } catch {
          // wallet may already exist
        }
      }
      isNewConnect.current = true
    },
  })

  const walletOptions = useMemo(() => {
    const seen = new Set<string>()
    return connectors.filter((c) => {
      const key = `${c.id}-${c.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [connectors])

  useEffect(() => {
    if (isConnected) {
      setOpen(false)
      setSelected(null)
      if (isNewConnect.current && address) {
        isNewConnect.current = false
        sessionVerifiedRef.current = true // handleAuth called by onSuccess, mark verified
        handleAuth(address)
      }
    } else {
      // Reset on disconnect so next connect re-checks
      sessionVerifiedRef.current = false
    }
  }, [isConnected, address, handleAuth])

  // On auto-reconnect (wagmi restores connection without calling connect()),
  // the onSuccess path never fires. Check the session and re-auth if the
  // cookie was cleared (e.g. after a browser restart with an old session cookie).
  useEffect(() => {
    if (!isConnected || !address || sessionVerifiedRef.current) return
    sessionVerifiedRef.current = true // prevent duplicate checks

    fetch('/api/auth/check')
      .then((res) => {
        if (!res.ok) handleAuth(address)
      })
      .catch(() => { /* network error, ignore */ })
  }, [isConnected, address, handleAuth])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(address.length - 4)}`
    : ''

  const handleDisconnect = () => {
    forceFullDisconnect()
  }

  const handleRenew = async () => {
    setRenewing(true)
    setRenewError(null)
    try {
      await renewFastTx()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const short = msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('denied')
        ? 'Rejected by wallet'
        : msg.length > 80 ? msg.slice(0, 80) + '…' : msg
      setRenewError(short)
    } finally {
      setRenewing(false)
    }
  }

  const remainingPlays = authorizedPlays !== undefined ? Number(authorizedPlays) : 0

  if (isConnected) {
    return (
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-400/35 bg-[#111722] text-sm font-medium text-amber-100 hover:bg-[#151d2a] transition-colors"
        >
          <span className="text-amber-50">{shortAddress}</span>
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#0d1118] text-amber-300/90">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-amber-200/80 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-amber-400/30 bg-[#0d1118] shadow-lg z-50 overflow-hidden">
            {/* Settings */}
            <button
              type="button"
              onClick={() => { setDropdownOpen(false); router.push('/account') }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-zinc-300 hover:bg-[#141b25] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-300/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              My Account
            </button>

            <div className="h-px bg-amber-500/20 mx-3" />

            {/* Fast TX toggle */}
            <div className="px-4 py-3 space-y-2">
              <button
                type="button"
                onClick={toggleMode}
                className="flex items-center justify-between w-full text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${isFastTx ? 'text-amber-400' : 'text-amber-300/80'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  <span className={isFastTx ? 'text-amber-200 font-semibold' : ''}>
                    {isFastTx ? 'Fast TX' : 'Standard TX'}
                  </span>
                </div>
                <div className={`relative w-9 h-5 rounded-full transition-colors ${isFastTx ? 'bg-amber-400/70' : 'bg-zinc-700'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isFastTx ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </button>

              {isFastTx && (
                <div className="ml-7 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Remaining plays</span>
                    <span className={`text-xs font-bold tabular-nums ${remainingPlays > 10 ? 'text-green-400' : remainingPlays > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                      {remainingPlays}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRenew}
                    disabled={renewing}
                    className="w-full py-1.5 text-xs font-medium rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {renewing ? 'Authorizing…' : 'Renew 100 Fast TX'}
                  </button>
                  {renewError && (
                    <p className="text-[10px] text-red-400 leading-snug break-words">{renewError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="h-px bg-amber-500/20 mx-3" />

            {/* Logout */}
            <button
              type="button"
              onClick={() => { setDropdownOpen(false); handleDisconnect() }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg border border-amber-400/40 bg-amber-400/15 text-amber-100 text-sm font-medium hover:bg-amber-400/25 transition-colors"
      >
        Connect Wallet
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0d1118] border border-amber-400/30 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/20">
              <h3 className="text-sm font-semibold text-zinc-100">Connect</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 text-sm"
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-2">
              {/* Google — via Privy */}
              <button
                type="button"
                onClick={() => initOAuth({ provider: 'google' })}
                disabled={oauthLoading}
                className="w-full text-left px-4 py-3 rounded-xl border border-amber-400/25 bg-[#111722] hover:bg-[#161f2d] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <div>
                    <div className="font-medium text-sm text-zinc-100">
                      {oauthLoading ? 'Connecting...' : 'Continue with Google'}
                    </div>
                    <div className="text-xs text-zinc-400">Embedded wallet via Privy</div>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-amber-500/20" />
                <span className="text-xs text-zinc-500">or use a wallet</span>
                <div className="flex-1 h-px bg-amber-500/20" />
              </div>

              {walletOptions.map((connector) => (
                <button
                  key={`${connector.id}-${connector.name}`}
                  type="button"
                  onClick={() => {
                    setSelected(connector.name)
                    connect({ connector })
                  }}
                  disabled={isPending}
                  className="w-full text-left px-4 py-3 rounded-xl border border-amber-400/25 bg-[#111722] hover:bg-[#161f2d] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <div className="font-medium text-sm text-zinc-100">{connector.name}</div>
                  <div className="text-xs text-zinc-400">
                    {isPending && selected === connector.name ? 'Connecting...' : `Connector: ${connector.id}`}
                  </div>
                </button>
              ))}

              {walletOptions.length === 0 && (
                <div className="text-sm text-zinc-400 border border-amber-400/20 rounded-xl p-3 bg-[#111722]">
                  No wallet connectors available.
                </div>
              )}
            </div>

            {error && (
              <div className="px-4 pb-4">
                <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs p-3">
                  {error.message}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
