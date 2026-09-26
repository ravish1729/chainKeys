import { useEffect, useRef, useState, type ReactNode } from 'react'
import { generatePrivateKey, privateKeyToAccount, publicKeyToAddress } from 'viem/accounts'
import { getAddress, isAddress, type Address, type Hex } from 'viem'
import {
  connectOwner,
  deploySessionAccount,
  explainWallet,
  fundAgent,
  fundContract,
  readContractBalance,
  verifyDeployment,
} from './chainActions'
import { etherscanAddress, etherscanReadContract } from './sepolia'
import { chooseWallet, listWallets, selectedWalletRdns, type WalletChoice } from './wallet'

type Panel = 'owner' | 'agent' | 'policy' | 'test'

function panelFromHash(): Panel {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h.includes('policy')) return 'policy'
  if (h.includes('console') || h.includes('test')) return 'test'
  if (h.includes('agent')) return 'agent'
  return 'owner'
}

function parseAgentInput(value: string): Address | null {
  const raw = value.trim()
  if (isAddress(raw)) return getAddress(raw)
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`
  if (/^0x[0-9a-fA-F]{128}$/.test(hex)) return publicKeyToAddress(`0x04${hex.slice(2)}` as Hex)
  if (/^0x04[0-9a-fA-F]{128}$/.test(hex)) return publicKeyToAddress(hex as Hex)
  return null
}

export function TryNow({
  ownerAddress,
  ownerEns,
  onOwnerEns,
  onConnected,
  contractAddress,
  onContract,
  sessionAddress,
  sessionSecret,
  onSession,
  armed,
  policy,
  test,
}: {
  ownerAddress: string | null
  ownerEns: string
  onOwnerEns: (name: string) => void
  onConnected: (address: string, ensName: string | null) => void
  contractAddress: string
  onContract: (address: string) => void
  sessionAddress: string
  sessionSecret: string | null
  onSession: (address: string, secret: string | null) => void
  armed: boolean
  policy: ReactNode
  test: ReactNode
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [fundEth, setFundEth] = useState('0.06')
  const [gasEth, setGasEth] = useState('0.002')
  const [gasBalance, setGasBalance] = useState<string | null>(null)
  const [agentMode, setAgentMode] = useState<'create' | 'paste'>('create')
  const [paste, setPaste] = useState('')
  const [panel, setPanel] = useState<Panel>(panelFromHash)
  const [verified, setVerified] = useState(false)
  const verifiedFor = useRef('')
  const [wallets, setWallets] = useState<WalletChoice[]>([])
  const [walletId, setWalletId] = useState<string | null>(() => selectedWalletRdns())
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const sync = () => setWallets(listWallets())
    sync()
    const timer = window.setTimeout(sync, 400)
    window.addEventListener('eip6963:announceProvider', sync)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('eip6963:announceProvider', sync)
    }
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerOpen])

  useEffect(() => {
    setVerified(verifiedFor.current === contractAddress && contractAddress !== '')
    if (!isAddress(contractAddress)) return
    void readContractBalance(contractAddress as Address)
      .then(setBalance)
      .catch(() => setBalance(null))
  }, [contractAddress])

  useEffect(() => {
    if (!isAddress(sessionAddress)) {
      setGasBalance(null)
      return
    }
    void readContractBalance(sessionAddress as Address)
      .then(setGasBalance)
      .catch(() => setGasBalance(null))
  }, [sessionAddress])

  useEffect(() => {
    const sync = () => setPanel(panelFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  function open(next: Panel) {
    setPanel(next)
    const nextHash = `#/app/${next}`
    if (window.location.hash !== nextHash) window.location.hash = `/app/${next}`
  }

  function connect(rdns: string) {
    setPickerOpen(false)
    void run(`connect:${rdns}`, async () => {
      if (rdns) {
        chooseWallet(rdns)
        setWalletId(rdns)
      }
      const next = await connectOwner()
      onConnected(next.address, next.ensName)
      if (next.ensName) onOwnerEns(next.ensName)
    })
  }

  async function run(label: string, action: () => Promise<void>) {
    setError(null)
    setBusy(label)
    try {
      await action()
    } catch (err) {
      setError(explainWallet(err))
    } finally {
      setBusy(null)
    }
  }

  const items: { id: Panel; label: string; detail: string }[] = [
    { id: 'owner', label: 'Owner', detail: ownerAddress ? ownerEns || 'Connected' : 'Not connected' },
    {
      id: 'agent',
      label: 'Agent',
      detail: sessionAddress ? `${sessionAddress.slice(0, 6)}…${sessionAddress.slice(-4)}` : 'No wallet',
    },
    { id: 'policy', label: 'Policy', detail: armed ? 'Armed' : 'Not armed' },
    { id: 'test', label: 'Test', detail: 'Payments' },
  ]

  return (
    <div className="try-dash">
      <aside className="try-side">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={panel === item.id ? 'on' : ''}
            onClick={() => open(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </aside>
      <div className="try-main">

      <section className="try-block" hidden={panel !== 'owner'}>
        <p className="kicker">Owner</p>
        <h2>Your wallet deploys the contract and funds it.</h2>
        <p className="lede">
          The spendable ETH is transferred from this wallet into SessionAccount on Sepolia. The agent
          never receives that balance.
        </p>
        <div className="card">
          {ownerAddress ? null : (
            <div className="row">
              <button
                className="btn"
                type="button"
                disabled={busy != null}
                onClick={() => {
                  const found = listWallets()
                  setWallets(found)
                  if (found.length > 1) {
                    setPickerOpen(true)
                    return
                  }
                  connect(found[0]?.rdns ?? '')
                }}
              >
                {busy?.startsWith('connect:') ? 'Connecting…' : 'Connect wallet'}
              </button>
            </div>
          )}
          {pickerOpen ? (
            <div className="wallet-modal" role="presentation" onClick={() => setPickerOpen(false)}>
              <div
                className="wallet-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="wallet-picker-title"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="kicker">Owner</p>
                <h2 id="wallet-picker-title">Choose a wallet</h2>
                <p className="hint">Deploy, fund, and arm stay on the wallet you pick.</p>
                <div className="wallet-list">
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.rdns}
                      className={wallet.rdns === walletId ? 'btn' : 'btn ghost'}
                      type="button"
                      disabled={busy != null}
                      onClick={() => connect(wallet.rdns)}
                    >
                      {busy === `connect:${wallet.rdns}` ? 'Connecting…' : wallet.name}
                    </button>
                  ))}
                </div>
                <button className="btn ghost" type="button" onClick={() => setPickerOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <p className="mono">
            Address {ownerAddress ?? 'not connected'}
            <br />
            ENS {ownerEns || (ownerAddress ? 'no primary name on this address' : '—')}
          </p>
          <label className="field" htmlFor="owner-ens">
            Parent .eth name
            <input
              id="owner-ens"
              value={ownerEns}
              placeholder="yourname.eth"
              spellCheck={false}
              onChange={(e) => onOwnerEns(e.target.value.trim())}
            />
          </label>
          <p className="hint">
            Used for the agent subname{ownerEns.includes('.') ? ` agent.${ownerEns.replace(/^agent\./, '')}` : ''}.
            Reverse lookup fills this when the wallet has a primary name.
          </p>
          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn"
              type="button"
              disabled={!ownerAddress || busy != null}
              onClick={() =>
                void run('Deploying…', async () => {
                  const deployed = await deploySessionAccount(ownerAddress as Address)
                  onContract(deployed)
                  setBalance(await readContractBalance(deployed))
                  setBusy('Verifying…')
                  await verifyDeployment(deployed, ownerAddress as Address)
                  verifiedFor.current = deployed
                  setVerified(true)
                })
              }
            >
              {busy === 'Deploying…'
                ? 'Deploying on Sepolia…'
                : busy === 'Verifying…'
                  ? 'Verifying source…'
                  : 'Deploy contract'}
            </button>
          </div>
          {contractAddress ? (
            <>
              <p className="mono">
                Contract {contractAddress}
                <br />
                Balance {balance ?? '—'} ETH
                <br />
                Source {verified ? 'verified on Etherscan' : 'not verified yet'}
              </p>
              <div className="row">
                <a className="btn ghost" href={etherscanAddress(contractAddress)} target="_blank" rel="noreferrer">
                  View on Sepolia
                </a>
                <a className="btn ghost" href={etherscanReadContract(contractAddress)} target="_blank" rel="noreferrer">
                  Read contract
                </a>
                {verified ? null : (
                  <button
                    className="btn"
                    type="button"
                    disabled={!ownerAddress || busy != null}
                    onClick={() =>
                      void run('Verifying…', async () => {
                        await verifyDeployment(contractAddress as Address, ownerAddress as Address)
                        verifiedFor.current = contractAddress
                        setVerified(true)
                      })
                    }
                  >
                    {busy === 'Verifying…' ? 'Verifying source…' : 'Verify on Etherscan'}
                  </button>
                )}
              </div>
              <div className="add-row" style={{ marginTop: 12 }}>
                <input
                  value={fundEth}
                  aria-label="ETH to load"
                  onChange={(e) => setFundEth(e.target.value)}
                />
                <button
                  className="btn"
                  type="button"
                  disabled={busy != null}
                  onClick={() =>
                    void run('Funding…', async () => {
                      await fundContract(ownerAddress as Address, contractAddress as Address, fundEth)
                      setBalance(await readContractBalance(contractAddress as Address))
                    })
                  }
                >
                  {busy === 'Funding…' ? 'Sending…' : 'Load funds'}
                </button>
              </div>
              <p className="hint">Sends ETH from your wallet into the contract. The session key cannot withdraw it.</p>
            </>
          ) : (
            <p className="hint">
              Deploy asks your wallet to confirm a Sepolia transaction, then publishes the source so Etherscan
              can list the contract functions.
            </p>
          )}
          {error ? <p className="hint">{error}</p> : null}
        </div>
      </section>

      <section className="try-block" hidden={panel !== 'agent'}>
        <p className="kicker">Agent</p>
        <h2>A separate wallet, with no claim on the contract balance.</h2>
        <div className="row">
          <button
            className={agentMode === 'create' ? 'btn' : 'btn ghost'}
            type="button"
            onClick={() => setAgentMode('create')}
          >
            Create agent wallet
          </button>
          <button
            className={agentMode === 'paste' ? 'btn' : 'btn ghost'}
            type="button"
            onClick={() => setAgentMode('paste')}
          >
            Use a public key
          </button>
        </div>
        {agentMode === 'create' ? (
          <div className="card" style={{ marginTop: 14 }}>
            <p>
              Generates a new key in this browser and keeps the private key on this device. This key signs
              payments, so Trust Wallet is not asked. Fund gas below. The payment itself still leaves the
              contract.
            </p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                const secret = generatePrivateKey()
                const account = privateKeyToAccount(secret)
                onSession(account.address, secret)
              }}
            >
              Create wallet
            </button>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 14 }}>
            <p>Paste an address, or an uncompressed public key. The private key stays with you.</p>
            <div className="add-row">
              <input
                value={paste}
                placeholder="0x… address or public key"
                spellCheck={false}
                aria-label="Agent public key"
                onChange={(e) => setPaste(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const parsed = parseAgentInput(paste)
                  if (!parsed) {
                    setError('Enter a 0x address or a 64-byte public key.')
                    return
                  }
                  setError(null)
                  onSession(parsed, null)
                }}
              >
                Use this key
              </button>
            </div>
          </div>
        )}
        {sessionAddress ? (
          <>
            <p className="mono" style={{ marginTop: 12 }}>
              Agent address {sessionAddress}
              <br />
              Gas balance {gasBalance == null ? '…' : `${Number(gasBalance).toFixed(4)} ETH`}
              {sessionSecret ? (
                <>
                  <br />
                  Private key {sessionSecret}
                </>
              ) : null}
            </p>
            <div className="add-row" style={{ marginTop: 12 }}>
              <input
                value={gasEth}
                aria-label="ETH for agent gas"
                onChange={(e) => setGasEth(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={busy != null || !sessionAddress}
                onClick={() =>
                  void run('Funding gas…', async () => {
                    if (!ownerAddress) throw new Error('Connect the owner wallet first. It sends the gas.')
                    await fundAgent(ownerAddress as Address, sessionAddress as Address, gasEth)
                    setGasBalance(await readContractBalance(sessionAddress as Address))
                  })
                }
              >
                {busy === 'Funding gas…' ? 'Sending…' : 'Fund gas'}
              </button>
            </div>
            <p className="hint">Sends Sepolia ETH from the owner wallet to the agent, for gas only.</p>
          </>
        ) : (
          <p className="hint">Policy arm needs an agent address before it can install the session key.</p>
        )}
        {error ? <p className="hint">{error}</p> : null}
      </section>

      <section className="try-block" hidden={panel !== 'policy'}>
        <p className="kicker">Policy</p>
        <h2>Set the cap, the time, and what the agent may call.</h2>
        {policy}
      </section>

      <section className="try-block" hidden={panel !== 'test'}>
        <p className="kicker">Test</p>
        <h2>Ask for a payment the policy should refuse, then one it should allow.</h2>
        {test}
      </section>
      </div>
    </div>
  )
}
