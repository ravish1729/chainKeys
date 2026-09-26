import { useState, type ReactNode } from 'react'
import { Logo } from './Logo'
import { SEPOLIA_SUBNAME_EXAMPLE } from './sepolia'
import { ThemeSwitch } from './theme'

function Box({ title, detail, tone }: { title: string; detail?: string; tone?: 'account' | 'stop' | 'ok' }) {
  return (
    <div className={tone ? `chart-box chart-${tone}` : 'chart-box'}>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  )
}

function Diamond({ label }: { label: string }) {
  return (
    <div className="chart-decision">
      <svg viewBox="0 0 220 128" aria-hidden="true">
        <polygon points="110,6 214,64 110,122 6,64" />
      </svg>
      <span>{label}</span>
    </div>
  )
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="chart-arrow">
      <span>{label}</span>
      <svg width="16" height="28" viewBox="0 0 16 28" aria-hidden="true">
        <line x1="8" y1="0" x2="8" y2="18" />
        <polyline points="2,16 8,26 14,16" />
      </svg>
    </div>
  )
}

function Fork({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <>
      <div className="chart-join" aria-hidden="true" />
      <div className="chart-fork">
        <div>{left}</div>
        <div>{right}</div>
      </div>
    </>
  )
}

function EnsShot() {
  const [ready, setReady] = useState(true)
  if (!ready) {
    return (
      <figure className="ens-shot ens-shot-empty">
        <p>Drop the ENS screenshot in as web/public/ens-usecase.png and refresh.</p>
      </figure>
    )
  }
  return (
    <figure className="ens-shot">
      <img
        src="./ens-usecase.png"
        alt="agent.ravish1729.eth on Ethereum mainnet"
        onError={() => setReady(false)}
      />
    </figure>
  )
}

export function Landing() {
  return (
    <div className="site">
      <header className="site-bar">
        <div className="wrap site-bar-inner">
          <a className="brand" href="#/">
            <Logo />
          </a>
          <nav className="site-nav">
            <a href="#funds">The funds</a>
            <a href="#ens">The name</a>
            <a href="#protect">The screen</a>
            <a href="#flow">The flow</a>
            <a href="#different">Difference</a>
            <ThemeSwitch />
            <a className="btn" href="#/app">
              Try now
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="site-hero wrap">
          <h1>Give your agent a budget it cannot raise.</h1>
          <p className="site-lede">
            You fund the contract. The agent gets a key. The key can ask. It cannot take the balance.
          </p>
          <div className="row">
            <a className="btn" href="#/app">
              Try now
            </a>
            <a className="btn ghost" href="#funds">
              See how a payment moves
            </a>
          </div>
        </section>

        <section className="wrap site-section" id="funds">
          <div className="ens-split">
            <div>
              <h2>The money stays in the contract.</h2>
              <p>
                The agent wallet signs the payment. The contract sends the ETH, and only inside the
                budget you set.
              </p>
            </div>
            <figure className="ens-shot">
              <img src="./story-funds.png" alt="ETH held in the contract, with the agent key kept separate" />
            </figure>
          </div>
        </section>

        <section className="wrap site-section" id="ens">
          <div className="ens-split">
            <div>
              <h2>Hand the session over by name.</h2>
              <p>
                A teammate, a contractor, or another agent gets <code>ens name</code> and a key that
                spends only inside your budget. The name shows which key signs and which contract
                holds the funds. Revoke, and it stops pointing at their key. On Sepolia,{' '}
                <a href={`#/name/${encodeURIComponent(SEPOLIA_SUBNAME_EXAMPLE)}`}>agent.chainkeys.eth</a> points
                at the contract.
              </p>
            </div>
            <EnsShot />
          </div>
        </section>

        <section className="wrap site-section" id="protect">
          <div className="ens-split">
            <div>
              <h2>A scam never gets signed.</h2>
              <p>
                Who would be paid, and which token, is screened first. A drain is refused. A real
                swap is allowed, then the contract still checks the budget.
              </p>
              <div className="screen-card in-story" aria-label="A drain is refused and a USDC swap is allowed">
                <div className="screen-row stop">
                  <div>
                    <strong>Send the balance to 0x…dEaD</strong>
                    <span>score 99 · drain address</span>
                  </div>
                  <em>Refused</em>
                </div>
                <div className="screen-row ok">
                  <div>
                    <strong>Swap 0.01 ETH for USDC</strong>
                    <span>Uniswap · score 4</span>
                  </div>
                  <em>Allowed</em>
                </div>
              </div>
            </div>
            <figure className="ens-shot">
              <img src="./story-screen.png" alt="A blocked payment beside one that is allowed through" />
            </figure>
          </div>
        </section>

        <section className="wrap site-section" id="flow">
          <h2>Then the contract pays, or it does not.</h2>
          <div
            className="chart"
            role="img"
            aria-label="Owner deploys SessionAccount and transfers ETH into it, then sets the ENS name and arms a session key. Intercepta screens the payment before the key signs. The contract preview allows or reverts the transfer."
          >
            <Box title="Owner" detail="EOA. Deploys the contract." />
            <Arrow label="Transfers ETH into the contract" />
            <Box title="SessionAccount" detail="The contract. Spendable ETH is this balance." tone="account" />
            <p className="chart-caption">Owner then calls both</p>
            <Fork
              left={
                <>
                  <Arrow label="setAgentEns" />
                  <Box title="ENS" detail="Public agent name. Owner writes it. The session key cannot." />
                </>
              }
              right={
                <>
                  <Arrow label="arm(key, cap, time, allowlist)" />
                  <Box title="Session key" detail="Agent wallet. Gas only, not the treasury." />
                  <Arrow label="Drafts an x402 payment" />
                  <Diamond label="Intercepta" />
                  <Fork
                    left={
                      <>
                        <Arrow label="Refuse" />
                        <Box title="Not signed" detail="No transaction." tone="stop" />
                      </>
                    }
                    right={
                      <>
                        <Arrow label="Allow, then execute()" />
                        <Diamond label="preview() = 0?" />
                        <Fork
                          left={
                            <>
                              <Arrow label="No" />
                              <Box title="PolicyViolation" detail="ETH stays in the contract." tone="stop" />
                            </>
                          }
                          right={
                            <>
                              <Arrow label="Yes" />
                              <Box title="Paid" detail="ETH leaves the contract." tone="ok" />
                            </>
                          }
                        />
                      </>
                    }
                  />
                </>
              }
            />
          </div>
        </section>

        <section className="wrap site-section" id="different">
          <h2>A public name, a screen, and a public budget.</h2>
          <div className="site-peers">
            <article>
              <h3>Safe, ZeroDev, Rhinestone</h3>
              <p>A session key with a spending limit. The agent has no public name, and nothing checks who would be paid before the key signs.</p>
            </article>
            <article>
              <h3>Coinbase agentic wallets</h3>
              <p>The spending limit sits in a private enclave. Outsiders cannot read the policy or the refusal on a public contract.</p>
            </article>
            <article>
              <h3>Chainkeys</h3>
              <p>The agent has an ENS name. Intercepta screens the payment before the signature. The budget is a public contract, so the refusal is on-chain.</p>
            </article>
          </div>
        </section>

        <section className="site-close">
          <div className="wrap">
            <h2>Open the walkthrough.</h2>
            <p>Arm a key, send a payment that should fail, then one that should succeed.</p>
            <a className="btn" href="#/app">
              Try now
            </a>
          </div>
        </section>
      </main>

      <footer className="site-foot wrap">
        <a className="brand" href="#/">
          <Logo />
        </a>
        <a href="#/app">Try now</a>
      </footer>
    </div>
  )
}
