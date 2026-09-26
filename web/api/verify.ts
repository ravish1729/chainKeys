import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, getAddress, isAddress } from 'viem'

const CHAIN_ID = '11155111'
const COMPILER = 'v0.8.28+commit.7893614a'
const CONTRACT = 'src/SessionAccount.sol:SessionAccount'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const INPUT_FILE = path.join(HERE, 'session-standard-input.json')

let cachedInput: string | null = null

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function forgeBin(): string {
  const home = process.env.HOME || ''
  return home ? path.join(home, '.foundry/bin/forge') : 'forge'
}

function standardJsonFromForge(): Promise<string> {
  const bin = forgeBin()
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [
        'verify-contract',
        '--show-standard-json-input',
        '0x0000000000000000000000000000000000000001',
        CONTRACT,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || 'local' },
        maxBuffer: 20 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message).trim() || 'forge could not build the verification input'))
          return
        }
        const text = stdout.trim()
        if (!text.startsWith('{')) {
          reject(new Error('forge did not return standard JSON input'))
          return
        }
        resolve(text)
      },
    )
  })
}

async function standardJson(): Promise<string> {
  if (cachedInput) return cachedInput
  try {
    cachedInput = await standardJsonFromForge()
  } catch {
    cachedInput = (await readFile(INPUT_FILE, 'utf8')).trim()
  }
  return cachedInput
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Unexpected response (${res.status}).`)
  }
}

function resultText(body: Record<string, unknown>): string {
  const result = body.result
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') return JSON.stringify(result)
  return typeof body.message === 'string' ? body.message : ''
}

async function verifyEtherscan(address: string, owner: string, source: string): Promise<string | null> {
  const key = process.env.ETHERSCAN_API_KEY?.trim()
  if (!key) {
    return 'Add ETHERSCAN_API_KEY to .env, restart the app, then press Verify on Etherscan.'
  }
  const constructorArguments = encodeAbiParameters([{ type: 'address' }], [getAddress(owner)]).slice(2)
  const form = new URLSearchParams()
  form.set('apikey', key)
  form.set('contractaddress', getAddress(address))
  form.set('sourceCode', source)
  form.set('codeformat', 'solidity-standard-json-input')
  form.set('contractname', CONTRACT)
  form.set('compilerversion', COMPILER)
  form.set('constructorArguments', constructorArguments)
  form.set('constructorArguements', constructorArguments)
  form.set('licenseType', '3')

  const submit = await fetch(
    `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=verifysourcecode`,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form },
  )
  const submitted = await readJson(submit)
  const submittedResult = resultText(submitted)
  if (/already verified/i.test(submittedResult)) return null
  if (submitted.status !== '1') {
    return submittedResult || 'Etherscan rejected the verification.'
  }

  const guid = submittedResult
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const check = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}&apikey=${encodeURIComponent(key)}`,
    )
    const status = await readJson(check)
    const message = resultText(status)
    if (/pass - verified/i.test(message) || /already verified/i.test(message)) return null
    if (status.status === '0' && !/pending/i.test(message)) {
      return message || 'Etherscan could not match this source to the deployed bytecode.'
    }
  }
  return 'Etherscan is still compiling. Press Verify on Etherscan again in a minute.'
}

async function verifySourcify(address: string, source: string): Promise<boolean> {
  const started = await fetch(`https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${getAddress(address)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stdJsonInput: JSON.parse(source),
      compilerVersion: '0.8.28+commit.7893614a',
      contractIdentifier: CONTRACT,
    }),
  })
  const job = await readJson(started)
  const id = typeof job.verificationId === 'string' ? job.verificationId : ''
  if (!id) return false
  for (let i = 0; i < 10; i++) {
    await sleep(3000)
    const status = await readJson(await fetch(`https://sourcify.dev/server/v2/verify/${id}`))
    if (status.isJobCompleted !== true) continue
    const match = (status.contract as { match?: string } | undefined)?.match
    return match === 'match' || match === 'exact_match'
  }
  return false
}

export async function handleVerify(body: { address?: string; owner?: string }): Promise<{
  ok: boolean
  error?: string
  sourcify?: boolean
}> {
  const address = body.address?.trim() ?? ''
  const owner = body.owner?.trim() ?? ''
  if (!isAddress(address) || !isAddress(owner)) {
    return { ok: false, error: 'Contract address and the owner who deployed it are required.' }
  }
  const source = await standardJson()
  const [etherscanError, sourcify] = await Promise.all([
    verifyEtherscan(address, owner, source),
    verifySourcify(address, source).catch(() => false),
  ])
  if (!etherscanError) return { ok: true, sourcify }
  const extra = sourcify ? ' The same source is published on Sourcify.' : ''
  return { ok: false, sourcify, error: `${etherscanError}${extra}` }
}
