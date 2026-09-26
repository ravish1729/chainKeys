import { createPublicClient, formatEther, http, isAddress, type Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { normalize } from 'viem/ens'

export type ChainConfig = {
  rpc: string
  ensRpc: string
  account: string
  agentName: string
  drainTx: string
  swapTx: string
}

export type LiveEns = {
  name: string
  address: string | null
  description: string | null
  url: string | null
  accountRecord: string | null
  error: string | null
}

export type LiveAccount = {
  armed: boolean
  sessionKey: string
  owner: string
  agentEns: string
  remaining: string
  spent: string
  maxValue: string
  expiry: number
  blockNumber: string
}

const sessionAbi = [
  {
    type: 'function',
    name: 'armed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'sessionKey',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'agentEns',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'remaining',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'spent',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxValue',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'expiry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const EMPTY_CHAIN: ChainConfig = {
  rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  ensRpc: 'https://ethereum-rpc.publicnode.com',
  account: '',
  agentName: '',
  drainTx: '',
  swapTx: '',
}

export function hasAccount(config: ChainConfig): boolean {
  return isAddress(config.account)
}

export function hasName(config: ChainConfig): boolean {
  return config.agentName.includes('.')
}

export async function loadChainConfig(): Promise<ChainConfig> {
  const res = await fetch('./chain.json', { cache: 'no-store' })
  if (!res.ok) return EMPTY_CHAIN
  const body = (await res.json()) as Partial<ChainConfig>
  return {
    rpc: body.rpc || EMPTY_CHAIN.rpc,
    ensRpc: body.ensRpc || EMPTY_CHAIN.ensRpc,
    account: (body.account || '').trim(),
    agentName: (body.agentName || '').trim(),
    drainTx: (body.drainTx || '').trim(),
    swapTx: (body.swapTx || '').trim(),
  }
}

function clientFor(rpc: string) {
  return createPublicClient({
    chain: sepolia,
    transport: http(rpc),
  })
}

export async function readAccount(config: ChainConfig): Promise<LiveAccount> {
  const client = clientFor(config.rpc)
  const account = config.account as Address
  const [armed, sessionKey, owner, agentEns, remaining, spent, maxValue, expiry, blockNumber] =
    await Promise.all([
      client.readContract({ address: account, abi: sessionAbi, functionName: 'armed' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'sessionKey' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'owner' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'agentEns' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'remaining' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'spent' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'maxValue' }),
      client.readContract({ address: account, abi: sessionAbi, functionName: 'expiry' }),
      client.getBlockNumber(),
    ])
  return {
    armed,
    sessionKey,
    owner,
    agentEns,
    remaining: formatEther(remaining),
    spent: formatEther(spent),
    maxValue: formatEther(maxValue),
    expiry: Number(expiry),
    blockNumber: blockNumber.toString(),
  }
}

export async function readEns(config: ChainConfig): Promise<LiveEns> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(config.ensRpc),
  })
  const name = normalize(config.agentName)
  try {
    const [address, description, url, accountRecord] = await Promise.all([
      client.getEnsAddress({ name }),
      client.getEnsText({ name, key: 'description' }).catch(() => null),
      client.getEnsText({ name, key: 'url' }).catch(() => null),
      client.getEnsText({ name, key: 'agent-account' }).catch(() => null),
    ])
    return { name, address, description, url, accountRecord, error: null }
  } catch (err) {
    return {
      name,
      address: null,
      description: null,
      url: null,
      accountRecord: null,
      error: err instanceof Error ? err.message : 'ENS resolution failed',
    }
  }
}

export function etherscanAddress(addr: string): string {
  return `https://sepolia.etherscan.io/address/${addr}`
}

export function etherscanReadContract(addr: string): string {
  return `${etherscanAddress(addr)}#readContract`
}

export function mainnetAddress(addr: string): string {
  return `https://etherscan.io/address/${addr}`
}

export function etherscanTx(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`
}

export function ensApp(name: string): string {
  return `https://app.ens.domains/${name}`
}
