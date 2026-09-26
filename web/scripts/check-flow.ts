import { DRAIN_PROMPT, SCAM_PROMPT, SWAP_PROMPT, draftIntent } from '../src/agent.ts'
import { AGENT_NAME, issueAgentSubname } from '../src/ens.ts'
import {
  DEAD,
  SESSION_KEY,
  SWAP_SELECTOR,
  UNI,
  defaultState,
  preview,
} from '../src/policy.ts'
import { buildPayment, localScreen } from '../src/screen.ts'

const drain = draftIntent(DRAIN_PROMPT)
const swap = draftIntent(SWAP_PROMPT)
const scam = draftIntent(SCAM_PROMPT)
if (drain.to !== DEAD) throw new Error('drain target')
if (swap.to !== UNI) throw new Error('swap should be uniswap')
if (!scam.data.includes('0b0b')) throw new Error('scam token')

const ds = localScreen(drain, buildPayment(drain))
const ss = localScreen(swap, buildPayment(swap))
const cs = localScreen(scam, buildPayment(scam))
if (ds.verdict !== 'refuse') throw new Error('drain should refuse')
if (ss.verdict !== 'allow') throw new Error('uni should allow')
if (cs.verdict !== 'refuse') throw new Error('scam should refuse')

const unarmed = defaultState()
if (unarmed.armed) throw new Error('start unarmed')
if ((preview(unarmed, swap) & (1 << 4)) === 0) throw new Error('not armed bit')

const now = Math.floor(Date.now() / 1000)
const armed = {
  ...unarmed,
  armed: true,
  sessionKey: SESSION_KEY,
  expiry: now + 900,
  now,
  targets: [UNI.toLowerCase()],
  selectors: [SWAP_SELECTOR],
  tokens: unarmed.tokens,
}
if (preview(armed, swap) !== 0) throw new Error(`armed swap should pass ${preview(armed, swap)}`)
if (preview(armed, drain) === 0) throw new Error('armed drain should fail')

const ens = issueAgentSubname(now + 900)
if (!ens.active || ens.agent !== AGENT_NAME) throw new Error('ens')
if (!ens.roles.some((r) => r.role === 'text.agent-*')) throw new Error('eac')

console.log('client flow ok', {
  drain: ds.verdict,
  swap: ss.verdict,
  scam: cs.verdict,
  policySwap: preview(armed, swap),
  ens: ens.agent,
})
