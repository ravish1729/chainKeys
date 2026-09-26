import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DRAIN_PROMPT, INCH_PROMPT, SCAM_PROMPT, SWAP_PROMPT, WALLET_PROMPT, draftIntent } from './agent'
import {
  AGENT_NAME,
  expireEns,
  idleEns,
  issueAgentSubname,
  type EnsState,
} from './ens'
import {
  ACCOUNT,
  GENUINE,
  GENUINE_PAYEE,
  INCH,
  OWNER,
  RAW_SELECTOR,
  ROUTER_PRESETS,
  SESSION_KEY,
  SWAP_SELECTOR,
  TOKEN_PRESETS,
  UNI,
  decodeViolations,
  defaultState,
  ethToWei,
  isAddress,
  preview,
  remaining,
  selector,
  shortAddr,
  weiToEth,
  type NamedAddr,
  type PolicyState,
} from './policy'
import { screenPayment, type ScreenResult } from './screen'
import { Landing } from './Landing'
import { NameSearch } from './NameSearch'
import { Logo } from './Logo'
import { ThemeSwitch } from './theme'
import { signIssue, walletError } from './wallet'
import { TryNow } from './TryNow'
import { armContract, executeSessionPayment, lookupOwnerEns, readContractOwner, readLivePolicy } from './chainActions'
import { createAgentSubname } from './ensSubname'
import { loadChainConfig, etherscanAddress, etherscanReadContract, etherscanTx, readAccount, readEns } from './sepolia'
import { privateKeyToAccount } from 'viem/accounts'
import { getAddress, type Address, type Hex } from 'viem'

type View = 'landing' | 'home' | 'policy' | 'console' | 'chain' | 'name'

type Receipt = {
  id: number
  prompt: string
  intent: ReturnType<typeof draftIntent>
  code: number
  remainingAfter: bigint
  screen: ScreenResult
  signed: boolean
  txHash?: string
  txOk?: boolean
  sendError?: string
  account?: string
}

type ChainCheck = {
  name: string
  resolved: string | null
  ensError: string | null
  sepoliaResolved: string | null
  sepoliaExists: boolean
  sepoliaError: string | null
  contractEns: string | null
  contractError: string | null
}

type Identity = {
  owner: string
  account: string
  session: string
  agent: string
}

type PolicyDraft = {
  maxEth: number
  maxPerCallEth: number
  ttl: number
  maxCalls: number
  targets: NamedAddr[]
  tokens: NamedAddr[]
  allowSwap: boolean
  allowRawTransfer: boolean
}

function parseView(): View {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h === 'app' || h.startsWith('app/')) return 'home'
  if (h.startsWith('policy')) return 'policy'
  if (h.startsWith('console')) return 'console'
  if (h.startsWith('chain')) return 'chain'
  if (h.startsWith('name')) return 'name'
  return 'landing'
}

function fmtEth(wei: bigint): string {
  return weiToEth(wei).toFixed(4)
}

function payeeName(to: string): string {
  const addr = to.toLowerCase()
  if (addr === UNI.toLowerCase()) return 'Uniswap v4 PoolManager'
  if (addr === INCH.toLowerCase()) return '1inch router'
  if (addr === GENUINE) return 'genuine wallet vitalik.eth'
  return shortAddr(to)
}

function defaultDraft(): PolicyDraft {
  return {
    maxEth: 0.05,
    maxPerCallEth: 0.02,
    ttl: 15,
    maxCalls: 8,
    targets: [...ROUTER_PRESETS, GENUINE_PAYEE],
    tokens: TOKEN_PRESETS.filter((t) => t.name === 'USDC'),
    allowSwap: true,
    allowRawTransfer: true,
  }
}

function Shell({
  view,
  children,
  full,
  ownerLabel,
}: {
  view: View
  children: ReactNode
  full?: boolean
  ownerLabel: string
}) {
  const on = (v: View) => (view === v ? 'on' : '')
  return (
    <div className="app">
      <header className="wrap">
        <nav className="nav">
          <a className="brand" href="#/">
            <Logo />
          </a>
          <div className="nav-links">
            <a className={on('home') || on('policy') || on('console') ? 'on' : ''} href="#/app">
              Try now
            </a>
            <a className={on('chain')} href="#/chain">
              Receipts
            </a>
            <a className={on('name')} href="#/name">
              Look up a name
            </a>
          </div>
          <ThemeSwitch />
          <span className="pill mint">{ownerLabel}</span>
        </nav>
        <div className="strip">
          {view === 'name' ? (
            <>
              <strong>Look up a name</strong>
              <span>Type an agent name. Mainnet and Sepolia both resolve it. No wallet.</span>
            </>
          ) : (
            <>
              <strong>Try now</strong>
              <span>Owner, agent wallet, policy, then a payment the policy can refuse</span>
            </>
          )}
        </div>
      </header>
      {full ? children : <div className="wrap">{children}</div>}
      {!full ? (
        <footer className="footer wrap">
          <span>The model asked. The chain refused.</span>
          <span>ENS names · Intercepta screens · policy reverts</span>
        </footer>
      ) : null}
    </div>
  )
}

function Chips({
  items,
  onRemove,
}: {
  items: NamedAddr[]
  onRemove: (address: string) => void
}) {
  if (items.length === 0) return <p className="muted">Empty — every call will fail this check.</p>
  return (
    <div className="chips">
      {items.map((item) => (
        <span className="chip" key={item.address}>
          <strong>{item.name}</strong>
          <span className="mono">{shortAddr(item.address)}</span>
          <button type="button" onClick={() => onRemove(item.address)} aria-label={`Remove ${item.name}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

function AddAddress({
  placeholder,
  onAdd,
}: {
  placeholder: string
  onAdd: (address: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="add-row">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
      <button
        className="btn ghost"
        type="button"
        onClick={() => {
          if (!isAddress(value)) return
          onAdd(value.trim().toLowerCase())
          setValue('')
        }}
      >
        Add
      </button>
    </div>
  )
}

function PolicyView({
  draft,
  setDraft,
  state,
  ens,
  identity,
  onChain,
  onArm,
  signing,
  armError,
  signer,
  onCheck,
  checking,
  chainCheck,
  onRegister,
  registering,
  onOpenTest,
}: {
  draft: PolicyDraft
  setDraft: (next: PolicyDraft) => void
  state: PolicyState
  ens: EnsState
  identity: Identity
  onChain: boolean
  onArm: () => void
  signing: boolean
  armError: string | null
  signer: string | null
  onCheck: () => void
  checking: boolean
  chainCheck: ChainCheck | null
  onRegister: () => void
  registering: boolean
  onOpenTest: () => void
}) {
  function patch(partial: Partial<PolicyDraft>) {
    setDraft({ ...draft, ...partial })
  }

  function addTarget(entry: NamedAddr) {
    const address = entry.address.toLowerCase()
    if (draft.targets.some((t) => t.address === address)) return
    patch({ targets: [...draft.targets, { ...entry, address }] })
  }

  function addToken(entry: NamedAddr) {
    const address = entry.address.toLowerCase()
    if (draft.tokens.some((t) => t.address === address)) return
    patch({ tokens: [...draft.tokens, { ...entry, address }] })
  }

  const selectorLine =
    [draft.allowSwap ? 'swap(address)' : null, draft.allowRawTransfer ? 'transfer / empty calldata' : null]
      .filter(Boolean)
      .join(', ') || 'none'

  const live = state.armed && state.now <= state.expiry

  return (
    <div className="section">
      <p className="kicker">Name → policy</p>
      <h1 style={{ fontSize: 36 }}>You sign this. The agent never does.</h1>
      <p className="lede">
        Arming {onChain ? 'writes the policy on the Sepolia contract' : 'signs in your wallet'} and issues{' '}
        {identity.agent}. The session can edit agent text records only. It cannot arm, and it cannot
        touch {identity.owner}.
      </p>

      <article className="card" id="ens-issue">
          <p className="kicker">{ens.active ? 'ENSv2 · issued' : 'ENSv2 · not issued'}</p>
          <h3>{ens.active ? identity.agent : `${identity.agent} (not issued)`}</h3>
          {ens.active && signer ? (
            <p>
              Issued after {shortAddr(signer)} signed. New role <code>text.agent-*</code> is on{' '}
              {identity.agent}.
            </p>
          ) : null}
          <p>
            Hierarchical registry under {identity.owner}. Permissioned resolver. Agent role{' '}
            <code>text.agent-*</code> only — no transfer, no parent admin, no arm.
          </p>
          <pre className="logbox" style={{ marginTop: 10 }}>
            {ens.roles.map((r) => `${r.role.padEnd(16)} ${shortAddr(r.account)} on ${r.on}`).join('\n')}
            {'\n\n'}
            {ens.records.map((r) => `${r.key}\n  ${r.value}  [${r.writableBy}]`).join('\n')}
          </pre>
        </article>

      <div className="policy-form" style={{ marginTop: 22 }}>
        <div className="stack">
          <div className="grid-nums">
            <div className="field">
              <label htmlFor="max">Session cap (ETH)</label>
              <input
                id="max"
                type="number"
                step="0.01"
                value={draft.maxEth}
                onChange={(e) => patch({ maxEth: Number(e.target.value) })}
              />
              <p className="hint">Total the agent may spend before re-arm.</p>
            </div>
            <div className="field">
              <label htmlFor="per">Max per transaction (ETH)</label>
              <input
                id="per"
                type="number"
                step="0.01"
                value={draft.maxPerCallEth}
                onChange={(e) => patch({ maxPerCallEth: Number(e.target.value) })}
              />
              <p className="hint">Stops a single prompt-inject of 1.84 ETH. 0 = off.</p>
            </div>
            <div className="field">
              <label htmlFor="ttl">TTL (minutes)</label>
              <input
                id="ttl"
                type="number"
                value={draft.ttl}
                onChange={(e) => patch({ ttl: Number(e.target.value) })}
              />
              <p className="hint">After this, even a valid swap reverts. Subname expires with it.</p>
            </div>
            <div className="field">
              <label htmlFor="calls">Max calls</label>
              <input
                id="calls"
                type="number"
                value={draft.maxCalls}
                onChange={(e) => patch({ maxCalls: Number(e.target.value) })}
              />
              <p className="hint">Call budget for the session. 0 = unlimited.</p>
            </div>
          </div>

          <div className="field">
            <label>Contract allowlist</label>
            <Chips
              items={draft.targets}
              onRemove={(address) =>
                patch({ targets: draft.targets.filter((t) => t.address !== address) })
              }
            />
            <div className="row" style={{ marginTop: 8 }}>
              {[...ROUTER_PRESETS, GENUINE_PAYEE].map((preset) => (
                <button
                  key={preset.address}
                  className="btn ghost"
                  type="button"
                  onClick={() => addTarget(preset)}
                >
                  + {preset.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <AddAddress
              placeholder="0x… custom router"
              onAdd={(address) => addTarget({ name: shortAddr(address), address })}
            />
            <p className="hint">Uniswap v4 is the happy path. Remove it, then try the swap — TARGET.</p>
          </div>

          <div className="field">
            <label>Allowed methods</label>
            <div className="checks">
              <label>
                <input
                  type="checkbox"
                  checked={draft.allowSwap}
                  onChange={(e) => patch({ allowSwap: e.target.checked })}
                />
                <span>
                  <strong>swap(address)</strong> — Uniswap v4 / 1inch style swap
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.allowRawTransfer}
                  onChange={(e) => patch({ allowRawTransfer: e.target.checked })}
                />
                <span>
                  <strong>raw ETH transfer</strong> — on so a payment to the genuine wallet can pass.
                  0xdEaD stays off the list, so a drain still cannot.
                </span>
              </label>
            </div>
          </div>

          <div className="field">
            <label>Token-out allowlist</label>
            <Chips
              items={draft.tokens}
              onRemove={(address) =>
                patch({ tokens: draft.tokens.filter((t) => t.address !== address) })
              }
            />
            <div className="row" style={{ marginTop: 8 }}>
              {TOKEN_PRESETS.map((preset) => (
                <button
                  key={preset.address}
                  className="btn ghost"
                  type="button"
                  onClick={() => addToken(preset)}
                >
                  + {preset.name}
                </button>
              ))}
            </div>
            <AddAddress
              placeholder="0x… ERC-20"
              onAdd={(address) => addToken({ name: shortAddr(address), address })}
            />
            <p className="hint">USDC only by default. Agent cannot “best-route” into a scam token.</p>
          </div>

          <button className="btn" type="button" onClick={onArm} disabled={signing}>
            {signing ? 'Approve in wallet…' : onChain ? (live ? 'Re-arm on Sepolia' : 'Arm on Sepolia') : live ? 'Re-sign and arm' : 'Sign and arm'}
          </button>
          {armError ? <p className="hint">{armError}</p> : null}
          {ens.active ? (
            <>
              <button className="btn ghost" type="button" onClick={onCheck} disabled={checking}>
                {checking ? 'Reading chain…' : 'Check subname on chain'}
              </button>
              {onChain ? (
                <a
                  className="btn ghost"
                  href={etherscanReadContract(identity.account)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Look up on contract
                </a>
              ) : null}
              <button
                className="btn"
                type="button"
                onClick={() => {
                  window.location.hash = `/name/${encodeURIComponent(identity.agent)}`
                }}
              >
                Look up {identity.agent}
              </button>
              <button className="btn ghost" type="button" onClick={onOpenTest}>
                Open test
              </button>
            </>
          ) : null}
          {chainCheck ? (
            <>
              <pre className="logbox">{`name        ${chainCheck.name}
ethereum    ${chainCheck.ensError ?? chainCheck.resolved ?? 'no address record'}
sepolia     ${chainCheck.sepoliaError ?? (chainCheck.sepoliaExists ? chainCheck.sepoliaResolved ?? 'registered, no address record' : 'not registered on ENS')}
contract    ${chainCheck.contractError ?? chainCheck.contractEns ?? 'agentEns() is empty'}`}</pre>
              {!chainCheck.sepoliaExists && chainCheck.contractEns === chainCheck.name ? (
                <>
                  <p className="hint">
                    The session name is stored on the contract. Sepolia ENS does not have this subname yet.
                  </p>
                  <button className="btn" type="button" onClick={onRegister} disabled={registering || checking}>
                    {registering ? 'Registering on Sepolia…' : `Register ${chainCheck.name}`}
                  </button>
                </>
              ) : null}
            </>
          ) : null}
        </div>
        <pre className="logbox">{`SessionAccount.arm + setAgentEns
  owner       ${identity.owner}
  account     ${identity.account}
  sessionKey  ${identity.session}
  ens         ${identity.agent}  active=${ens.active}
  maxValue    ${draft.maxEth} ETH
  maxPerCall  ${draft.maxPerCallEth || 'off'} ETH
  maxCalls    ${draft.maxCalls || 'unlimited'}
  expiry      now + ${draft.ttl}m
  allowlist
${draft.targets.map((t) => `    ${t.name}`).join('\n') || '    (empty)'}
  selectors   ${selectorLine}
  tokens      ${draft.tokens.map((t) => t.name).join(', ') || 'any'}`}</pre>
      </div>
    </div>
  )
}

function Console({
  state,
  ens,
  account,
  onRun,
  onExpire,
  last,
  busy,
  error,
}: {
  state: PolicyState
  ens: EnsState
  account: string
  onRun: (prompt: string) => void
  onExpire: () => void
  last: Receipt | null
  busy: boolean
  error: string | null
}) {
  const [input, setInput] = useState(DRAIN_PROMPT)
  const notArmed = !state.armed
  const expired = state.armed && state.now > state.expiry
  const rem = remaining(state)
  const drafted = useMemo(() => draftIntent(input), [input])
  const blocked = !state.armed || expired

  return (
    <div className="console">
      <aside className="pane">
        <h2>Session</h2>
        <p className="mono">
          {notArmed ? 'UNARMED' : expired ? 'EXPIRED' : 'ARMED'}
          <br />
          {ens.active ? `${ens.agent} issued` : 'no ENS name'}
          <br />
          remaining {notArmed ? '—' : `${fmtEth(rem)} ETH`}
          <br />
          per tx {state.maxPerCall === 0n ? '∞' : fmtEth(state.maxPerCall)}
          <br />
          calls {state.calls}/{state.maxCalls || '∞'}
        </p>
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setInput(DRAIN_PROMPT); onRun(DRAIN_PROMPT) }}>
            Run drain
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setInput(SWAP_PROMPT); onRun(SWAP_PROMPT) }}>
            Run Uniswap → USDC
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setInput(INCH_PROMPT); onRun(INCH_PROMPT) }}>
            Run 1inch → USDC
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setInput(SCAM_PROMPT); onRun(SCAM_PROMPT) }}>
            Run scam-token swap
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setInput(WALLET_PROMPT); onRun(WALLET_PROMPT) }}>
            Run genuine wallet
          </button>
          <button className="btn danger" type="button" onClick={onExpire}>
            Fast-forward expiry
          </button>
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          Drain refuses. Uniswap, 1inch, and the genuine wallet pass. A scam token refuses.
        </p>
      </aside>
      <section className="chat">
        <div className="log">
          {notArmed ? (
            <div className="msg revert">
              Session is not armed. Sign policy — only {ens.parent} can grant {ens.agent} a key.
            </div>
          ) : null}
          {expired ? (
            <div className="msg revert">
              Session key expired. ENS subname is inactive. Re-arm from Policy — {ens.parent} signs again.
            </div>
          ) : null}
          {!last && !blocked ? (
            <div className="msg muted">
              Agent drafts an x402 payment. Intercepta screens payTo + token before the session key
              signs. Then SessionAccount.preview. Fail → no signature. Pass → spent increases.
            </div>
          ) : null}
          {last ? (
            <>
              <div className="msg user">{last.prompt}</div>
              <div className="msg agent">
                agent drafted x402 {last.screen.payment.scheme}
                <br />
                payTo {last.screen.payTo}
                <br />
                asset {last.screen.asset}
                <br />
                value {fmtEth(last.intent.valueWei)} ETH
                <br />
                selector {selector(last.intent.data)}
              </div>
              {last.screen.verdict !== 'allow' ? (
                <div className="msg revert">
                  <strong>Intercepta REFUSE · payment not signed</strong>
                  <pre className="logbox" style={{ marginTop: 10 }}>
                    {`source     ${last.screen.source}
toxicScore ${last.screen.toxicScore}
${last.screen.reasons.map((r) => `  x ${r}`).join('\n')}

x402       signature withheld
policy     would also revert:
${decodeViolations(last.code).map((r) => `  x ${r}`).join('\n') || '  (policy preview 0 — screen was the block)'}

The model asked. The screen refused.`}
                  </pre>
                </div>
              ) : last.sendError ? (
                <div className="msg ok">
                  <strong>Intercepta ALLOW · payment not broadcast</strong>
                  <pre className="logbox" style={{ marginTop: 10 }}>
                    {`Intercepta ALLOW  score ${last.screen.toxicScore}
${last.screen.reasons.map((r) => `  · ${r}`).join('\n')}

${last.sendError}`}
                  </pre>
                </div>
              ) : last.code !== 0 || last.txOk === false ? (
                <div className="msg revert">
                  <strong>
                  {last.code !== 0 ? `REVERT PolicyViolation(${last.code})` : 'Transaction reverted'}
                </strong>
                  <pre className="logbox" style={{ marginTop: 10 }}>
                    {`Intercepta ALLOW  score ${last.screen.toxicScore}
${last.screen.reasons.map((r) => `  · ${r}`).join('\n')}

${decodeViolations(last.code)
  .map((r) => `  x ${r}`)
  .join('\n')}

The model asked. The chain refused.`}
                  </pre>
                  <TxProof hash={last.txHash} account={last.account || account} />
                </div>
              ) : (
                <div className="msg ok">
                  <strong>
                    {last.txHash ? 'SUCCESS · mined to your SessionAccount' : 'ALLOWED · not sent on Sepolia'}
                  </strong>
                  <pre className="logbox" style={{ marginTop: 10 }}>
                    {`Intercepta ALLOW  score ${last.screen.toxicScore}
${last.screen.reasons.map((r) => `  · ${r}`).join('\n')}

account   ${last.account || account}
call      ${last.txHash ? 'execute from the agent wallet' : 'not broadcast'}
forwards  ${fmtEth(last.intent.valueWei)} ETH to ${payeeName(last.intent.to)}
ens       ${ens.agent}
spent     ${fmtEth(state.spent)} / ${fmtEth(state.maxValue)} ETH
remaining ${fmtEth(last.remainingAfter)} ETH
calls     ${state.calls}/${state.maxCalls || '∞'}`}
                  </pre>
                  {last.txHash ? (
                    <TxProof hash={last.txHash} account={last.account || account} />
                  ) : (
                    <p className="hint">Deploy a SessionAccount and arm it. Until then this payment stays in the browser.</p>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            onRun(input)
          }}
        >
          <textarea value={input} onChange={(e) => setInput(e.target.value)} disabled={blocked || busy} />
          <button className="btn" type="submit" disabled={blocked || busy}>
            {busy ? 'Sending…' : 'Send as agent'}
          </button>
        </form>
        {error ? <p className="hint">{error}</p> : null}
      </section>
      <aside className="pane">
        <h2>Preview</h2>
        {blocked ? (
          <p className="muted">{notArmed ? 'Unarmed. Owner must arm.' : 'Expired. Owner must re-arm.'}</p>
        ) : (
          <>
            <div className="trace">
              <strong>Draft intent</strong>
              {selector(drafted.data)} · {fmtEth(drafted.valueWei)} ETH
              <br />
              {shortAddr(drafted.to)}
            </div>
            {last ? (
              <div className="trace">
                <strong>Intercepta</strong>
                {last.screen.verdict} · score {last.screen.toxicScore} · {last.screen.source}
              </div>
            ) : (
              <p className="muted">Send to screen payTo, then preview + execute.</p>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function TxProof({ hash, account }: { hash?: string; account?: string }) {
  if (!hash) return null
  const href = etherscanTx(hash)
  const onContract = account && isAddress(account)
  return (
    <div className="tx-proof">
      <div className="row">
        <a className="btn" href={href} target="_blank" rel="noreferrer">
          View transaction
        </a>
        {onContract ? (
          <a className="btn ghost" href={`${etherscanAddress(account)}#txs`} target="_blank" rel="noreferrer">
            Contract transactions
          </a>
        ) : null}
        {onContract ? (
          <a className="btn ghost" href={`${etherscanAddress(account)}#internaltx`} target="_blank" rel="noreferrer">
            ETH out of the contract
          </a>
        ) : null}
      </div>
      <p className="hint">
        The agent wallet signed this call. Contract transactions shows it coming from that key. The ETH
        moving onward is on ETH out of the contract.
      </p>
      <a className="tx-proof-url" href={href} target="_blank" rel="noreferrer">
        {href}
      </a>
    </div>
  )
}

function Chain({
  receipts,
  state,
  ens,
}: {
  receipts: Receipt[]
  state: PolicyState
  ens: EnsState
}) {
  return (
    <div className="section">
      <p className="kicker">Receipts</p>
      <h1 style={{ fontSize: 36 }}>The chain stores the leash, not the chat.</h1>
      <p className="lede">
        Each send is Intercepta → preview() → optional execute. Production: these are UserOps; fail
        reverts in validateUserOp. The drain is blocked before the session key signs.
      </p>
      <pre className="logbox" style={{ marginBottom: 16 }}>{`account     ${ACCOUNT}
sessionKey  ${SESSION_KEY}
ens         ${ens.agent}  active=${ens.active}
armed       ${state.armed}
remaining   ${fmtEth(remaining(state))} ETH
perCall     ${state.maxPerCall === 0n ? 'off' : fmtEth(state.maxPerCall) + ' ETH'}
calls       ${state.calls}/${state.maxCalls || '∞'}
routers     ${state.targets.map(shortAddr).join(', ') || '(none)'}
tokens      ${state.tokens.map(shortAddr).join(', ') || 'any'}
uniswap     ${UNI}
1inch       ${INCH}`}</pre>
      <div className="receipts">
        {receipts.length === 0 ? (
          <p className="muted">No calls yet. Run drain then Uniswap in Agent.</p>
        ) : (
          receipts.map((r) => (
            <div key={r.id}>
              <pre className="logbox">
                {`#${r.id}  ${
                  r.screen.verdict !== 'allow'
                    ? 'INTERCEPTA REFUSE (unsigned)'
                    : r.code === 0 && r.txOk !== false && !r.sendError
                      ? 'SUCCESS'
                      : r.code !== 0
                        ? 'REVERT PolicyViolation(' + r.code + ')'
                        : 'REVERTED'
                }
prompt     ${r.prompt.slice(0, 72)}${r.prompt.length > 72 ? '…' : ''}
payTo      ${r.screen.payTo}
asset      ${r.screen.asset}
x402       ${r.signed ? 'signed' : 'withheld'}
screen     ${r.screen.verdict}  score ${r.screen.toxicScore}  ${r.screen.source}
value      ${fmtEth(r.intent.valueWei)} ETH
selector   ${selector(r.intent.data)}
${
  r.screen.verdict !== 'allow'
    ? r.screen.reasons.map((x) => 'x ' + x).join('\n')
    : r.code === 0
      ? 'remaining  ' + fmtEth(r.remainingAfter) + ' ETH'
      : decodeViolations(r.code)
          .map((x) => 'x ' + x)
          .join('\n')
}`}
              </pre>
              <TxProof hash={r.txHash} account={r.account} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const LIVE_KEY = 'chainkeys-live'

function readLive(): {
  owner?: string
  ownerEns?: string
  contract?: string
  contracts?: Record<string, string>
  session?: string
  sessionSecret?: string
} {
  try {
    const raw = localStorage.getItem(LIVE_KEY) || sessionStorage.getItem(LIVE_KEY)
    return raw
      ? (JSON.parse(raw) as {
          owner?: string
          ownerEns?: string
          contract?: string
          contracts?: Record<string, string>
          session?: string
          sessionSecret?: string
        })
      : {}
  } catch {
    return {}
  }
}

function readContracts(): Record<string, string> {
  const saved = readLive().contracts
  if (!saved) return {}
  const next: Record<string, string> = {}
  for (const [owner, contract] of Object.entries(saved)) {
    if (isAddress(owner) && isAddress(contract)) next[owner.toLowerCase()] = getAddress(contract)
  }
  return next
}

function savedSessionSecret(): string | null {
  const live = readLive()
  const secret = live.sessionSecret
  if (!secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) return null
  try {
    const address = privateKeyToAccount(secret as Hex).address
    if (live.session && address.toLowerCase() !== live.session.toLowerCase()) return null
    return secret
  } catch {
    return null
  }
}

function liveValue(key: 'owner' | 'ownerEns' | 'contract' | 'session'): string | null {
  const value = readLive()[key]
  if (!value) return null
  if (key === 'ownerEns') return value
  return isAddress(value) ? value : null
}

export default function App() {
  const [view, setView] = useState<View>(parseView)
  const [draft, setDraft] = useState<PolicyDraft>(defaultDraft)
  const [state, setState] = useState<PolicyState>(() => defaultState())
  const [ens, setEns] = useState<EnsState>(idleEns)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [last, setLast] = useState<Receipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState(false)
  const [armError, setArmError] = useState<string | null>(null)
  const [signer, setSigner] = useState<string | null>(null)
  const [ownerAddress, setOwnerAddress] = useState<string | null>(() => liveValue('owner'))
  const [ownerEns, setOwnerEns] = useState(() => liveValue('ownerEns') ?? '')
  const [contractsByOwner, setContractsByOwner] = useState<Record<string, string>>(readContracts)
  const contractAddress = ownerAddress ? contractsByOwner[ownerAddress.toLowerCase()] ?? '' : ''
  const [sessionAddress, setSessionAddress] = useState(() => liveValue('session') ?? '')
  const [sessionSecret, setSessionSecret] = useState<string | null>(savedSessionSecret)
  const [checking, setChecking] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [chainCheck, setChainCheck] = useState<ChainCheck | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const parent = ownerEns.includes('.') ? ownerEns.replace(/^agent\./, '') : OWNER
  const identity: Identity = {
    owner: ownerEns || ownerAddress || OWNER,
    account: contractAddress || ACCOUNT,
    session: sessionAddress || SESSION_KEY,
    agent: parent.includes('.') ? `agent.${parent}` : AGENT_NAME,
  }
  const onChain = isAddress(contractAddress)

  useEffect(() => {
    const on = () => setView(parseView())
    window.addEventListener('hashchange', on)
    if (!window.location.hash) window.location.hash = '/'
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (!ownerAddress) return
    let cancel = false
    void lookupOwnerEns(ownerAddress as Address).then((name) => {
      if (!cancel) setOwnerEns(name ?? '')
    })
    return () => {
      cancel = true
    }
  }, [ownerAddress])

  useEffect(() => {
    const legacy = readLive().contract
    if (!legacy || !isAddress(legacy)) return
    let cancel = false
    void readContractOwner(legacy as Address).then((onchainOwner) => {
      if (cancel || !onchainOwner) return
      setContractsByOwner((map) => {
        const key = onchainOwner.toLowerCase()
        if (map[key]?.toLowerCase() === legacy.toLowerCase()) return map
        return { ...map, [key]: getAddress(legacy) }
      })
    })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    const previous = readLive()
    const legacy = previous.contract
    const assigned =
      !!legacy &&
      Object.values(contractsByOwner).some((item) => item.toLowerCase() === legacy.toLowerCase())
    const saved = JSON.stringify({
      owner: ownerAddress,
      ownerEns,
      contracts: contractsByOwner,
      contract: assigned ? undefined : legacy,
      session: sessionAddress,
      sessionSecret,
    })
    localStorage.setItem(LIVE_KEY, saved)
    sessionStorage.removeItem(LIVE_KEY)
  }, [ownerAddress, ownerEns, contractsByOwner, sessionAddress, sessionSecret])

  useEffect(() => {
    if (!isAddress(contractAddress)) return
    let cancel = false
    void readLivePolicy(contractAddress as Address).then((live) => {
      if (cancel || !live) return
      setState((current) => {
        if (current.armed && current.sessionKey) return current
        return { ...live, now: Math.floor(Date.now() / 1000) }
      })
      setSessionAddress((current) => current || live.sessionKey)
    })
    return () => {
      cancel = true
    }
  }, [contractAddress])

  async function arm() {
    if (signing) return
    if (!sessionAddress) {
      setArmError('Create an agent wallet, or paste its address, before arming.')
      window.location.hash = '/app/agent'
      return
    }
    setArmError(null)
    setSigning(true)
    const now = Math.floor(Date.now() / 1000)
    const expiry = now + Math.max(0, draft.ttl) * 60
    const selectors = [
      ...(draft.allowSwap ? [SWAP_SELECTOR] : []),
      ...(draft.allowRawTransfer ? [RAW_SELECTOR] : []),
    ]
    try {
      if (onChain) {
        if (!ownerAddress) throw new Error('Connect the owner wallet before arming on Sepolia.')
        await armContract({
          from: ownerAddress as Address,
          contract: contractAddress as Address,
          session: sessionAddress as Address,
          maxValue: ethToWei(draft.maxEth),
          ttlSeconds: BigInt(Math.max(0, draft.ttl) * 60),
          targets: draft.targets.map((t) => getAddress(t.address)),
          selectors: selectors as Hex[],
          maxPerCall: draft.maxPerCallEth > 0 ? ethToWei(draft.maxPerCallEth) : 0n,
          maxCalls: BigInt(Math.max(0, Math.floor(draft.maxCalls))),
          tokens: draft.tokens.map((t) => getAddress(t.address)),
          agentEns: identity.agent.includes('.') ? identity.agent : '',
        })
        setSigner(ownerAddress)
      } else {
        const proof = await signIssue(
          [
            'Chainkeys issue agent subname',
            `name ${identity.agent}`,
            `parent ${identity.owner}`,
            `session ${sessionAddress}`,
            `cap ${draft.maxEth} ETH`,
            `ttl ${draft.ttl} minutes`,
            `expiry ${expiry}`,
          ].join('\n'),
        )
        setSigner(proof.address)
      }
      setState({
        ...defaultState(now),
        armed: true,
        sessionKey: sessionAddress,
        maxValue: ethToWei(draft.maxEth),
        maxPerCall: draft.maxPerCallEth > 0 ? ethToWei(draft.maxPerCallEth) : 0n,
        maxCalls: Math.max(0, Math.floor(draft.maxCalls)),
        expiry,
        targets: draft.targets.map((t) => t.address.toLowerCase()),
        selectors,
        tokens: draft.tokens.map((t) => t.address.toLowerCase()),
      })
      setEns(
        issueAgentSubname(expiry, {
          parent,
          session: sessionAddress,
          account: contractAddress || ACCOUNT,
        }),
      )
      setChainCheck(null)
      setLast(null)
      setReceipts([])
      document.getElementById('ens-issue')?.scrollIntoView({ block: 'start' })
    } catch (err) {
      setArmError(walletError(err))
    } finally {
      setSigning(false)
    }
  }

  async function checkChain() {
    setChecking(true)
    try {
      const config = await loadChainConfig()
      const name = identity.agent
      let resolved: string | null = null
      let ensError: string | null = null
      let sepoliaResolved: string | null = null
      let sepoliaExists = false
      let sepoliaError: string | null = null
      if (name.includes('.')) {
        const [live, sepoliaLive] = await Promise.all([
          readEns({ ...config, agentName: name }, 'mainnet'),
          readEns({ ...config, agentName: name }, 'sepolia'),
        ])
        resolved = live.address
        ensError = live.error
        sepoliaResolved = sepoliaLive.address
        sepoliaExists = sepoliaLive.exists
        sepoliaError = sepoliaLive.error
      } else {
        ensError = 'Set a parent .eth name before this can resolve.'
        sepoliaError = ensError
      }
      let contractEns: string | null = null
      let contractError: string | null = null
      if (isAddress(contractAddress)) {
        try {
          const live = await readAccount({ ...config, account: contractAddress })
          contractEns = live.agentEns || null
        } catch (err) {
          contractError = err instanceof Error ? err.message : 'Contract read failed'
        }
      } else {
        contractError = 'Deploy the contract to read agentEns().'
      }
      setChainCheck({
        name,
        resolved,
        ensError,
        sepoliaResolved,
        sepoliaExists,
        sepoliaError,
        contractEns,
        contractError,
      })
    } finally {
      setChecking(false)
    }
  }

  async function registerSubname() {
    if (registering) return
    if (!ownerAddress) {
      setArmError('Connect the wallet that owns chainkeys.eth.')
      return
    }
    if (!isAddress(contractAddress)) {
      setArmError('Deploy the contract before registering the subname.')
      return
    }
    setArmError(null)
    setRegistering(true)
    try {
      await createAgentSubname({
        owner: ownerAddress as Address,
        contract: contractAddress as Address,
      })
      await checkChain()
    } catch (err) {
      setArmError(walletError(err))
    } finally {
      setRegistering(false)
    }
  }

  function expire() {
    setState((s) => ({ ...s, now: s.expiry + 1 }))
    setEns((e) => expireEns(e))
    setLast(null)
  }

  async function run(prompt: string) {
    if (busy) return
    setBusy(true)
    setTestError(null)
    setLast(null)
    try {
      const intent = draftIntent(prompt)
      const screen = await screenPayment(intent)
      const code = preview(state, intent)
      const allowed = screen.verdict === 'allow' && code === 0
      let txHash: string | undefined
      let txOk: boolean | undefined
      let sendError: string | undefined
      if (allowed && onChain) {
        try {
          if (!sessionSecret) {
            throw new Error('Create an agent wallet and arm it. The private key signs this payment and is not saved.')
          }
          const signer = privateKeyToAccount(sessionSecret as Hex)
          if (signer.address.toLowerCase() !== state.sessionKey.toLowerCase()) {
            throw new Error('This agent key is not the armed session key. Arm the policy again with this wallet.')
          }
          const sent = await executeSessionPayment({
            contract: contractAddress as Address,
            sessionKey: sessionSecret as Hex,
            to: getAddress(intent.to),
            value: intent.valueWei,
            data: intent.data,
          })
          txHash = sent.hash
          txOk = sent.ok
        } catch (err) {
          sendError = walletError(err)
        }
      }
      const passed = allowed && !sendError && txOk !== false && (!onChain || txOk === true)
      const next: PolicyState = passed
        ? { ...state, spent: state.spent + intent.valueWei, calls: state.calls + 1 }
        : state
      const rec: Receipt = {
        id: receipts.length + 1,
        prompt,
        intent,
        code,
        remainingAfter: remaining(next),
        screen,
        signed: allowed && !sendError,
        txHash,
        txOk,
        sendError,
        account: onChain ? contractAddress : undefined,
      }
      if (passed) setState(next)
      setLast(rec)
      setReceipts((prev) => [...prev, rec])
    } catch (err) {
      setTestError(walletError(err))
    } finally {
      setBusy(false)
    }
  }

  if (view === 'landing') return <Landing />

  const showTry = view === 'home' || view === 'policy' || view === 'console'
  const showName = view === 'name'

  return (
    <Shell view={view} full={false} ownerLabel={identity.owner}>
      {showTry ? (
        <TryNow
          ownerAddress={ownerAddress}
          ownerEns={ownerEns}
          onOwnerEns={setOwnerEns}
          onConnected={(address, ensName) => {
            setOwnerAddress(address)
            setOwnerEns(ensName ?? '')
          }}
          onDisconnected={() => {
            setOwnerAddress(null)
            setOwnerEns('')
          }}
          contractAddress={contractAddress}
          onContract={(address) => {
            if (!ownerAddress) return
            setContractsByOwner((map) => ({ ...map, [ownerAddress.toLowerCase()]: address }))
          }}
          sessionAddress={sessionAddress}
          sessionSecret={sessionSecret}
          onSession={(address, secret) => {
            setSessionAddress(address)
            setSessionSecret(secret)
          }}
          armed={state.armed && state.now <= state.expiry}
          policy={
            <PolicyView
              draft={draft}
              setDraft={setDraft}
              state={state}
              ens={ens}
              identity={identity}
              onChain={onChain}
              onArm={() => void arm()}
              signing={signing}
              armError={armError}
              signer={signer}
              onCheck={() => void checkChain()}
              checking={checking}
              chainCheck={chainCheck}
              onRegister={() => void registerSubname()}
              registering={registering}
              onOpenTest={() => {
                window.location.hash = '/app/test'
              }}
            />
          }
          test={
            <Console
              state={state}
              ens={ens}
              account={contractAddress}
              onRun={(p) => void run(p)}
              onExpire={expire}
              last={last}
              busy={busy}
              error={testError}
            />
          }
        />
      ) : null}
      {showName ? <NameSearch contract={contractAddress} owner={ownerAddress} /> : null}
      {view === 'chain' ? <Chain receipts={receipts} state={state} ens={ens} /> : null}
    </Shell>
  )
}
