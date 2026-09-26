type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  isMetaMask?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
  isBraveWallet?: boolean
  isPhantom?: boolean
  providers?: EthereumProvider[]
}

export type WalletChoice = { name: string; rdns: string }

type Announced = WalletChoice & { provider: EthereumProvider; fromAnnounce: boolean }

const WALLET_CHOICE_KEY = 'chainkeys-wallet'
const TRUST_RDNS = 'com.trustwallet.app'
const announced: Announced[] = []
let chosen: EthereumProvider | null = null

function trustProvider(): EthereumProvider | null {
  const win = window as Window & { trustwallet?: EthereumProvider; trustWallet?: EthereumProvider }
  const provider = win.trustwallet || win.trustWallet
  return provider && typeof provider.request === 'function' ? provider : null
}

function flagName(provider: EthereumProvider): WalletChoice | null {
  if (provider.isTrust || provider.isTrustWallet) return { name: 'Trust Wallet', rdns: 'com.trustwallet.app' }
  if (provider.isBraveWallet) return { name: 'Brave Wallet', rdns: 'com.brave.wallet' }
  if (provider.isPhantom) return { name: 'Phantom', rdns: 'app.phantom' }
  if (provider.isMetaMask) return { name: 'MetaMask', rdns: 'io.metamask' }
  return null
}

function upsert(
  provider: EthereumProvider | undefined,
  info?: { name?: string; rdns?: string },
  fromAnnounce = false,
) {
  if (!provider || typeof provider.request !== 'function') return
  const flagged = flagName(provider)
  const name = info?.name || flagged?.name || 'Browser wallet'
  const rdns = info?.rdns || flagged?.rdns || `wallet:${announced.length}`
  const existing = announced.find((item) => item.rdns === rdns)
  if (existing) {
    if (fromAnnounce || !existing.fromAnnounce) {
      existing.provider = provider
      existing.name = name
      existing.fromAnnounce = existing.fromAnnounce || fromAnnounce
    }
    return
  }
  if (announced.some((item) => item.provider === provider)) return
  announced.push({ name, rdns, provider, fromAnnounce })
}

function absorbInjected() {
  const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum
  if (eth?.providers?.length) {
    for (const provider of eth.providers) upsert(provider)
    return
  }
  upsert(eth)
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent<{ provider?: EthereumProvider; info?: { name?: string; rdns?: string } }>).detail
    upsert(detail?.provider, detail?.info, true)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

export function listWallets(): WalletChoice[] {
  absorbInjected()
  return announced
    .map(({ name, rdns }) => ({ name, rdns }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function selectedWalletRdns(): string | null {
  try {
    return localStorage.getItem(WALLET_CHOICE_KEY)
  } catch {
    return null
  }
}

export function chooseWallet(rdns: string): void {
  absorbInjected()
  const found = announced.find((item) => item.rdns === rdns)
  if (!found) throw new Error('That wallet is not available. Refresh the page and choose it again.')
  chosen = found.provider
  localStorage.setItem(WALLET_CHOICE_KEY, rdns)
}

/** Drop the saved wallet so the next connect can be a different extension or account. */
export function disconnectWallet(): void {
  const provider = activeProvider()
  chosen = null
  try {
    localStorage.removeItem(WALLET_CHOICE_KEY)
  } catch {
    /* private mode */
  }
  if (!provider) return
  void provider
    .request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    })
    .catch(() => undefined)
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

function channelDown(err: unknown): boolean {
  return /broadcast channel unavailable/i.test(messageOf(err))
}

function providerFor(item: Announced): EthereumProvider {
  if (item.rdns === TRUST_RDNS || item.provider.isTrust || item.provider.isTrustWallet) {
    return trustProvider() ?? item.provider
  }
  return item.provider
}

function activeProvider(): EthereumProvider | null {
  absorbInjected()
  const saved = selectedWalletRdns()
  if (saved) {
    const found = announced.find((item) => item.rdns === saved)
    if (found) {
      chosen = providerFor(found)
      return chosen
    }
  }
  if (chosen) return chosen
  if (announced.length === 1) return providerFor(announced[0])
  if (announced.length > 1) return null
  const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum
  return eth && typeof eth.request === 'function' ? eth : null
}

function waitForTrustChannel(): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      if (document.getElementById('in-page-channel-node-id') || Date.now() - start > 2000) resolve()
      else window.setTimeout(tick, 50)
    }
    tick()
  })
}

export function walletError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4001) {
    return 'Wallet request rejected.'
  }
  const message = messageOf(err)
  if (channelDown(err)) {
    return 'Trust Wallet did not open. Allow this site in Trust Wallet, refresh the page, and choose Trust again.'
  }
  if (message) return message
  return 'Wallet request failed.'
}

export function injectedProvider(): EthereumProvider | null {
  return activeProvider()
}

/** Talk only to the wallet the owner picked. A second extension must not answer instead. */
export async function walletRequest(args: { method: string; params?: unknown[] }): Promise<unknown> {
  const provider = activeProvider()
  if (!provider) {
    const names = listWallets().map((wallet) => wallet.name)
    throw new Error(
      names.length
        ? `Choose a wallet first: ${names.join(', ')}.`
        : 'No wallet found. Install a browser wallet, then try again.',
    )
  }
  try {
    return await provider.request(args)
  } catch (err) {
    const trust = trustProvider()
    const selected = selectedWalletRdns()
    const trustChoice = selected === TRUST_RDNS || provider.isTrust || provider.isTrustWallet
    if (!trustChoice || !channelDown(err)) throw err
    await waitForTrustChannel()
    const retry = trust && trust !== provider ? trust : provider
    return retry.request(args)
  }
}

function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value)
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Connect the injected wallet, then ask it to sign the subname issue. */
export async function signIssue(message: string): Promise<{ address: string; signature: string }> {
  const accounts = (await walletRequest({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts?.[0]
  if (!address) throw new Error('The wallet did not return an account.')
  const signature = (await walletRequest({
    method: 'personal_sign',
    params: [utf8ToHex(message), address],
  })) as string
  if (!signature) throw new Error('The wallet did not return a signature.')
  return { address, signature }
}
