import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { URL, pathToFileURL } from 'node:url'
import { analyzeWithAi, type AiConfig } from './ai/client.js'
import { buildEloSnapshot } from './analysis/elo.js'
import { getCurrentSummoner, getRecentMatches, hydrateParticipantRecentForms, type RecentMatchesProgress } from './lcu/matches.js'
import { LcuClient } from './lcu/client.js'
import { detectLeagueClient } from './lcu/auth.js'
import type { RecentMatchesPayload } from './types.js'

const port = Number(process.env.PORT || 4177)

export async function startApiServer(port = Number(process.env.PORT || 4177), staticRoot?: string): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, staticRoot)
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? `${error.message}${'cause' in error && error.cause ? `：${String(error.cause)}` : ''}` : String(error)
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      console.log(`lolmasite API: http://127.0.0.1:${actualPort}`)
      resolve()
    })
  })

  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startApiServer(port)
}

async function route(request: IncomingMessage, response: ServerResponse, staticRoot?: string) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`)

  if (request.method === 'GET' && url.pathname === '/api/detect-league-client') {
    const leagueDir = url.searchParams.get('leagueDir') || undefined
    sendJson(response, 200, { ok: true, data: detectLeagueClient(leagueDir) })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/current-summoner') {
    const leagueDir = url.searchParams.get('leagueDir') || undefined
    sendJson(response, 200, { ok: true, data: await getCurrentSummoner(leagueDir) })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/recent-matches') {
    const limit = Number(url.searchParams.get('limit') || 20)
    const recentFormLimit = 10
    const leagueDir = url.searchParams.get('leagueDir') || undefined
    const payload = await getRecentMatches(limit, leagueDir)
    const client = new LcuClient(leagueDir)
    const hydratedMatches = await hydrateParticipantRecentForms(client, payload.matches, { limit: recentFormLimit })
    sendJson(response, 200, { ok: true, data: buildEloSnapshot({ ...payload, matches: hydratedMatches }) })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/recent-matches-progress') {
    const limit = Number(url.searchParams.get('limit') || 20)
    const recentFormLimit = 10
    const leagueDir = url.searchParams.get('leagueDir') || undefined
    sendProgress(response)
    try {
      const payload = await getRecentMatches(limit, leagueDir, {
        onProgress: (progress) => writeProgress(response, { ok: true, progress })
      })
      const client = new LcuClient(leagueDir)
      const hydratedMatches = await hydrateParticipantRecentForms(client, payload.matches, {
        limit: recentFormLimit,
        onProgress: (progress) => writeProgress(response, { ok: true, progress }),
        onPlayerResolved: (matches) => writeProgress(response, { ok: true, progress: { phase: '数据更新', current: payload.matches.length, total: payload.matches.length }, data: buildEloSnapshot({ ...payload, matches }) })
      })
      writeProgress(response, { ok: true, progress: { phase: '完成', current: payload.matches.length, total: payload.matches.length }, data: buildEloSnapshot({ ...payload, matches: hydratedMatches }) })
      response.end()
    } catch (error) {
      writeProgress(response, {
        ok: false,
        error: error instanceof Error ? `${error.message}${'cause' in error && error.cause ? `：${String(error.cause)}` : ''}` : String(error)
      })
      response.end()
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/analyze') {
    const body = await readJson<{ config: AiConfig; payload: RecentMatchesPayload }>(request)
    const data = await analyzeWithAi(body.config, buildEloSnapshot(body.payload))
    sendJson(response, 200, { ok: true, data })
    return
  }

  if (staticRoot && request.method === 'GET') {
    await sendStaticFile(response, staticRoot, url.pathname)
    return
  }

  sendJson(response, 404, { ok: false, error: '接口不存在。' })
}

function sendProgress(response: ServerResponse) {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
}

function writeProgress(response: ServerResponse, body: { ok: boolean; progress?: RecentMatchesProgress; data?: unknown; error?: string }) {
  response.write(`${JSON.stringify(body)}\n`)
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
  response.end(JSON.stringify(body))
}

async function sendStaticFile(response: ServerResponse, staticRoot: string, pathname: string) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const filePath = normalize(join(staticRoot, relativePath))
  const rootPath = normalize(staticRoot)

  if (!filePath.startsWith(rootPath)) {
    sendJson(response, 403, { ok: false, error: '禁止访问。' })
    return
  }

  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('not a file')
    response.writeHead(200, { 'Content-Type': contentType(filePath) })
    createReadStream(filePath).pipe(response)
  } catch {
    sendJson(response, 404, { ok: false, error: '文件不存在。' })
  }
}

function contentType(filePath: string) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}
