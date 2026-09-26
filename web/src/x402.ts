/**
 * x402 payment the agent would sign. Intercepta screens this *before* the session key signs.
 * Format follows the exact scheme: payTo + asset + maxAmountRequired.
 */

export type X402Payment = {
  scheme: 'exact'
  network: 'eip155:1'
  maxAmountRequired: string
  resource: string
  description: string
  payTo: string
  asset: string
  maxTimeoutSeconds: number
  extra: { selector: string; from: string }
}

export const NATIVE_ASSET = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
