import { Agent, fetch } from 'undici'
import { readLcuCredentials } from './auth.js'
import type { LcuCredentials } from '../types.js'

export class LcuRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string
  ) {
    super(`LCU 请求失败：${status} ${statusText}${body ? ` - ${formatLcuErrorBody(body)}` : ''}`)
  }
}

export class LcuClient {
  private readonly credentials: LcuCredentials
  private readonly dispatcher = new Agent({ connect: { rejectUnauthorized: false } })

  constructor(leagueDir?: string) {
    this.credentials = readLcuCredentials(leagueDir)
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.credentials.protocol}://127.0.0.1:${this.credentials.port}${path}`
    const authorization = Buffer.from(`riot:${this.credentials.password}`).toString('base64')
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(25000)
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new LcuRequestError(response.status, response.statusText, body)
    }

    return response.json() as Promise<T>
  }
}

function formatLcuErrorBody(body: string) {
  if (!body.trim()) return ''

  try {
    const json = JSON.parse(body) as { message?: string; error?: string; errorCode?: string }
    return json.message || json.error || json.errorCode || ''
  } catch {
    return body
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
  }
}
