import { DEAD, GENUINE, INCH, SCAM, SESSION_KEY, UNI, USDC, selector, swapToken, type Intent } from './policy'
import { NATIVE_ASSET, type X402Payment } from './x402'

export type ScreenVerdict = 'allow' | 'refuse'

export type LiveTrait = { name?: string; description?: string; risk?: number }

export type LiveScan = {
  toxicScore?: number
  traits?: LiveTrait[]
  tokenAction?: string
  tokenDetectors?: string[]
  error?: string
}

export type ScreenResult = {
  verdict: ScreenVerdict
  toxicScore: number
  reasons: string[]
  source: 'intercepta' | 'local' | 'intercepta+local'
  payTo: string
  asset: string
  payment: X402Payment
}

export function buildPayment(intent: Intent): X402Payment {
  const token = swapToken(intent.data)
  return {
    scheme: 'exact',
    network: 'eip155:1',
    maxAmountRequired: intent.valueWei.toString(),
    resource: 'https://chainkeys.local/x402/quote',
    description: 'Agent payment for swap quote + execution',
    payTo: intent.to.toLowerCase(),
    asset: (token ?? NATIVE_ASSET).toLowerCase(),
    maxTimeoutSeconds: 60,
    extra: { selector: selector(intent.data), from: SESSION_KEY.toLowerCase() },
  }
}

function isDead(addr: string): boolean {
  const a = addr.toLowerCase()
  return a === DEAD || a.endsWith('dead') || a === '0x0000000000000000000000000000000000000000'
}

/** Deterministic screen so the judge UI works without an API key. Live Intercepta raises the score. */
export function localScreen(intent: Intent, payment: X402Payment): ScreenResult {
  const to = intent.to.toLowerCase()
  const token = swapToken(intent.data)
  const reasons: string[] = []
  let toxicScore = 4

  if (isDead(to)) {
    toxicScore = 99
    reasons.push('zero_address_risk: payTo is a burn/drain address')
  }
  if (token === SCAM) {
    toxicScore = Math.max(toxicScore, 96)
    reasons.push('FAKE_TOKEN: token-out is a lookalike / scam asset')
  }
  if (to === UNI.toLowerCase()) {
    reasons.push('venue: Uniswap v4 PoolManager (mainnet 0x0000…8a90)')
  } else if (to === INCH.toLowerCase()) {
    reasons.push('venue: 1inch AggregationRouterV6 (mainnet 0x1111…0582)')
  } else if (to === GENUINE) {
    reasons.push('payee: genuine wallet vitalik.eth')
  }
  if (token === USDC) {
    reasons.push('asset: USDC (high-reputation)')
  }

  if (toxicScore < 50 && reasons.length === 0) {
    reasons.push('no known drain/scam flags on payTo or asset')
  }

  return {
    verdict: toxicScore >= 50 ? 'refuse' : 'allow',
    toxicScore,
    reasons,
    source: 'local',
    payTo: payment.payTo,
    asset: payment.asset,
    payment,
  }
}

export function mergeLive(local: ScreenResult, live: LiveScan | null): ScreenResult {
  if (!live) return local
  const reasons = [...local.reasons]
  const liveScore = typeof live.toxicScore === 'number' ? live.toxicScore : 0
  for (const trait of live.traits ?? []) {
    const label = trait.name || 'trait'
    const desc = trait.description ? ` — ${trait.description}` : ''
    reasons.push(`intercepta:${label}${desc}`)
  }
  for (const det of live.tokenDetectors ?? []) {
    reasons.push(`intercepta:token:${det}`)
  }
  if (live.tokenAction && live.tokenAction !== 'info') {
    reasons.push(`intercepta:token_action=${live.tokenAction}`)
  }
  if (live.error) reasons.push(`intercepta: ${live.error}`)

  const toxicScore = Math.max(local.toxicScore, liveScore)
  let verdict: ScreenVerdict = toxicScore >= 50 ? 'refuse' : 'allow'
  if (live.tokenAction === 'block') verdict = 'refuse'

  return {
    ...local,
    verdict,
    toxicScore,
    reasons,
    source: live.error && liveScore === 0 ? local.source : 'intercepta+local',
  }
}

export async function screenPayment(intent: Intent): Promise<ScreenResult> {
  const payment = buildPayment(intent)
  const fallback = localScreen(intent, payment)
  try {
    const res = await fetch('./api/screen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: intent.to,
        token: swapToken(intent.data),
        valueWei: intent.valueWei.toString(),
        payment,
      }),
    })
    if (!res.ok) return fallback
    const body = (await res.json()) as ScreenResult
    if (!body || !body.verdict) return fallback
    return { ...body, payment: body.payment ?? payment }
  } catch {
    return fallback
  }
}
