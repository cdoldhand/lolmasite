import { LcuClient, LcuRequestError } from './client.js'
import type { ChampionInfo, CurrentSummoner, MatchSummary, Participant, ParticipantRankedStats, ParticipantRecentForm, RecentMatchesPayload, RankedQueueStats } from '../types.js'
import { recentFormCacheGet, recentFormCacheSet } from './cache.js'

type RawMatchHistory = {
  games?: {
    games?: RawGame[]
  }
}

type RawParticipantIdentityPlayer = {
  gameName?: string
  summonerName?: string
  tagLine?: string
  puuid?: string
  summonerId?: number
}

type RawGameDetail = RawGame & {
  participantIdentities?: Array<{
    participantId?: number
    player?: RawParticipantIdentityPlayer
  }>
}

type RawGame = {
  gameId: number
  queueId?: number
  gameCreationDate?: string | number
  gameDuration?: number
  participants?: RawParticipant[]
}

type RawParticipant = {
  participantId?: number
  championId?: number
  championName?: string
  teamId?: number
  summonerName?: string
  riotIdGameName?: string
  riotIdTagline?: string
  gameName?: string
  tagLine?: string
  summonerId?: number
  summonerPuuid?: string
  puuid?: string
  profileIcon?: number
  individualPosition?: string
  teamPosition?: string
  playerSubteamId?: number
  premadeTeamId?: number
  subteamPlacement?: number
  timeline?: {
    lane?: string
    role?: string
  }
  stats?: {
    kills?: number
    deaths?: number
    assists?: number
    win?: boolean
    totalDamageDealtToChampions?: number
    goldEarned?: number
    totalMinionsKilled?: number
    neutralMinionsKilled?: number
  }
}

type RawSummoner = {
  puuid?: string
  summonerId?: number
}

type RawSummonerAlias = {
  puuid?: string
  gameName?: string
  tagLine?: string
  summonerId?: number
}

type RawChampionSummaryItem = {
  id: number
  name: string
  alias?: string
  squarePortraitPath?: string
}

type RawChampionSummary = RawChampionSummaryItem[] | {
  champions?: RawChampionSummaryItem[]
}

type RawRankedStats = {
  queues?: RawRankedQueue[]
}

type RawRankedQueue = {
  queueType?: string
  tier?: string
  division?: string
  rank?: string
  leaguePoints?: number
  wins?: number
  losses?: number
}

const soloQueueIds = [420]
const soloQueueIdSet = new Set(soloQueueIds)
const matchDetailConcurrency = 4
const recentFormConcurrency = 2

export type RecentMatchesProgress = {
  phase: string
  current: number
  total: number
}

type RecentFormResult = {
  form?: ParticipantRecentForm
  rankedStats?: ParticipantRankedStats
  error?: string
}

type RecentMatchesOptions = {
  onProgress?: (progress: RecentMatchesProgress) => void
}

type HydrateParticipantRecentFormsOptions = {
  limit: number
  onProgress?: (progress: RecentMatchesProgress) => void
  onPlayerResolved?: (matches: MatchSummary[]) => void
}

export async function getCurrentSummoner(leagueDir?: string) {
  const client = new LcuClient(leagueDir)
  return client.get<CurrentSummoner>('/lol-summoner/v1/current-summoner')
}

export async function getRecentMatches(limit = 20, leagueDir?: string, options: RecentMatchesOptions = {}): Promise<RecentMatchesPayload> {
  const client = new LcuClient(leagueDir)
  options.onProgress?.({ phase: '正在检测账号', current: 0, total: limit })
  const summoner = await client.get<CurrentSummoner>('/lol-summoner/v1/current-summoner')
  options.onProgress?.({ phase: '正在读取战绩列表', current: 0, total: limit })
  const { games } = await fetchRankedMatchHistory(client, 'current-summoner', limit)
  if (!games.length) throw new Error('最近战绩里没有找到排位赛记录。')
  options.onProgress?.({ phase: '正在读取英雄数据', current: 0, total: games.length })
  const championMap = await getChampionMap(client)
  const matches = await mapWithConcurrency(games, matchDetailConcurrency, async (game, index) => {
    options.onProgress?.({ phase: `正在读取第 ${index + 1}/${games.length} 场详情`, current: index, total: games.length })
    const detail = await client.get<RawGameDetail>(`/lol-match-history/v1/games/${game.gameId}`)
      .catch(() => client.get<RawGameDetail>(`/lol-match-history/v1/products/lol/current-summoner/matches/${game.gameId}`))
      .catch(() => game)
    options.onProgress?.({ phase: `已读取第 ${index + 1}/${games.length} 场详情`, current: index + 1, total: games.length })
    return normalizeMatch(withGameListMetadata(game, detail), summoner.puuid, summoner.displayName || summoner.gameName, championMap)
  })

  options.onProgress?.({ phase: `已读取 ${matches.length} 场单双排胜负数据`, current: matches.length, total: matches.length })

  return {
    summoner,
    matches,
    championMap,
    stats: calculateStats(matches)
  }
}

function withGameListMetadata(game: RawGame, detail: RawGameDetail): RawGameDetail {
  return {
    ...detail,
    gameCreationDate: detail.gameCreationDate ?? game.gameCreationDate,
    gameDuration: detail.gameDuration ?? game.gameDuration,
    queueId: detail.queueId ?? game.queueId
  }
}

function normalizeMatch(game: RawGameDetail, currentPuuid?: string, currentName?: string, championMap: Record<number, ChampionInfo> = {}): MatchSummary {
  const participants = applyPremadeGroups(applyPositionFallbacks((game.participants ?? []).map((participant) => normalizeParticipant(participant, game.participantIdentities, championMap))))
  const current = participants.find((participant) => participant.puuid === currentPuuid)
    ?? participants.find((participant) => sameSummonerName(participant.summonerName, currentName))
    ?? participants.find((participant) => participant.championId && participant.championId === game.participants?.[0]?.championId && participant.kills === (game.participants?.[0]?.stats?.kills ?? -1))
    ?? participants[0]
  const kills = current?.kills ?? 0
  const deaths = current?.deaths ?? 0
  const assists = current?.assists ?? 0

  return {
    gameId: game.gameId,
    queueId: game.queueId,
    gameCreationDate: game.gameCreationDate === undefined ? undefined : String(game.gameCreationDate),
    gameDuration: game.gameDuration,
    championId: current?.championId,
    championName: current?.championName,
    win: current?.win ?? false,
    kills,
    deaths,
    assists,
    kda: deaths === 0 ? kills + assists : Number(((kills + assists) / deaths).toFixed(2)),
    participants
  }
}

function sameSummonerName(left?: string, right?: string) {
  if (!left || !right) return false
  const leftKey = normalizeNameKey(left)
  const rightKey = normalizeNameKey(right)
  return leftKey === rightKey || leftKey.split('#')[0] === rightKey.split('#')[0]
}

function normalizeParticipant(
  participant: RawParticipant,
  identities: RawGameDetail['participantIdentities'] = [],
  championMap: Record<number, ChampionInfo> = {}
): Participant {
  const stats = participant.stats ?? {}
  const identity = identities.find((item) => item.participantId === participant.participantId)?.player
  const gameName = participant.riotIdGameName || participant.gameName || identity?.gameName
  const tagLine = participant.riotIdTagline || participant.tagLine || identity?.tagLine
  const summonerName = gameName && tagLine ? `${gameName}#${tagLine}` : participant.summonerName || identity?.summonerName
  const championName = participant.championName || (participant.championId ? championMap[participant.championId]?.name : undefined)
  const position = formatPosition(participant.individualPosition || participant.teamPosition) ?? formatTimelinePosition(participant.timeline?.lane, participant.timeline?.role)
  return {
    summonerName,
    puuid: participant.puuid || participant.summonerPuuid || identity?.puuid,
    summonerId: participant.summonerId ?? identity?.summonerId,
    championId: participant.championId,
    championName,
    teamId: participant.teamId,
    participantId: participant.participantId,
    playerSubteamId: participant.playerSubteamId ?? participant.premadeTeamId ?? participant.subteamPlacement,
    lane: participant.timeline?.lane,
    role: participant.timeline?.role,
    position,
    kills: stats.kills ?? 0,
    deaths: stats.deaths ?? 0,
    assists: stats.assists ?? 0,
    win: stats.win ?? false,
    totalDamageDealtToChampions: stats.totalDamageDealtToChampions,
    goldEarned: stats.goldEarned,
    totalMinionsKilled: stats.totalMinionsKilled,
    neutralMinionsKilled: stats.neutralMinionsKilled
  }
}

function applyPremadeGroups(participants: Participant[]) {
  const grouped = new Map<string, Participant[]>()
  for (const participant of participants) {
    if (participant.teamId === undefined || participant.playerSubteamId === undefined || participant.playerSubteamId <= 0) continue
    const key = `${participant.teamId}:${participant.playerSubteamId}`
    grouped.set(key, [...(grouped.get(key) ?? []), participant])
  }

  const labels = new Map<Participant, string>()
  const sizes = new Map<Participant, number>()
  for (const [, group] of grouped) {
    if (group.length !== 2) continue
    const side = group[0].teamId === 100 ? '蓝方' : group[0].teamId === 200 ? '红方' : `队伍${group[0].teamId}`
    const label = `${side}双排`
    for (const participant of group) {
      labels.set(participant, label)
      sizes.set(participant, group.length)
    }
  }

  return participants.map((participant) => {
    const premadeGroup = labels.get(participant)
    return premadeGroup ? { ...participant, premadeGroup, premadeGroupSize: sizes.get(participant) } : participant
  })
}

function applyPositionFallbacks(participants: Participant[]) {
  const withFallbacks = participants.map((participant, index) => {
    if (participant.position) return participant
    const teamSlot = participant.teamId === undefined
      ? undefined
      : participants.filter((teammate) => teammate.teamId === participant.teamId).findIndex((teammate) => teammate === participant) + 1
    const position = positionFromParticipantId(participant.participantId) ?? positionFromSlot(teamSlot ?? 0) ?? positionFromTeamOrder(index)
    return position ? { ...participant, position } : participant
  })

  return fixDuplicateTeamPositions(withFallbacks)
}

function fixDuplicateTeamPositions(participants: Participant[]) {
  const byTeam = new Map<number, Participant[]>()
  for (const participant of participants) {
    if (participant.teamId === undefined) continue
    byTeam.set(participant.teamId, [...(byTeam.get(participant.teamId) ?? []), participant])
  }

  const corrected = new Map<Participant, string>()
  for (const [, team] of byTeam) {
    const counts = new Map<string, number>()
    for (const participant of team) {
      if (!participant.position) continue
      counts.set(participant.position, (counts.get(participant.position) ?? 0) + 1)
    }

    const missing = positionOrder.filter((position) => !counts.has(position))
    if (!missing.length) continue

    for (const participant of team) {
      if (!participant.position || (counts.get(participant.position) ?? 0) <= 1) continue
      const slotPosition = positionFromParticipantId(participant.participantId)
      if (slotPosition && missing.includes(slotPosition)) {
        corrected.set(participant, slotPosition)
        counts.set(participant.position, (counts.get(participant.position) ?? 1) - 1)
        counts.set(slotPosition, 1)
        missing.splice(missing.indexOf(slotPosition), 1)
      }
    }
  }

  return participants.map((participant) => {
    const position = corrected.get(participant)
    return position ? { ...participant, position } : participant
  })
}

const positionOrder = ['上单', '打野', '中单', '下路AD', '辅助']

function positionFromParticipantId(participantId?: number) {
  if (!participantId) return undefined
  const slot = ((participantId - 1) % 5) + 1
  return positionFromSlot(slot)
}

function positionFromTeamOrder(index: number) {
  return positionFromSlot((index % 5) + 1)
}

function positionFromSlot(slot: number) {
  if (slot === 1) return '上单'
  if (slot === 2) return '打野'
  if (slot === 3) return '中单'
  if (slot === 4) return '下路AD'
  if (slot === 5) return '辅助'
  return undefined
}

function formatPosition(position?: string) {
  const normalized = position?.toUpperCase()
  if (!normalized || normalized === 'INVALID' || normalized === 'NONE') return undefined
  if (normalized === 'TOP') return '上单'
  if (normalized === 'JUNGLE') return '打野'
  if (normalized === 'MIDDLE' || normalized === 'MID') return '中单'
  if (normalized === 'BOTTOM' || normalized === 'BOT' || normalized === 'ADC' || normalized === 'DUO_CARRY' || normalized === 'BOTTOM/CARRY') return '下路AD'
  if (normalized === 'UTILITY' || normalized === 'SUPPORT' || normalized === 'DUO_SUPPORT' || normalized === 'BOTTOM/SUPPORT') return '辅助'
  return position
}

function formatTimelinePosition(lane?: string, role?: string) {
  const normalizedLane = lane?.toUpperCase()
  const normalizedRole = role?.toUpperCase()
  if (normalizedLane === 'BOTTOM' && (normalizedRole === 'DUO_CARRY' || normalizedRole === 'CARRY')) return '下路AD'
  if (normalizedLane === 'BOTTOM' && (normalizedRole === 'DUO_SUPPORT' || normalizedRole === 'SUPPORT')) return '辅助'
  if (normalizedLane === 'JUNGLE') return '打野'
  if (normalizedLane === 'MIDDLE' || normalizedLane === 'MID') return '中单'
  if (normalizedLane === 'TOP') return '上单'
  return lane || role ? formatPosition([lane, role].filter(Boolean).join('/')) : undefined
}

async function getChampionMap(client: LcuClient): Promise<Record<number, ChampionInfo>> {
  const summary = await client.get<RawChampionSummary>('/lol-game-data/assets/v1/champion-summary.json').catch(() => [])
  const champions = Array.isArray(summary) ? summary : summary.champions ?? []
  return Object.fromEntries(champions.map((champion) => [champion.id, champion]))
}

export async function hydrateParticipantRecentForms(client: LcuClient, matches: MatchSummary[], options: HydrateParticipantRecentFormsOptions) {
  const resultCache = new Map<string, RecentFormResult>()
  const requestCache = new Map<string, Promise<RecentFormResult>>()
  const { limit, onProgress, onPlayerResolved } = options
  const currentMatchForms = buildCurrentMatchRecentForms(matches, limit)
  const matchesToHydrate = matches
  const entries = matchesToHydrate.flatMap((match) => match.participants.map((participant) => {
    const key = participantFormKey(participant)
    return key ? { key, matchKey: `${match.gameId}:${key}`, requestKey: `${key}:${match.gameCreationDate ?? ''}:${limit}`, match, participant } : null
  }).filter(Boolean) as Array<{ key: string; matchKey: string; requestKey: string; match: MatchSummary; participant: Participant }>)
  const total = matchesToHydrate.length + entries.length

  const buildPartialMatches = () => matches.map((match) => ({
    ...match,
    participants: match.participants.map((participant) => {
      const key = participantFormKey(participant)
      const result = key ? resultCache.get(`${match.gameId}:${key}`) ?? (currentMatchForms.has(key) ? { form: currentMatchForms.get(key) } : null) : null
      return {
        ...participant,
        ...(result?.form ? { recentForm: result.form } : result?.error ? { recentFormError: result.error } : {}),
        ...(result?.rankedStats ? { rankedStats: result.rankedStats } : {})
      }
    })
  }))

  onProgress?.({ phase: `正在分析双方玩家开局前状态 0/${entries.length}`, current: matchesToHydrate.length, total })

  let completed = 0

  await runWithConcurrency(entries, recentFormConcurrency, async ({ key, matchKey, requestKey, match, participant }) => {
    let request = requestCache.get(requestKey)
    if (!request) {
      request = getParticipantRecentForm(client, participant, limit, match.gameCreationDate)
        .then((form) => form ? { form } : { error: '历史战绩为空或详情无法匹配该玩家' })
        .catch((error) => {
          console.log(`[RecentForm] ${participant.summonerName} 失败: ${error instanceof Error ? error.message : String(error)}`)
          const fallback = buildVisibleRecentForm(matches, key, match.gameCreationDate, limit) ?? currentMatchForms.get(key)
          return fallback ? { form: fallback } : { error: formatRecentFormError(error) }
        })
      requestCache.set(requestKey, request)
    }
    resultCache.set(matchKey, await request)
    completed += 1
    onProgress?.({ phase: `正在分析双方玩家开局前状态 ${completed}/${entries.length}`, current: matchesToHydrate.length + completed, total })
    onPlayerResolved?.(buildPartialMatches())
  })

  return buildPartialMatches()
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      const item = items[currentIndex]
      index += 1
      if (item === undefined) continue
      results[currentIndex] = await worker(item, currentIndex)
    }
  })
  await Promise.all(workers)
  return results
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  await mapWithConcurrency(items, concurrency, async (item) => {
    await worker(item)
  })
}

function buildCurrentMatchRecentForms(matches: MatchSummary[], limit: number) {
  const grouped = new Map<string, Array<{ win: boolean; kills: number; deaths: number; assists: number; kda: number; gameId: number }>>()
  for (const match of matches) {
    for (const participant of match.participants) {
      const key = participantFormKey(participant)
      if (!key) continue
      const summaries = grouped.get(key) ?? []
      summaries.push({
        win: participant.win,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        kda: kdaScore(participant),
        gameId: match.gameId
      })
      grouped.set(key, summaries)
    }
  }

  const forms = new Map<string, ParticipantRecentForm>()
  for (const [key, summaries] of grouped) {
    const limited = summaries.slice(0, limit)
    if (!limited.length) continue
    forms.set(key, summarizeRecentForm(limited, {
      source: 'currentMatchesFallback',
      requestedCount: limit,
      scannedCount: matches.length,
      confidence: 'low',
      label: `当前列表样本 ${limited.length} 场`,
      scope: 'soloQueue',
      queueIds: soloQueueIds
    }))
  }
  return forms
}

function buildVisibleRecentForm(matches: MatchSummary[], key: string, beforeDate: string | undefined, limit: number): ParticipantRecentForm | null {
  const beforeTime = parseGameTime(beforeDate)
  if (!beforeTime) return null
  const summaries = matches
    .filter((match) => isBeforeGame(match, beforeTime))
    .sort((a, b) => parseGameTime(b.gameCreationDate) - parseGameTime(a.gameCreationDate))
    .flatMap((match) => match.participants.map((participant) => ({ match, participant })))
    .filter(({ participant }) => participantFormKey(participant) === key)
    .slice(0, limit)
    .map(({ match, participant }) => {
      const kda = kdaScore(participant)
      return {
        win: participant.win,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        kda,
        gameId: match.gameId
      }
    })

  if (!summaries.length) return null

  return summarizeRecentForm(summaries, {
    source: 'currentMatchesFallback',
    requestedCount: limit,
    scannedCount: matches.length,
    confidence: 'low',
    label: `开局前样本 ${summaries.length} 场`,
    scope: 'soloQueue',
    queueIds: soloQueueIds
  })
}

function summarizeRecentForm(
  summaries: Array<{ win: boolean; kills: number; deaths: number; assists: number; kda: number; gameId: number }>,
  meta: Pick<ParticipantRecentForm, 'source' | 'requestedCount' | 'scannedCount' | 'confidence' | 'label' | 'scope' | 'queueIds'>
): ParticipantRecentForm {
  const wins = summaries.filter((summary) => summary.win).length
  const sum = summaries.reduce(
    (acc, summary) => {
      acc.deaths += summary.deaths
      acc.kda += summary.kda
      return acc
    },
    { deaths: 0, kda: 0 }
  )

  return {
    total: summaries.length,
    wins,
    losses: summaries.length - wins,
    winRate: Number(((wins / summaries.length) * 100).toFixed(1)),
    averageKda: average(sum.kda, summaries.length),
    averageDeaths: average(sum.deaths, summaries.length),
    currentStreak: getWinLossStreak(summaries),
    source: meta.source,
    scope: meta.scope,
    queueIds: meta.queueIds,
    requestedCount: meta.requestedCount,
    scannedCount: meta.scannedCount,
    confidence: meta.confidence,
    label: meta.label,
    gameIds: summaries.map((summary) => summary.gameId).filter((gameId): gameId is number => gameId !== undefined)
  }
}

function participantFormKey(participant: Participant) {
  if (participant.puuid) return `puuid:${participant.puuid}`
  if (participant.summonerId) return `summoner:${participant.summonerId}`
  if (participant.summonerName) return `name:${normalizeNameKey(participant.summonerName)}`
  return undefined
}

function kdaScore(participant: Pick<Participant, 'kills' | 'deaths' | 'assists'>) {
  return participant.deaths === 0 ? participant.kills + participant.assists : Number(((participant.kills + participant.assists) / participant.deaths).toFixed(2))
}

function formatRecentFormError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'LCU 响应超时'
  }

  if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
    return 'LCU 响应超时'
  }

  if (error instanceof Error && error.message.includes('开局之前的历史战绩列表为空或没有单双排记录')) {
    return '开局前单双排样本不足，可能因该玩家后续比赛过多导致旧数据不可见'
  }

  if (error instanceof LcuRequestError && (error.status === 400 || error.status === 404)) {
    return '近期状态不可用'
  }

  return error instanceof Error ? error.message : String(error)
}

async function getParticipantRankedStats(client: LcuClient, participant: Participant): Promise<ParticipantRankedStats | undefined> {
  const puuid = participant.puuid ?? await resolvePuuid(client, participant)
  if (!puuid) return undefined
  const stats = await client.get<RawRankedStats>(`/lol-ranked/v1/ranked-stats/${encodeURIComponent(puuid)}`)
  const queues = stats.queues ?? []
  const solo = parseRankedQueue(queues.find((queue) => queue.queueType === 'RANKED_SOLO_5x5'))
  const flex = parseRankedQueue(queues.find((queue) => queue.queueType === 'RANKED_FLEX_SR'))
  return solo || flex ? { solo, flex } : undefined
}

function parseRankedQueue(queue?: RawRankedQueue): RankedQueueStats | undefined {
  if (!queue?.queueType) return undefined
  const wins = queue.wins ?? 0
  const losses = queue.losses ?? 0
  const games = wins + losses
  return {
    queueType: queue.queueType,
    tier: queue.tier,
    division: queue.division ?? queue.rank,
    leaguePoints: queue.leaguePoints,
    wins,
    losses,
    games,
    winRate: games ? Number(((wins / games) * 100).toFixed(1)) : 0
  }
}

async function getParticipantRecentForm(client: LcuClient, participant: Participant, limit: number, beforeDate?: string): Promise<ParticipantRecentForm | null> {
  const puuid = participant.puuid ?? await resolvePuuid(client, participant)
  if (!puuid) throw new Error('缺少 PUUID，且 summonerId/Riot ID 解析失败')

  const cached = !beforeDate ? recentFormCacheGet(puuid) : null
  if (cached) return cached

  const encodedPuuid = encodeURIComponent(puuid)
  const { games, scannedCount } = await fetchRankedMatchHistory(client, encodedPuuid, limit, beforeDate)
  if (!games.length) throw Error('开局之前的历史战绩列表为空或没有单双排记录')

  const summaries = games.map((game) => summarizeParticipantGame(game, puuid, participant.summonerName))
    .filter(Boolean) as Array<{ win: boolean; kills: number; deaths: number; assists: number; kda: number; gameId: number }>
  if (!summaries.length) throw new Error('已拿到历史战绩，但对局详情里匹配不到该玩家')

  console.log(`[RecentForm] ${participant.summonerName}: 找到 ${summaries.length}/${limit} 场, 扫描 ${scannedCount} 场, PUUID: ${puuid.substring(0, 8)}...`)

  const form = summarizeRecentForm(summaries, {
    source: 'lcuMatchHistory',
    requestedCount: limit,
    scannedCount,
    confidence: summaries.length >= limit ? 'high' : summaries.length >= 5 ? 'medium' : 'low',
    label: `开局前近${summaries.length}场单双排`,
    scope: 'soloQueue',
    queueIds: soloQueueIds
  })

  if (!beforeDate) {
    recentFormCacheSet(puuid, form)
  }
  return form
}

async function fetchRankedMatchHistory(client: LcuClient, playerPath: string, limit: number, beforeDate?: string) {
  const beforeTime = parseGameTime(beforeDate)
  const endIndex = 100

  const url = `/lol-match-history/v1/products/lol/${playerPath}/matches?begIndex=0&endIndex=${endIndex}`
  console.log(`[FetchHistory] REQUEST URL: ${url}`)

  const history = await client.get<RawMatchHistory>(url)
  const allGames = history.games?.games ?? []

  const rankedAll = allGames
    .filter((game) => isRankedGame(game) && (!beforeTime || isBeforeGame(game, beforeTime)))
    .sort((a, b) => new Date(b.gameCreationDate ?? 0).getTime() - new Date(a.gameCreationDate ?? 0).getTime())

  console.log(`[FetchHistory] endIndex=${endIndex}: ${allGames.length} total, ${rankedAll.length} ranked before slice:`)
  rankedAll.forEach((g, i) => {
    const d = g.gameCreationDate ? new Date(typeof g.gameCreationDate === 'number' ? g.gameCreationDate : g.gameCreationDate).toLocaleString('zh-CN') : '?'
    console.log(`  [${i}] gameId=${g.gameId} ${d} queueId=${g.queueId}`)
  })

  const games = rankedAll.slice(0, limit)

  return { games, scannedCount: allGames.length }
}

function isRankedGame(game: RawGame) {
  return game.queueId !== undefined && soloQueueIdSet.has(game.queueId)
}

function isBeforeGame(game: Pick<RawGame, 'gameCreationDate'>, beforeTime: number) {
  const gameTime = parseGameTime(game.gameCreationDate)
  return gameTime > 0 && gameTime < beforeTime
}

function parseGameTime(value?: string | number) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : new Date(value).getTime() || 0
}

async function resolvePuuid(client: LcuClient, participant: Participant) {
  if (participant.summonerId) {
    const summoner = await client.get<RawSummoner>(`/lol-summoner/v1/summoners/${participant.summonerId}`).catch(() => null)
    if (summoner?.puuid) return summoner.puuid
  }

  if (participant.summonerName) {
    const riotId = parseRiotId(participant.summonerName)
    if (riotId) {
      const aliases = await client.post<RawSummonerAlias[]>('/lol-summoner/v1/summoners/aliases', [{ gameName: riotId.gameName, tagLine: riotId.tagLine }]).catch(() => [])
      const alias = aliases[0]
      if (alias?.puuid) return alias.puuid
    }

    const summoner = await client.get<RawSummoner>(`/lol-summoner/v1/summoners?name=${encodeURIComponent(participant.summonerName)}`).catch(() => null)
    if (summoner?.puuid) return summoner.puuid
  }

  return undefined
}

function parseRiotId(name: string) {
  const [gameName, tagLine] = name.split('#')
  if (!gameName || !tagLine) return null
  return { gameName, tagLine }
}

function normalizeNameKey(name: string) {
  return name.trim().toLowerCase()
}

function playerNameKeys(player?: RawParticipantIdentityPlayer) {
  if (!player) return []
  const riotId = player.gameName && player.tagLine ? `${player.gameName}#${player.tagLine}` : undefined
  return [riotId, player.summonerName].filter(Boolean).map((name) => normalizeNameKey(name as string))
}

function participantNameKeys(participant: RawParticipant) {
  const riotId = (participant.riotIdGameName || participant.gameName) && (participant.riotIdTagline || participant.tagLine)
    ? `${participant.riotIdGameName || participant.gameName}#${participant.riotIdTagline || participant.tagLine}`
    : undefined
  return [riotId, participant.summonerName].filter(Boolean).map((name) => normalizeNameKey(name as string))
}

function summarizeParticipantGame(game: RawGameDetail, puuid: string, fallbackName?: string) {
  const normalizedName = fallbackName ? normalizeNameKey(fallbackName) : undefined
  const participantId = game.participantIdentities?.find((identity) => identity.player?.puuid === puuid || (normalizedName && playerNameKeys(identity.player).includes(normalizedName)))?.participantId
  const participant = game.participants?.find((item) => item.puuid === puuid || item.summonerPuuid === puuid)
    ?? game.participants?.find((item) => item.participantId === participantId)
    ?? game.participants?.find((item) => normalizedName ? participantNameKeys(item).includes(normalizedName) : false)
    ?? (game.participants?.length === 1 ? game.participants[0] : undefined)
  if (!participant) return null
  const stats = participant.stats ?? {}
  console.log(`[Win] gameId=${game.gameId} puuid=${puuid?.substring(0, 8)} win=${stats.win}`)
  const kills = stats.kills ?? 0
  const deaths = stats.deaths ?? 0
  const assists = stats.assists ?? 0
  return {
    win: stats.win ?? false,
    kills,
    deaths,
    assists,
    kda: deaths === 0 ? kills + assists : Number(((kills + assists) / deaths).toFixed(2)),
    gameId: game.gameId
  }
}

function applyPremadeInference(matches: MatchSummary[]) {
  return matches.map((match) => ({
    ...match,
    participants: match.participants.map((participant) => {
      if (participant.premadeGroup || participant.teamId === undefined || !participant.recentForm?.gameIds?.length) return participant
      const linkedTeammates = match.participants.filter((teammate) => {
        if (teammate === participant || teammate.teamId !== participant.teamId || !teammate.recentForm?.gameIds?.length) return false
        const sharedGames = teammate.recentForm.gameIds.filter((gameId) => participant.recentForm?.gameIds?.includes(gameId))
        return sharedGames.length >= 2
      })
      if (linkedTeammates.length !== 1) return participant
      const side = participant.teamId === 100 ? '蓝方' : participant.teamId === 200 ? '红方' : `队伍${participant.teamId}`
      return { ...participant, premadeGroup: `${side}疑似双排`, premadeGroupSize: 2 }
    })
  }))
}

function calculateStats(matches: MatchSummary[]) {
  const total = matches.length
  const wins = matches.filter((match) => match.win).length
  const losses = total - wins
  const sum = matches.reduce(
    (acc, match) => {
      acc.kills += match.kills
      acc.deaths += match.deaths
      acc.assists += match.assists
      acc.kda += match.kda
      return acc
    },
    { kills: 0, deaths: 0, assists: 0, kda: 0 }
  )

  return {
    total,
    wins,
    losses,
    winRate: total ? Number(((wins / total) * 100).toFixed(1)) : 0,
    averageKills: average(sum.kills, total),
    averageDeaths: average(sum.deaths, total),
    averageAssists: average(sum.assists, total),
    averageKda: average(sum.kda, total),
    currentStreak: getCurrentStreak(matches)
  }
}

function average(value: number, total: number) {
  return total ? Number((value / total).toFixed(2)) : 0
}

function getWinLossStreak(matches: Array<{ win: boolean }>) {
  if (!matches.length) {
    return '无对局'
  }

  const first = matches[0].win
  const count = matches.findIndex((match) => match.win !== first)
  const streak = count === -1 ? matches.length : count
  return `${first ? '连胜' : '连败'} ${streak} 场`
}

function getCurrentStreak(matches: MatchSummary[]) {
  return getWinLossStreak(matches)
}
