import { localScreen, mergeLive, type LiveScan, type ScreenResult } from '../src/screen.ts'
import type { Intent } from '../src/policy.ts'
import type { X402Payment } from '../src/x402.ts'

const INTERCEPTA = 'https://api.web3antivirus.io'

async function interceptaScan(to: string, token: string | null): Promise<LiveScan | null> {
  const key = process.env.INTERCEPTA_API_KEY || ''
  const headers: Record<string, string> = { accept: 'application/json' }
  if (key) headers['X-API-KEY'] = key

  const live: LiveScan = { toxicScore: 0, traits: [], tokenDetectors: [] }
  let hit = false

  try {
    const addrRes = await fetch(
      `${INTERCEPTA}/api/public/v2/extension/account/${encodeURIComponent(to)}/quick-scan`,
      { headers }
    )
    if (addrRes.ok) {
      const json = (await addrRes.json()) as { toxicScore?: number; traits?: LiveScan['traits'] }
      live.toxicScore = json.toxicScore ?? 0
      live.traits = json.traits ?? []
      hit = true
    } else if (addrRes.status === 404) {
      // quick-scan is for EOAs. Routers such as Uniswap and 1inch are contracts.
      const contractRes = await fetch(
        `${INTERCEPTA}/api/public/v1/extension/analysis/contract/${encodeURIComponent(to)}/risks`,
        { headers }
      )
      if (contractRes.ok) {
        const json = (await contractRes.json()) as {
          riskScore?: number
          reliability?: string
          riskGroup?: string
        }
        const score = json.riskScore ?? 0
        live.toxicScore = Math.max(live.toxicScore ?? 0, score)
        const reliability = json.reliability || json.riskGroup || 'contract'
        if (json.reliability === 'blocklist') {
          live.toxicScore = Math.max(live.toxicScore ?? 0, 99)
        }
        live.traits = [
          ...(live.traits ?? []),
          { name: 'contract', description: `${reliability}, risk ${score}` },
        ]
        hit = true
      }
    } else if (addrRes.status === 401 || addrRes.status === 403) {
      live.error = key
        ? `Intercepta ${addrRes.status}`
        : 'no INTERCEPTA_API_KEY — using local screen; set the key for a live call'
    }
  } catch (err) {
    live.error = err instanceof Error ? err.message : 'intercepta address scan failed'
  }

  if (token) {
    try {
      const tokenRes = await fetch(
        `${INTERCEPTA}/api/public/v2/extension/token-intelligence/token/${encodeURIComponent(token)}/risks?chainId=1`,
        { headers }
      )
      if (tokenRes.ok) {
        const json = (await tokenRes.json()) as {
          action?: string
          detectors?: { code?: string }[]
          riskScore?: number
        }
        live.tokenAction = json.action
        live.tokenDetectors = (json.detectors ?? []).map((d) => d.code || 'detector').filter(Boolean)
        live.toxicScore = Math.max(live.toxicScore ?? 0, json.riskScore ?? 0)
        hit = true
      }
    } catch {
      /* token scan is optional */
    }
  }

  return hit || live.error ? live : null
}

export async function handleScreen(body: {
  to?: string
  token?: string | null
  valueWei?: string
  payment?: X402Payment
}): Promise<ScreenResult> {
  const to = (body.to || '').toLowerCase()
  const token = body.token ? body.token.toLowerCase() : null
  const intent: Intent = {
    to,
    valueWei: BigInt(body.valueWei || '0'),
    data: token
      ? (`0x03438dd0${token.replace(/^0x/, '').padStart(64, '0')}` as `0x${string}`)
      : '0x',
  }
  const payment = body.payment ?? {
    scheme: 'exact' as const,
    network: 'eip155:1' as const,
    maxAmountRequired: intent.valueWei.toString(),
    resource: 'https://chainkeys.local/x402/quote',
    description: 'Agent payment for swap quote + execution',
    payTo: to,
    asset: token ?? '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    maxTimeoutSeconds: 60,
    extra: { selector: token ? '0x03438dd0' : '0x00000000', from: '' },
  }
  const local = localScreen(intent, payment)
  const live = await interceptaScan(to, token)
  return mergeLive(local, live)
}
