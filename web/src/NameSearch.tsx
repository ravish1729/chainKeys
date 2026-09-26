import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import {
  ensApp,
  etherscanAddress,
  loadChainConfig,
  mainnetAddress,
  readAccount,
  readEns,
  SEPOLIA_SUBNAME_EXAMPLE,
  type LiveEns,
} from './sepolia'
import { createAgentSubname } from './ensSubname'
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

export function NameSearch({ contract, owner }: { contract: string; owner: string | null }) {
  const [query, setQuery] = useState(nameFromHash)
  const [mainnetResult, setMainnetResult] = useState<LiveEns | null>(null)
  const [sepoliaResult, setSepoliaResult] = useState<LiveEns | null>(null)
  const [contractEns, setContractEns] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createStep, setCreateStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canCreate = Boolean(owner && isAddress(owner) && isAddress(contract))

  async function resolve(name: string) {
    const typed = name.trim()
    if (!typed.includes('.')) {
      setMainnetResult(null)
      setSepoliaResult(null)
      setContractEns(null)
      setError('Enter a name like agent.ravish1729.eth')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const config = await loadChainConfig()
      const [mainnetEns, sepoliaEns] = await Promise.all([
        readEns({ ...config, agentName: typed }, 'mainnet'),
        readEns({ ...config, agentName: typed }, 'sepolia'),
      ])
      setMainnetResult(mainnetEns)
      setSepoliaResult(sepoliaEns)
      if (isAddress(contract)) {
        const live = await readAccount({ ...config, account: contract })
        setContractEns(live.agentEns || null)
      } else {
        setContractEns(null)
      }
    } catch (err) {
      setMainnetResult(null)
      setSepoliaResult(null)
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
      <p className="kicker">ENS · mainnet and Sepolia</p>
      <h1 style={{ fontSize: 36 }}>Look up an agent by name.</h1>
      <p className="lede">
        Type the public name. This reads Ethereum mainnet and Sepolia. No wallet. A subname is its own
        record on each chain. A mainnet parent is not registered on Sepolia, so the subname resolves
        only where that parent exists.
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
      <button
        className="btn ghost"
        type="button"
        disabled={busy}
        onClick={() => {
          setQuery(SEPOLIA_SUBNAME_EXAMPLE)
          const target = `#/name/${encodeURIComponent(SEPOLIA_SUBNAME_EXAMPLE)}`
          if (window.location.hash !== target) window.location.hash = `/name/${encodeURIComponent(SEPOLIA_SUBNAME_EXAMPLE)}`
          else void resolve(SEPOLIA_SUBNAME_EXAMPLE)
        }}
      >
        Show agent.chainkeys.eth
      </button>
      {error ? <p className="hint">{error}</p> : null}
      {mainnetResult && sepoliaResult ? (
        <>
          <div className="ens-lookup">
            <EnsCard result={mainnetResult} contractEns={contractEns} />
            <EnsCard result={sepoliaResult} contractEns={contractEns} />
          </div>
          {sepoliaResult.name === SEPOLIA_SUBNAME_EXAMPLE && !sepoliaResult.exists ? (
            <div style={{ marginTop: 14 }}>
              <p className="hint">
                {SEPOLIA_SUBNAME_EXAMPLE} is not an ENS name yet. The wallet confirms the name, then the address
                record on chainkeys.eth.
              </p>
              <button
                className="btn"
                type="button"
                disabled={creating || busy || !canCreate}
                onClick={() => {
                  if (!canCreate || !owner) return
                  setCreating(true)
                  setCreateStep(null)
                  setError(null)
                  void createAgentSubname({
                    owner: owner as Address,
                    contract: contract as Address,
                    onStep: setCreateStep,
                  })
                    .then(() => resolve(SEPOLIA_SUBNAME_EXAMPLE))
                    .catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : 'Could not create the name.')
                    })
                    .finally(() => {
                      setCreating(false)
                      setCreateStep(null)
                    })
                }}
              >
                {creating ? createStep || 'Creating the name…' : `Create ${SEPOLIA_SUBNAME_EXAMPLE}`}
              </button>
              {!owner ? <p className="hint">Connect the wallet that owns chainkeys.eth first.</p> : null}
              {owner && !isAddress(contract) ? <p className="hint">Deploy the contract first, then create the name.</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function EnsCard({ result, contractEns }: { result: LiveEns; contractEns: string | null }) {
  const onSepolia = result.network === 'sepolia'
  const addressHref = result.address
    ? onSepolia
      ? etherscanAddress(result.address)
      : mainnetAddress(result.address)
    : null
  return (
    <article className="card">
      <p className="kicker">{onSepolia ? 'Sepolia' : 'Ethereum mainnet'}</p>
      <h2 style={{ fontSize: 22, margin: '0 0 8px' }}>{result.name}</h2>
      {result.error ? <p>{result.error}</p> : null}
      <p className="mono">
        registered {result.exists ? 'yes' : 'no'}
        <br />
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
        <a className="btn ghost" href={ensApp(result.name, result.network)} target="_blank" rel="noreferrer">
          Open in the ENS app
        </a>
        {addressHref ? (
          <a className="btn ghost" href={addressHref} target="_blank" rel="noreferrer">
            {onSepolia ? 'Address on Sepolia' : 'Address on mainnet'}
          </a>
        ) : null}
      </div>
    </article>
  )
}
