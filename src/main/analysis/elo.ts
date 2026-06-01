import type { MatchSummary, RecentMatchesPayload } from '../types.js'

export function buildEloSnapshot(payload: RecentMatchesPayload) {
  return {
    ...payload,
    localAnalysis: {
      pressureScore: calculatePressureScore(payload.matches),
      lossReasonTags: buildLossReasonTags(payload.matches),
      recentForm: payload.stats.currentStreak
    }
  }
}

function calculatePressureScore(matches: MatchSummary[]) {
  if (!matches.length) {
    return 0
  }

  const lossRate = matches.filter((match) => !match.win).length / matches.length
  const avgDeaths = matches.reduce((sum, match) => sum + match.deaths, 0) / matches.length
  const lowKdaGames = matches.filter((match) => match.kda < 2).length / matches.length
  const score = lossRate * 45 + Math.min(avgDeaths / 10, 1) * 25 + lowKdaGames * 30
  return Math.max(1, Math.min(100, Math.round(score)))
}

function buildLossReasonTags(matches: MatchSummary[]) {
  const tags: string[] = []
  const losses = matches.filter((match) => !match.win).length
  const avgKda = matches.length ? matches.reduce((sum, match) => sum + match.kda, 0) / matches.length : 0
  const avgDeaths = matches.length ? matches.reduce((sum, match) => sum + match.deaths, 0) / matches.length : 0

  if (losses >= 7) tags.push('近期胜率高压')
  if (avgKda >= 3 && losses >= 5) tags.push('尽力局偏多')
  if (avgDeaths >= 7) tags.push('死亡压力偏高')
  if (!tags.length) tags.push('数据波动正常')

  return tags
}
