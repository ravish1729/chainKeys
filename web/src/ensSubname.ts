import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  http,
  keccak256,
  toHex,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { ensureSepolia } from './chainActions'
import { EMPTY_CHAIN, SEPOLIA_SUBNAME_EXAMPLE } from './sepolia'
import { walletRequest } from './wallet'

const ETH_REGISTRY = '0x657ea849311d3d5823348dded7c2aaafb3ede09e' as const
const FACTORY = '0x9e726eb570beb6bceb495ab8cda7df517d4e841c' as const
const USER_REGISTRY_IMPL = '0xa80338aaa8d23831cea25e858d1774534abb0263' as const
const PARENT = 'chainkeys.eth'
const LABEL = 'agent'
const ALL_ROLES = BigInt(`0x${'1'.repeat(64)}`)
const ZERO = '0x0000000000000000000000000000000000000000' as const

const registryAbi = [
  {
    type: 'function',
    name: 'getSubregistry',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getResolver',
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
  {
    type: 'function',
    name: 'getExpiry',
    stateMutability: 'view',
    inputs: [{ name: 'anyId', type: 'uint256' }],
    outputs: [{ type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'setSubregistry',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'anyId', type: 'uint256' },
      { name: 'registry', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

const factoryAbi = [
  {
    type: 'function',
    name: 'deployProxy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'ProxyDeployed',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'proxyAddress', type: 'address', indexed: true },
      { name: 'salt', type: 'uint256', indexed: false },
      { name: 'implementation', type: 'address', indexed: false },
    ],
  },
] as const

const registryInitAbi = [
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'grants',
        type: 'tuple[]',
        components: [
          { name: 'account', type: 'address' },
          { name: 'roleBitmap', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
] as const

const resolverWriteAbi = [
  {
    type: 'function',
    name: 'setAddress',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'coinType', type: 'uint256' },
      { name: 'addressBytes', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'calls', type: 'bytes[]' }],
    outputs: [{ type: 'bytes[]' }],
  },
] as const

const ETH_COIN_TYPE = 60n

function client() {
  return createPublicClient({ chain: sepolia, transport: http(EMPTY_CHAIN.rpc) })
}

function labelId(label: string): bigint {
  return BigInt(keccak256(toHex(label)))
}

const REGISTRY_SALT = 1n

async function send(from: Address, to: Address, data: Hex): Promise<Hash> {
  return (await walletRequest({
    method: 'eth_sendTransaction',
    params: [{ from, to, data }],
  })) as Hash
}

async function wait(hash: Hash) {
  const receipt = await client().waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The Sepolia transaction reverted.')
  return receipt
}

function proxyCreationCode(logic: Address, salt: Hex): Hex {
  return `0x3d604d80600a3d3981f3363d3d373d3d3d363d73${logic.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3${salt.slice(2)}`
}

function predictProxy(sender: Address, userSalt: bigint, proxyLogic: Address): Address {
  const outerSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [sender, userSalt]))
  return getCreate2Address({
    from: FACTORY,
    salt: outerSalt,
    bytecode: proxyCreationCode(proxyLogic, outerSalt),
  })
}

async function sendAndWait(from: Address, to: Address, data: Hex) {
  await wait(await send(from, to, data))
}

export async function createAgentSubname(opts: {
  owner: Address
  contract: Address
  onStep?: (step: string) => void
}): Promise<{ name: string }> {
  await ensureSepolia()
  const step = opts.onStep ?? (() => undefined)
  const publicClient = client()
  const parentId = labelId('chainkeys')
  const owner = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: 'getOwner',
    args: [parentId],
  })
  if (owner.toLowerCase() !== opts.owner.toLowerCase()) {
    throw new Error(`Connect ${owner}. That wallet owns ${PARENT} on Sepolia.`)
  }

  let subregistry = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: 'getSubregistry',
    args: ['chainkeys'],
  })
  if (subregistry === ZERO) {
    const proxyLogic = await publicClient.readContract({
      address: FACTORY,
      abi: [{ type: 'function', name: 'proxyLogic', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const,
      functionName: 'proxyLogic',
    })
    const initData = encodeFunctionData({
      abi: registryInitAbi,
      functionName: 'initialize',
      args: [[{ account: opts.owner, roleBitmap: ALL_ROLES }]],
    })
    subregistry = predictProxy(opts.owner, REGISTRY_SALT, proxyLogic)
    step('Confirm the subname registry…')
    await sendAndWait(
      opts.owner,
      FACTORY,
      encodeFunctionData({
        abi: factoryAbi,
        functionName: 'deployProxy',
        args: [USER_REGISTRY_IMPL, REGISTRY_SALT, initData],
      }),
    )
    step('Confirm attaching it to chainkeys.eth…')
    await sendAndWait(
      opts.owner,
      ETH_REGISTRY,
      encodeFunctionData({
        abi: registryAbi,
        functionName: 'setSubregistry',
        args: [parentId, subregistry],
      }),
    )
  }

  const parentResolver = await publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: 'getResolver',
    args: ['chainkeys'],
  })
  if (parentResolver === ZERO) throw new Error('chainkeys.eth has no resolver on Sepolia.')

  let resolver = await publicClient.readContract({
    address: subregistry,
    abi: registryAbi,
    functionName: 'getResolver',
    args: [LABEL],
  })
  if (resolver === ZERO) {
    const expiry = await publicClient.readContract({
      address: ETH_REGISTRY,
      abi: registryAbi,
      functionName: 'getExpiry',
      args: [parentId],
    })
    step(`Confirm registration of ${SEPOLIA_SUBNAME_EXAMPLE}…`)
    await sendAndWait(
      opts.owner,
      subregistry,
      encodeFunctionData({
        abi: registryAbi,
        functionName: 'register',
        args: [LABEL, opts.owner, ZERO, parentResolver, ALL_ROLES, expiry],
      }),
    )
    resolver = parentResolver
  }

  const dns = toHex(packetToBytes(SEPOLIA_SUBNAME_EXAMPLE))
  const setAddress = encodeFunctionData({
    abi: resolverWriteAbi,
    functionName: 'setAddress',
    args: [dns, ETH_COIN_TYPE, opts.contract],
  })
  const setText = encodeFunctionData({
    abi: resolverWriteAbi,
    functionName: 'setText',
    args: [dns, 'agent-account', opts.contract],
  })
  step('Confirm the address record…')
  await sendAndWait(
    opts.owner,
    resolver,
    encodeFunctionData({
      abi: resolverWriteAbi,
      functionName: 'multicall',
      args: [[setAddress, setText]],
    }),
  )
  return { name: SEPOLIA_SUBNAME_EXAMPLE }
}

export function subnameEnsApp(): string {
  return `https://app.ens.dev/${SEPOLIA_SUBNAME_EXAMPLE}`
}
