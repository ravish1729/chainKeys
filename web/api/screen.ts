import { handleScreen } from './_lib.ts'

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }
) {
  if (req.method && req.method !== 'POST') {
    res.statusCode = 405
    res.end('')
    return
  }
  const out = await handleScreen((req.body ?? {}) as Parameters<typeof handleScreen>[0])
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(out))
}
