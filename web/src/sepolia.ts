import { createPublicClient, formatEther, http, isAddress, keccak256, toHex, type Address, type PublicClient } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { namehash, normalize } from 'viem/ens'

export type ChainConfig = {
  rpc: string
  ensRpc: string
  account: string
  agentName: string
  drainTx: string
  swapTx: string
}

export type EnsNetwork = 'mainnet' | 'sepolia'

/** Sepolia subname under the name registered for this demo. The address record is the contract. */
export const SEPOLIA_SUBNAME_EXAMPLE = 'agent.chainkeys.eth'

export type LiveEns = {
  name: string
  network: EnsNetwork
  exists: boolean
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

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
const ETH_REGISTRY_V2 = '0x657ea849311d3d5823348dded7c2aaafb3ede09e' as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const registryAbi = [
  {
    type: 'function',
    name: 'recordExists',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const registryV2Abi = [
  {
    type: 'function',
    name: 'getSubregistry',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getOwner',
    stateMutability: 'view',
    inputs: [{ name: 'anyId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

/** Sepolia names live on ENSv2. The legacy registry does not see them. */
async function sepoliaV2Registered(client: PublicClient, name: string): Promise<boolean> {
  const labels = name.split('.').filter(Boolean)
  if (labels.length < 2 || labels[labels.length - 1] !== 'eth') return false
  const parts = labels.slice(0, -1).reverse()
  let registry: Address = ETH_REGISTRY_V2
  for (let i = 0; i < parts.length; i += 1) {
    const label = parts[i]
    const last = i === parts.length - 1
    if (last) {
      const owner = await client.readContract({
        address: registry,
        abi: registryV2Abi,
        functionName: 'getOwner',
        args: [BigInt(keccak256(toHex(label)))],
      })
      return owner.toLowerCase() !== ZERO_ADDRESS
    }
    const next = await client.readContract({
      address: registry,
      abi: registryV2Abi,
      functionName: 'getSubregistry',
      args: [label],
    })
    if (next.toLowerCase() === ZERO_ADDRESS) return false
    registry = next
  }
  return false
}

export async function readEns(config: ChainConfig, network: EnsNetwork = 'mainnet'): Promise<LiveEns> {
  const chain = network === 'sepolia' ? sepolia : mainnet
  const rpc = network === 'sepolia' ? config.rpc : config.ensRpc
  const client = createPublicClient({ chain, transport: http(rpc) })
  const name = normalize(config.agentName)
  const empty = {
    name,
    network,
    exists: false,
    address: null,
    description: null,
    url: null,
    accountRecord: null,
  }
  try {
    const exists =
      network === 'sepolia'
        ? await sepoliaV2Registered(client, name).catch(() => false)
        : await client
            .readContract({
              address: ENS_REGISTRY,
              abi: registryAbi,
              functionName: 'recordExists',
              args: [namehash(name)],
            })
            .catch(() => false)
    const [address, description, url, accountRecord] = await Promise.all([
      client.getEnsAddress({ name }),
      client.getEnsText({ name, key: 'description' }).catch(() => null),
      client.getEnsText({ name, key: 'url' }).catch(() => null),
      client.getEnsText({ name, key: 'agent-account' }).catch(() => null),
    ])
    return { ...empty, exists, address, description, url, accountRecord, error: null }
  } catch (err) {
    return {
      ...empty,
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

export function ensApp(name: string, network: EnsNetwork = 'mainnet'): string {
  const host = network === 'sepolia' ? 'https://app.ens.dev' : 'https://app.ens.domains'
  return `${host}/${name}`
}
