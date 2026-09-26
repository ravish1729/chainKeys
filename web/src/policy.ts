/**
 * Browser replica of SessionAccount.preview (src/SessionAccount.sol).
 * Same bitmask, including per-tx cap, call budget, and token allowlist.
 */

export const VIOLATION = {
  TARGET: 1 << 0,
  VALUE: 1 << 1,
  SELECTOR: 1 << 2,
  EXPIRED: 1 << 3,
  NOT_ARMED: 1 << 4,
  SIGNER: 1 << 5,
  PER_CALL: 1 << 6,
  CALLS: 1 << 7,
  TOKEN: 1 << 8,
} as const

export const SWAP_SELECTOR = '0x03438dd0'
export const RAW_SELECTOR = '0x00000000'
export const DEAD = '0x000000000000000000000000000000000000dead'
/** vitalik.eth. Intercepta toxic score 0, so a small payment here is allowed. */
export const GENUINE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
export const INCH = '0x1111111254eeb25477b68fb85ed929f73a960582'
export const UNI = '0x000000000004444c5dc75cb358380d2e3de08a90'
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
export const SCAM = '0x0000000000000000000000000000000000000b0b'

export const OWNER = 'ravish1729.eth'
export const SESSION_KEY = '0xA91b0C44dE5f67890123456789aBcDeF01234567'
export const ACCOUNT = '0x4e91C2A8b0d3F1a7C4b9E2d6A1F830c5B7d4E219'

export type NamedAddr = { name: string; address: string }

export const ROUTER_PRESETS: NamedAddr[] = [
  { name: '1inch AggregationRouterV6', address: INCH },
  { name: 'Uniswap V4 PoolManager', address: UNI },
]

export const GENUINE_PAYEE: NamedAddr = { name: 'Genuine wallet', address: GENUINE }

export const TOKEN_PRESETS: NamedAddr[] = [
  { name: 'USDC', address: USDC },
  { name: 'WETH', address: WETH },
]

export type Intent = {
  to: string
  valueWei: bigint
  data: `0x${string}`
}

export type PolicyState = {
  armed: boolean
  sessionKey: string
  maxValue: bigint
  maxPerCall: bigint
  maxCalls: number
  spent: bigint
  calls: number
  expiry: number
  now: number
  targets: string[]
  selectors: string[]
  tokens: string[]
}

export function ethToWei(eth: number): bigint {
  return BigInt(Math.round(eth * 1e9)) * 10n ** 9n
}

export function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18
}

export function remaining(state: PolicyState): bigint {
  if (state.spent >= state.maxValue) return 0n
  return state.maxValue - state.spent
}

export function selector(data: string): string {
  const hex = data.replace(/^0x/i, '')
  if (hex.length < 8) return RAW_SELECTOR
  return `0x${hex.slice(0, 8).toLowerCase()}`
}

export function encodeSwap(token: string): `0x${string}` {
  const addr = token.replace(/^0x/i, '').toLowerCase().padStart(64, '0')
  return `${SWAP_SELECTOR}${addr}` as `0x${string}`
}

export function swapToken(data: string): string | null {
  if (selector(data) !== SWAP_SELECTOR) return null
  const hex = data.replace(/^0x/i, '')
  if (hex.length < 8 + 64) return null
  return `0x${hex.slice(-40)}`
}

export function preview(state: PolicyState, intent: Intent): number {
  let code = 0
  if (!state.armed || !state.sessionKey) code |= VIOLATION.NOT_ARMED
  if (state.now > state.expiry) code |= VIOLATION.EXPIRED
  if (!state.targets.includes(intent.to.toLowerCase())) code |= VIOLATION.TARGET
  if (intent.valueWei > remaining(state)) code |= VIOLATION.VALUE
  if (state.maxPerCall !== 0n && intent.valueWei > state.maxPerCall) code |= VIOLATION.PER_CALL
  if (state.maxCalls !== 0 && state.calls >= state.maxCalls) code |= VIOLATION.CALLS
  if (!state.selectors.includes(selector(intent.data))) code |= VIOLATION.SELECTOR
  if (state.tokens.length > 0) {
    const token = swapToken(intent.data)
    if (token && !state.tokens.includes(token)) code |= VIOLATION.TOKEN
  }
  return code
}

export function decodeViolations(code: number): string[] {
  const out: string[] = []
  if (code & VIOLATION.NOT_ARMED) out.push('session not armed')
  if (code & VIOLATION.EXPIRED) out.push('session expired')
  if (code & VIOLATION.TARGET) out.push('target not in allowlist')
  if (code & VIOLATION.VALUE) out.push('value exceeds remaining cap')
  if (code & VIOLATION.PER_CALL) out.push('value exceeds max per transaction')
  if (code & VIOLATION.CALLS) out.push('session call budget exhausted')
  if (code & VIOLATION.SELECTOR) out.push('selector is not permitted')
  if (code & VIOLATION.TOKEN) out.push('token out is not allowlisted')
  if (code & VIOLATION.SIGNER) out.push('signature is not the session key')
  return out
}

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function defaultState(now = Math.floor(Date.now() / 1000)): PolicyState {
  return {
    armed: false,
    sessionKey: '',
    maxValue: ethToWei(0.05),
    maxPerCall: ethToWei(0.02),
    maxCalls: 8,
    spent: 0n,
    calls: 0,
    expiry: now,
    now,
    targets: [INCH, UNI, GENUINE],
    selectors: [SWAP_SELECTOR, RAW_SELECTOR],
    tokens: [USDC],
  }
}
