export type LcuCredentials = {
  port: number
  password: string
  protocol: string
}

export type CurrentSummoner = {
  displayName?: string
  gameName?: string
  tagLine?: string
  summonerLevel?: number
  summonerId?: number
  puuid?: string
}

export type ChampionInfo = {
  id: number
  name: string
  alias?: string
  squarePortraitPath?: string
}

export type ParticipantRecentForm = {
  total: number
  wins: number
  losses: number
  winRate: number
  averageKda: number
  averageDeaths: number
  currentStreak: string
  source?: 'lcuMatchHistory' | 'currentMatchesFallback'
  scope?: 'soloQueue'
  queueIds?: number[]
  requestedCount?: number
  scannedCount?: number
  confidence?: 'high' | 'medium' | 'low'
  label?: string
  gameIds?: number[]
}

export type RankedQueueStats = {
  queueType: string
  tier?: string
  division?: string
  leaguePoints?: number
  wins: number
  losses: number
  games: number
  winRate: number
}

export type ParticipantRankedStats = {
  solo?: RankedQueueStats
  flex?: RankedQueueStats
}

export type Participant = {
  summonerName?: string
  puuid?: string
  summonerId?: number
  championId?: number
  championName?: string
  teamId?: number
  participantId?: number
  playerSubteamId?: number
  premadeGroup?: string
  premadeGroupSize?: number
  recentForm?: ParticipantRecentForm
  rankedStats?: ParticipantRankedStats
  recentFormError?: string
  lane?: string
  role?: string
  position?: string
  kills: number
  deaths: number
  assists: number
  win: boolean
  totalDamageDealtToChampions?: number
  goldEarned?: number
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
}

export type MatchSummary = {
  gameId: number
  queueId?: number
  gameCreationDate?: string
  gameDuration?: number
  championId?: number
  championName?: string
  win: boolean
  kills: number
  deaths: number
  assists: number
  kda: number
  participants: Participant[]
}

export type RecentMatchesPayload = {
  summoner: CurrentSummoner
  matches: MatchSummary[]
  championMap: Record<number, ChampionInfo>
  stats: {
    total: number
    wins: number
    losses: number
    winRate: number
    averageKills: number
    averageDeaths: number
    averageAssists: number
    averageKda: number
    currentStreak: string
  }
}
