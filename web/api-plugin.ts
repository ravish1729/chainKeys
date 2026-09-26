import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleScreen } from './api/_lib.ts'
import { handleVerify } from './api/verify.ts'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(json)
}

async function api(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = (req.url || '').split('?')[0]
  if (!url.startsWith('/api/')) {
    next()
    return
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  try {
    if (url === '/api/screen' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      await send(res, 200, await handleScreen(body))
      return
    }
    if (url === '/api/verify' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      await send(res, 200, await handleVerify(body))
      return
    }
    next()
  } catch (err) {
    await send(res, 500, { error: err instanceof Error ? err.message : 'api error' })
  }
}

export function chainkeysApi(): Plugin {
  return {
    name: 'chainkeys-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void api(req, res, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void api(req, res, next)
      })
    },
  }
}
