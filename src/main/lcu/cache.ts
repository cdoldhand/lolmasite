import type { ParticipantRecentForm } from '../types.js'

type CacheEntry = {
  data: ParticipantRecentForm
  timestamp: number
}

const CACHE_TTL = 30 * 60 * 1000

const cache = new Map<string, CacheEntry>()

export function recentFormCacheGet(puuid: string): ParticipantRecentForm | null {
  const entry = cache.get(puuid)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(puuid)
    return null
  }
  console.log(`[Cache] HIT: ${puuid.substring(0, 8)}...  (剩余 ${Math.round((CACHE_TTL - (Date.now() - entry.timestamp)) / 1000)}s)`)
  return entry.data
}

export function recentFormCacheSet(puuid: string, data: ParticipantRecentForm): void {
  cache.set(puuid, { data, timestamp: Date.now() })
  console.log(`[Cache] SET: ${puuid.substring(0, 8)}... (${cache.size} entries)`)
}

export function recentFormCacheClear(): void {
  cache.clear()
}