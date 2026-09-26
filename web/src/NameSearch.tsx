import { useEffect, useState } from 'react'
import {
  ensApp,
  loadChainConfig,
  mainnetAddress,
  readAccount,
  readEns,
  type LiveEns,
} from './sepolia'
import { isAddress } from './policy'

export function nameFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash.startsWith('name')) return ''
  const rest = hash.slice('name'.length).replace(/^\//, '')
  if (!rest) return ''
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

export function NameSearch({ contract }: { contract: string }) {
  const [query, setQuery] = useState(nameFromHash)
  const [result, setResult] = useState<LiveEns | null>(null)
  const [contractEns, setContractEns] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolve(name: string) {
    const typed = name.trim()
    if (!typed.includes('.')) {
      setResult(null)
      setContractEns(null)
      setError('Enter a name like agent.ravish1729.eth')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const config = await loadChainConfig()
      const ens = await readEns({ ...config, agentName: typed })
      setResult(ens)
      if (isAddress(contract)) {
        const live = await readAccount({ ...config, account: contract })
        setContractEns(live.agentEns || null)
      } else {
        setContractEns(null)
      }
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : 'ENS resolution failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const sync = () => {
      const next = nameFromHash()
      setQuery(next)
      if (next.includes('.')) void resolve(next)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [contract])

  return (
    <section className="section">
      <p className="kicker">ENS · Ethereum mainnet</p>
      <h1 style={{ fontSize: 36 }}>Look up an agent by name.</h1>
      <p className="lede">
        Type the public name. This reads Ethereum mainnet. No wallet. The address record is the session
        key. The <code>agent-account</code> text record is the Sepolia contract that holds the ETH.
      </p>
      <form
        className="add-row"
        style={{ margin: '16px 0 18px', maxWidth: 640 }}
        onSubmit={(event) => {
          event.preventDefault()
          const next = query.trim()
          const target = `#/name/${encodeURIComponent(next)}`
          if (window.location.hash !== target) window.location.hash = `/name/${encodeURIComponent(next)}`
          else void resolve(next)
        }}
      >
        <input
          value={query}
          placeholder="agent.ravish1729.eth"
          spellCheck={false}
          aria-label="ENS name"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn" type="submit" disabled={busy || !query.trim()}>
          {busy ? 'Resolving…' : 'Resolve name'}
        </button>
      </form>
      {error ? <p className="hint">{error}</p> : null}
      {result ? (
        <article className="card">
          <h2 style={{ fontSize: 28, margin: '0 0 8px' }}>{result.name}</h2>
          {result.error ? <p>{result.error}</p> : null}
          <p className="mono">
            address {result.address ?? 'no address record'}
            <br />
            description {result.description || 'empty'}
            <br />
            url {result.url || 'empty'}
            <br />
            agent-account {result.accountRecord || 'empty'}
            <br />
            contract agentEns() {contractEns ?? 'deploy a contract to compare'}
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <a className="btn ghost" href={ensApp(result.name)} target="_blank" rel="noreferrer">
              Open in the ENS app
            </a>
            {result.address ? (
              <a className="btn ghost" href={mainnetAddress(result.address)} target="_blank" rel="noreferrer">
                Address on mainnet
              </a>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  )
}
