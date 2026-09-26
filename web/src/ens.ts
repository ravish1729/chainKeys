import { ACCOUNT, OWNER, SESSION_KEY } from './policy'

/** ENSv2 replica: hierarchical registry + Enhanced Access Control + permissioned resolver. */

export const PARENT_NAME = OWNER
export const AGENT_NAME = `agent.${OWNER}`
export const ENS_REGISTRY = '0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432'

export type EnsRole = {
  role: string
  account: string
  on: string
}

export type EnsRecord = {
  key: string
  value: string
  writableBy: 'parent-owner' | 'agent'
}

export type EnsState = {
  parent: string
  agent: string
  active: boolean
  expiry: number
  parentOwner: string
  agentAddress: string
  roles: EnsRole[]
  records: EnsRecord[]
}

export function idleEns(): EnsState {
  return {
    parent: PARENT_NAME,
    agent: AGENT_NAME,
    active: false,
    expiry: 0,
    parentOwner: ACCOUNT,
    agentAddress: '',
    roles: [
      { role: 'owner.admin', account: PARENT_NAME, on: PARENT_NAME },
      { role: 'resolver.write', account: PARENT_NAME, on: PARENT_NAME },
    ],
    records: [
      { key: 'addr', value: ACCOUNT, writableBy: 'parent-owner' },
      { key: 'description', value: 'Chainkeys owner', writableBy: 'parent-owner' },
    ],
  }
}

export function issueAgentSubname(
  expiry: number,
  opts?: { parent?: string; session?: string; account?: string },
): EnsState {
  const parent = opts?.parent || PARENT_NAME
  const session = opts?.session || SESSION_KEY
  const account = opts?.account || ACCOUNT
  const agent = parent.includes('.') ? `agent.${parent.replace(/^agent\./, '')}` : parent
  const registrationKey = `agent-registration[${ENS_REGISTRY}][chainkeys-1]`
  return {
    parent,
    agent,
    active: true,
    expiry,
    parentOwner: account,
    agentAddress: session,
    roles: [
      { role: 'owner.admin', account: parent, on: parent },
      { role: 'resolver.write', account: parent, on: parent },
      { role: 'text.agent-*', account: session, on: agent },
    ],
    records: [
      { key: 'addr', value: session, writableBy: 'parent-owner' },
      { key: registrationKey, value: '1', writableBy: 'agent' },
      { key: 'agent-controller', value: parent, writableBy: 'parent-owner' },
      { key: 'description', value: 'Chainkeys session agent', writableBy: 'agent' },
    ],
  }
}

export function expireEns(state: EnsState): EnsState {
  return { ...state, active: false }
}
