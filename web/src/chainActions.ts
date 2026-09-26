import { privateKeyToAccount } from 'viem/accounts'
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { SESSION_BYTECODE } from './sessionBytecode'
import { EMPTY_CHAIN } from './sepolia'
import { walletError, walletRequest } from './wallet'

const SEPOLIA_ID = '0xaa36a7'

const sessionWriteAbi = [
  {
    type: 'constructor',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'initialOwner', type: 'address' }],
  },
  {
    type: 'function',
    name: 'arm',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'key', type: 'address' },
      { name: 'maxValue_', type: 'uint256' },
      { name: 'ttl', type: 'uint256' },
      { name: 'allowedTargets_', type: 'address[]' },
      { name: 'allowedSelectors_', type: 'bytes4[]' },
      { name: 'maxPerCall_', type: 'uint256' },
      { name: 'maxCalls_', type: 'uint256' },
      { name: 'allowedTokens_', type: 'address[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAgentEns',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentEns_', type: 'string' }],
    outputs: [],
  },
] as const

export function explainWallet(err: unknown): string {
  return walletError(err)
}

export async function ensureSepolia(): Promise<void> {
  const current = String(await walletRequest({ method: 'eth_chainId' })).toLowerCase()
  if (current === SEPOLIA_ID) return
  try {
    await walletRequest({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_ID }],
    })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code: number }).code : 0
    if (code !== 4902) throw err
    await walletRequest({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: SEPOLIA_ID,
          chainName: 'Sepolia',
          nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: [EMPTY_CHAIN.rpc],
        },
      ],
    })
  }
}

async function send(tx: { from: Address; to?: Address; data?: Hex; value?: bigint }): Promise<Hash> {
  const hash = (await walletRequest({
    method: 'eth_sendTransaction',
    params: [
      {
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value != null ? `0x${tx.value.toString(16)}` : undefined,
      },
    ],
  })) as Hash
  return hash
}

function sepoliaClient() {
  return createPublicClient({ chain: sepolia, transport: http(EMPTY_CHAIN.rpc) })
}

function mainnetClient() {
  return createPublicClient({ chain: mainnet, transport: http(EMPTY_CHAIN.ensRpc) })
}

export async function lookupOwnerEns(address: Address): Promise<string | null> {
  try {
    const sepoliaName = await sepoliaClient().getEnsName({ address })
    if (sepoliaName) return sepoliaName
  } catch {
    /* Sepolia reverse lookup can fail closed. Try mainnet next. */
  }
  try {
    return await mainnetClient().getEnsName({ address })
  } catch {
    return null
  }
}

export async function readContractOwner(contract: Address): Promise<Address | null> {
  try {
    const owner = await sepoliaClient().readContract({
      address: contract,
      abi: [
        {
          type: 'function',
          name: 'owner',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'address' }],
        },
      ] as const,
      functionName: 'owner',
    })
    return getAddress(owner)
  } catch {
    return null
  }
}

export async function connectOwner(): Promise<{ address: Address; ensName: string | null }> {
  try {
    await walletRequest({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    })
  } catch {
    /* The wallet may only support eth_requestAccounts. */
  }
  const accounts = (await walletRequest({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts?.[0]
  if (!address || !isAddress(address)) throw new Error('The wallet did not return an account.')
  const checksum = getAddress(address)
  return { address: checksum, ensName: await lookupOwnerEns(checksum) }
}

export async function deploySessionAccount(owner: Address): Promise<Address> {
  await ensureSepolia()
  const data = encodeDeployData({
    abi: sessionWriteAbi,
    bytecode: SESSION_BYTECODE,
    args: [owner],
  })
  const hash = await send({ from: owner, data })
  const receipt = await sepoliaClient().waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('Deploy transaction did not return a contract address.')
  return receipt.contractAddress
}

export async function verifyDeployment(address: Address, owner: Address): Promise<void> {
  const res = await fetch('./api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, owner }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !body.ok) {
    throw new Error(body.error || 'Etherscan did not verify this contract.')
  }
}

export async function fundContract(from: Address, contract: Address, eth: string): Promise<Hash> {
  await ensureSepolia()
  const value = parseEther(eth)
  if (value <= 0n) throw new Error('Enter an amount of ETH to send into the contract.')
  const hash = await send({ from, to: contract, value })
  await sepoliaClient().waitForTransactionReceipt({ hash })
  return hash
}

export async function fundAgent(from: Address, agent: Address, eth: string): Promise<Hash> {
  await ensureSepolia()
  const value = parseEther(eth)
  if (value <= 0n) throw new Error('Enter an amount of ETH for gas.')
  const hash = await send({ from, to: agent, value })
  await sepoliaClient().waitForTransactionReceipt({ hash })
  return hash
}

export async function readContractBalance(contract: Address): Promise<string> {
  const balance = await sepoliaClient().getBalance({ address: contract })
  return formatEther(balance)
}

export async function armContract(opts: {
  from: Address
  contract: Address
  session: Address
  maxValue: bigint
  ttlSeconds: bigint
  targets: Address[]
  selectors: Hex[]
  maxPerCall: bigint
  maxCalls: bigint
  tokens: Address[]
  agentEns: string
}): Promise<void> {
  await ensureSepolia()
  const armData = encodeFunctionData({
    abi: sessionWriteAbi,
    functionName: 'arm',
    args: [
      opts.session,
      opts.maxValue,
      opts.ttlSeconds,
      opts.targets,
      opts.selectors,
      opts.maxPerCall,
      opts.maxCalls,
      opts.tokens,
    ],
  })
  const armHash = await send({ from: opts.from, to: opts.contract, data: armData })
  await sepoliaClient().waitForTransactionReceipt({ hash: armHash })
  if (!opts.agentEns) return
  const nameData = encodeFunctionData({
    abi: sessionWriteAbi,
    functionName: 'setAgentEns',
    args: [opts.agentEns],
  })
  const nameHash = await send({ from: opts.from, to: opts.contract, data: nameData })
  await sepoliaClient().waitForTransactionReceipt({ hash: nameHash })
}

const sessionReadAbi = [
  { type: 'function', name: 'armed', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'sessionKey', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'maxValue', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxPerCall', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxCalls', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'spent', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'calls', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'expiry', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'allowlistedTargets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'allowlistedSelectors',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes4[]' }],
  },
  {
    type: 'function',
    name: 'allowlistedTokens',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'executeSigned',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes' }],
  },
] as const

export async function readLivePolicy(contract: Address): Promise<{
  armed: boolean
  sessionKey: Address
  maxValue: bigint
  maxPerCall: bigint
  maxCalls: number
  spent: bigint
  calls: number
  expiry: number
  targets: string[]
  selectors: string[]
  tokens: string[]
} | null> {
  try {
    const client = sepoliaClient()
    const address = contract
    const abi = sessionReadAbi
    const [armed, sessionKey, maxValue, maxPerCall, maxCalls, spent, calls, expiry, targets, selectors, tokens] =
      await Promise.all([
        client.readContract({ address, abi, functionName: 'armed' }),
        client.readContract({ address, abi, functionName: 'sessionKey' }),
        client.readContract({ address, abi, functionName: 'maxValue' }),
        client.readContract({ address, abi, functionName: 'maxPerCall' }),
        client.readContract({ address, abi, functionName: 'maxCalls' }),
        client.readContract({ address, abi, functionName: 'spent' }),
        client.readContract({ address, abi, functionName: 'calls' }),
        client.readContract({ address, abi, functionName: 'expiry' }),
        client.readContract({ address, abi, functionName: 'allowlistedTargets' }),
        client.readContract({ address, abi, functionName: 'allowlistedSelectors' }),
        client.readContract({ address, abi, functionName: 'allowlistedTokens' }),
      ])
    return {
      armed,
      sessionKey,
      maxValue,
      maxPerCall,
      maxCalls: Number(maxCalls),
      spent,
      calls: Number(calls),
      expiry: Number(expiry),
      targets: targets.map((item) => item.toLowerCase()),
      selectors: selectors.map((item) => item.toLowerCase()),
      tokens: tokens.map((item) => item.toLowerCase()),
    }
  } catch {
    return null
  }
}

/** Agent wallet signs and broadcasts execute(). The owner wallet is not asked. */
export async function executeSessionPayment(opts: {
  contract: Address
  sessionKey: Hex
  to: Address
  value: bigint
  data: Hex
}): Promise<{ hash: Hash; ok: boolean; from: Address }> {
  const session = privateKeyToAccount(opts.sessionKey)
  const client = sepoliaClient()
  const balance = await client.getBalance({ address: session.address })
  if (balance === 0n) {
    throw new Error(
      `Agent wallet ${session.address} has no Sepolia ETH for gas. Send it a little ETH. The payment itself still leaves the contract.`,
    )
  }
  const wallet = createWalletClient({
    account: session,
    chain: sepolia,
    transport: http(EMPTY_CHAIN.rpc),
  })
  const data = encodeFunctionData({
    abi: sessionReadAbi,
    functionName: 'execute',
    args: [opts.to, opts.value, opts.data],
  })
  const hash = await wallet.sendTransaction({ to: opts.contract, data, value: 0n })
  try {
    const receipt = await client.waitForTransactionReceipt({ hash })
    const fromAgent = receipt.from.toLowerCase() === session.address.toLowerCase()
    const toContract = receipt.to?.toLowerCase() === opts.contract.toLowerCase()
    if (!fromAgent || !toContract) {
      throw new Error('That transaction was not sent by the agent wallet to your SessionAccount.')
    }
    return { hash, ok: receipt.status === 'success', from: session.address }
  } catch (err) {
    if (err instanceof Error && err.message.includes('not sent by the agent wallet')) throw err
    return { hash, ok: false, from: session.address }
  }
}
