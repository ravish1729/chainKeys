import { useEffect, useState } from 'react'
import {
  ensApp,
  etherscanAddress,
  etherscanTx,
  hasAccount,
  hasName,
  loadChainConfig,
  mainnetAddress,
  readAccount,
  readEns,
  type ChainConfig,
  type LiveAccount,
  type LiveEns,
} from './sepolia'

type Status = 'loading' | 'ready' | 'error'

export function SepoliaLive() {
  const [status, setStatus] = useState<Status>('loading')
  const [config, setConfig] = useState<ChainConfig | null>(null)
  const [account, setAccount] = useState<LiveAccount | null>(null)
  const [ens, setEns] = useState<LiveEns | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [resolving, setResolving] = useState(false)

  async function refresh(name?: string) {
    setStatus('loading')
    setError(null)
    try {
      const next = await loadChainConfig()
      setConfig(next)
      const typed = (name ?? nameInput).trim()
      const query = typed || next.agentName
      if (!nameInput && next.agentName) setNameInput(next.agentName)
      const [liveAccount, liveEns] = await Promise.all([
        hasAccount(next) ? readAccount(next) : Promise.resolve(null),
        hasName({ ...next, agentName: query }) ? readEns({ ...next, agentName: query }) : Promise.resolve(null),
      ])
      setAccount(liveAccount)
      setEns(liveEns)
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Sepolia read failed')
    }
  }

  async function resolveTyped() {
    const typed = nameInput.trim()
    if (!typed.includes('.')) {
      setEns({
        name: typed || '(empty)',
        address: null,
        description: null,
        url: null,
        accountRecord: null,
        error: 'Enter a name like yourname.eth',
      })
      return
    }
    if (!config) return
    setResolving(true)
    setError(null)
    try {
      setEns(await readEns({ ...config, agentName: typed }))
    } catch (err) {
      setEns({
        name: typed,
        address: null,
        description: null,
        url: null,
        accountRecord: null,
        error: err instanceof Error ? err.message : 'ENS resolution failed',
      })
    } finally {
      setResolving(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <section className="section" style={{ paddingTop: 28 }}>
      <p className="kicker">What judges open</p>
      <h2 style={{ fontSize: 28, margin: '0 0 8px', fontWeight: 500 }}>Sepolia, read live</h2>
      <p className="lede">
        Type any Ethereum mainnet <code>.eth</code> name and resolve it. No wallet. If{' '}
        <code>chain.json</code> already has a name, it is filled in. The local rehearsal below is a
        separate copy.
      </p>
      <form
        className="add-row"
        style={{ margin: '16px 0 18px', maxWidth: 560 }}
        onSubmit={(e) => {
          e.preventDefault()
          void resolveTyped()
        }}
      >
        <input
          value={nameInput}
          placeholder="yourname.eth"
          spellCheck={false}
          aria-label="ENS name"
          onChange={(e) => setNameInput(e.target.value)}
          disabled={status === 'loading' || resolving}
        />
        <button className="btn" type="submit" disabled={status === 'loading' || resolving || !nameInput.trim()}>
          {resolving ? 'Resolving…' : 'Resolve name'}
        </button>
      </form>
      {status === 'loading' ? <p className="muted">Reading chain…</p> : null}
      {status === 'error' ? (
        <div className="msg revert">
          <strong>Sepolia read failed</strong>
          <p className="hint">{error}</p>
          <button className="btn ghost" type="button" style={{ marginTop: 10 }} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      {status === 'ready' && config ? (
        <>
          <Live config={config} account={account} ens={ens} onRefresh={() => void refresh(nameInput)} />
          {account ? null : <div style={{ marginTop: 16 }}><Checklist /></div>}
        </>
      ) : null}
    </section>
  )
}

function Checklist() {
  return (
    <article className="card">
      <h3>Not on Sepolia yet</h3>
      <p>Fill <code>web/public/chain.json</code> after these steps, then refresh. No rebuild.</p>
      <ol className="steps">
        <li>Fund an owner wallet with Sepolia ETH. Create a second key with <code>cast wallet new</code>.</li>
        <li>
          Put both keys in <code>.env</code> and run the deploy script. Copy <code>ACCOUNT</code> into{' '}
          <code>chain.json</code>.
        </li>
        <li>
          Resolve the <code>.eth</code> name in the field above. Setting <code>agentName</code> in{' '}
          <code>chain.json</code> only prefills that field for the next visitor.
        </li>
        <li>
          <code>./sepolia-demo.sh drain</code> then <code>./sepolia-demo.sh swap</code>. Paste both tx hashes
          into <code>chain.json</code>.
        </li>
      </ol>
    </article>
  )
}

function Live({
  config,
  account,
  ens,
  onRefresh,
}: {
  config: ChainConfig
  account: LiveAccount | null
  ens: LiveEns | null
  onRefresh: () => void
}) {
  const matches =
    ens?.address != null &&
    account != null &&
    ens.address.toLowerCase() === account.sessionKey.toLowerCase()
  const expired = account != null && account.expiry > 0 && account.expiry < Math.floor(Date.now() / 1000)
  return (
    <div className="grid-2">
      <article className="card">
        <p className="kicker">ENS · Ethereum mainnet</p>
        {ens ? (
          <>
            <h3>{ens.name}</h3>
            {ens.error ? <p>{ens.error}</p> : null}
            <p>
              Resolved address {ens.address ?? 'none'}.
              {account
                ? matches
                  ? ' It matches the Sepolia session key.'
                  : ' It does not match the session key yet. Set this name’s address record to that key.'
                : ' Deploy the Sepolia account to compare it with the session key.'}
            </p>
            <p className="mono">
              description {ens.description || '(empty)'}
              <br />
              url {ens.url || '(empty)'}
              {account ? (
                <>
                  <br />
                  account.agentEns {account.agentEns || '(empty)'}
                </>
              ) : null}
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <a className="btn ghost" href={ensApp(ens.name)} target="_blank" rel="noreferrer">
                ENS app
              </a>
              {ens.address ? (
                <a className="btn ghost" href={mainnetAddress(ens.address)} target="_blank" rel="noreferrer">
                  Mainnet address
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h3>No name yet</h3>
            <p>Type a .eth name above and press Resolve name. The lookup is a public mainnet read.</p>
          </>
        )}
      </article>
      <article className="card">
        <p className="kicker">SessionAccount · Sepolia{account ? ` · block ${account.blockNumber}` : ''}</p>
        {account ? (
          <>
            <h3>{account.armed ? (expired ? 'Expired on chain' : 'Armed on chain') : 'Not armed'}</h3>
            <p className="mono">
              remaining {account.remaining} / {account.maxValue} ETH
              <br />
              spent {account.spent} ETH
              <br />
              session {account.sessionKey}
              <br />
              owner {account.owner}
            </p>
          </>
        ) : (
          <>
            <h3>Not deployed</h3>
            <p>The mainnet name can show before this. The spend proof still needs the Sepolia account.</p>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {account ? (
            <a className="btn ghost" href={etherscanAddress(config.account)} target="_blank" rel="noreferrer">
              Account
            </a>
          ) : null}
          {config.drainTx ? (
            <a className="btn ghost" href={etherscanTx(config.drainTx)} target="_blank" rel="noreferrer">
              Drain tx
            </a>
          ) : (
            <span className="muted">Drain tx not linked</span>
          )}
          {config.swapTx ? (
            <a className="btn ghost" href={etherscanTx(config.swapTx)} target="_blank" rel="noreferrer">
              Swap tx
            </a>
          ) : (
            <span className="muted">Swap tx not linked</span>
          )}
          <button className="btn ghost" type="button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </article>
    </div>
  )
}
