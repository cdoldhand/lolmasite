import type { MatchSummary, Participant, RecentMatchesPayload } from '../types.js'

export type AiConfig = {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  prompt: string
}

export const defaultPrompt = `你是一个英雄联盟排位数据分析师，输出风格要茶言茶语、阴阳怪气、笑里藏刀，有节目效果；但必须基于数据说话，不能为了阴阳而编造。

注意：
1. 所有判断都必须基于我提供的 JSON 数据。
2. 不要编造不存在的数据；数据不足时必须明确说“数据不足”。
3. 可以使用“疑似”“体感”“数据倾向”这类表达，但不能把推测说成官方机制实锤。
4. 必须先识别位置再评价责任，不要把辅助当打野喷，也不要用低补刀喷辅助。
5. 如果读取超过 10 场，逐局详细复盘只分析最近 10 场；更早的场次只用于总体趋势、稳定性和压力指数判断。
6. 每局必须优先分析“我方 vs 对手”的近期状态差距，包括平均近期胜率、低状态玩家数量、热手/冷手、双排/疑似双排。
7. 重点分析我本人、双方队友、对手阵容、每局表现差距和分路对位。
8. 不要输出代码。
9. 结果必须使用中文。
10. recentForm 表示该局开局之前的近期单双排样本，用于判断开局时双方状态；必须结合 total/requestedCount/confidence 判断可信度。样本少通常是因为该玩家后续比赛过多、LCU 最近记录窗口挤掉了旧数据，不代表该玩家没打排位。currentMatchesFallback 或 low confidence 只能作为弱证据。
11. rankedStats 表示赛季排位数据，只能作为长期实力背景，不要和近期单双排胜率混为一谈。
12. 语言风格要像“表面客气、实际扎心”的茶言茶语：多用“倒也不是不能理解”“只能说挺努力了”“可能他有自己的游戏理解”“数据已经很给面子了”“这局大家都不容易，尤其是你”这类表达。
13. 阴阳怪气要服务于数据结论：可以讽刺表现和匹配质量，但不要人身攻击、不要辱骂、不要输出脏话。

请按以下格式输出：

一、10场总览结论
直接判断这 10 场更像：
正常波动 / 我方状态劣势 / 对手状态压制 / 本人问题偏大 / 疑似匹配压力明显。
必须引用总胜率、胜负、平均 KDA、连胜连败。
说明：这不能证明官方隐藏机制，只能说明匹配压力特征是否明显。

二、我方 VS 对手近期状态对比
按每局列出：
第N局、胜负、本人位置-英雄-KDA、我方平均近期胜率、对手平均近期胜率、哪边更高、差距多少。
同时分析双方低状态玩家数量、热手/冷手数量、是否有双排/疑似双排。
指出最离谱的 2-3 局。

三、逐局分型复盘
每局必须给一个标签：
正常可赢局 / 我方状态劣势局 / 对手状态压制局 / 本人尽力但队友崩盘 / 本人表现不足 / 疑似匹配压力局 / 数据不足局。

每局格式：
第N局（胜/负，位置-英雄，KDA）：标签。
然后用 2-4 句话解释：
- 我方 vs 对手近期胜率差距；
- 本人表现是否合格；
- 哪条分路或哪个队伍质量点影响最大；
- 是否有明确/疑似双排证据。

四、分路对位责任分析
必须按位置分析，不要只按输赢喷人。
对本人所在位置，和对面同位置优先比较 KDA、伤害、经济、补刀、近期胜率中的至少 2 项。
判断本人属于：
C了但没赢 / 混住了 / 被爆线 / 送掉节奏 / 数据不足。

五、队友质量与对手强度
总结我方队友近期状态：多少冷手、多少热手、平均近期胜率如何。
总结对手近期状态：是否整体更稳，是否有明显大腿。
如果对手近期胜率明显高于我方，直接指出这是匹配压力的主要证据。

六、疑似小号/炸鱼雷达
只能根据现有数据判断：KDA、伤害、经济、补刀、近期胜率、连胜连败、对位压制。
如果数据不足，请明确说“当前数据不足以判断”，不要硬编。

七、双排/疑似双排影响
检查 premadeGroup 字段。
有双排就说明在哪边、可能影响哪局。
没有就明确写“未检测到明确双排证据”。
不允许把没有 premadeGroup 的玩家硬说成开黑。

八、ELO压力指数：0-100
给一个分数，并解释分数来自哪些证据：
双方近期胜率差、冷手数量、对手强度、本人表现、双排证据。
只能说“数据倾向/体感/疑似”，不能说成官方机制实锤。

九、受害者/演员诊断
用茶言茶语、阴阳怪气但清楚的中文总结本轮匹配体验。
最后给 3 条可执行改进建议。
再给一句 50 字以内、适合发群里的阴阳怪气骚话。`

export async function analyzeWithAi(config: AiConfig, payload: RecentMatchesPayload) {
  if (!config.baseUrl.trim()) {
    throw new Error('请填写 AI API Base URL。')
  }

  if (!config.apiKey.trim()) {
    throw new Error('请填写 API Key。')
  }

  if (!config.model.trim()) {
    throw new Error('请填写模型名称。')
  }

  const baseUrl = normalizeChatCompletionsUrl(config.baseUrl)
  const compactPayload = buildCompactAiPayload(payload)
  const timeoutMs = 180000
  let response: Response
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        messages: [
          {
            role: 'system',
            content: [defaultPrompt, config.prompt && config.prompt !== defaultPrompt ? `用户补充要求：\n${config.prompt}` : ''].filter(Boolean).join('\n\n')
          },
          {
            role: 'user',
            content: `以下是玩家最近对局的精简 JSON 数据，只包含分析需要的字段：\n\n${JSON.stringify(compactPayload)}`
          }
        ]
      })
    })
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw new Error(`AI 分析超时：模型在 ${Math.round(timeoutMs / 1000)} 秒内没有返回结果。请换一个更快的模型、降低分析场次，或稍后重试。`)
    }
    throw error
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(formatAiError(response.status, response.statusText, body))
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI 返回为空。')
  }

  return content
}

function isAbortOrTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || error.message.toLowerCase().includes('timeout')
    || error.message.toLowerCase().includes('aborted')
}

function normalizeChatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function buildCompactAiPayload(payload: RecentMatchesPayload) {
  const playerName = payload.summoner.gameName && payload.summoner.tagLine
    ? `${payload.summoner.gameName}#${payload.summoner.tagLine}`
    : payload.summoner.displayName || payload.summoner.gameName || '未知召唤师'

  return {
    player: {
      name: playerName,
      level: payload.summoner.summonerLevel
    },
    stats: payload.stats,
    analysisPolicy: {
      totalMatches: payload.matches.length,
      detailedMatchCount: Math.min(10, payload.matches.length),
      instruction: '逐局详细复盘只分析最近10场；如果读取超过10场，其余场次只用于总览趋势、压力指数和稳定性判断。'
    },
    localAnalysis: 'localAnalysis' in payload ? payload.localAnalysis : undefined,
    testAccountEloSignals: buildTestAccountEloSignals(payload.matches),
    matches: payload.matches.slice(0, 10).map(compactMatch),
    trendMatches: payload.matches.slice(10).map(compactTrendMatch)
  }
}

function compactMatch(match: MatchSummary, index: number) {
  const currentParticipant = match.participants.find((participant) => participant.championId === match.championId && participant.kills === match.kills && participant.deaths === match.deaths && participant.assists === match.assists)
  const ownTeamId = currentParticipant?.teamId
  const selfPosition = currentParticipant?.position || '位置未知'
  const selfChampion = match.championName || match.championId
  return {
    n: index + 1,
    result: match.win ? '胜' : '负',
    queueId: match.queueId,
    durationMin: match.gameDuration ? Math.round(match.gameDuration / 60) : undefined,
    selfLabel: `${selfPosition}-${selfChampion}，${match.kills}/${match.deaths}/${match.assists}`,
    self: {
      champion: selfChampion,
      position: selfPosition,
      lane: currentParticipant?.lane,
      role: currentParticipant?.role,
      kda: `${match.kills}/${match.deaths}/${match.assists}`,
      kdaScore: match.kda,
      team: ownTeamId
    },
    teams: [100, 200].map((teamId) => ({
      teamId,
      result: match.participants.find((participant) => participant.teamId === teamId)?.win ? '胜' : '负',
      quality: summarizeTeamQuality(match, teamId, ownTeamId),
      players: match.participants
        .filter((participant) => participant.teamId === teamId)
        .map(compactParticipant)
    }))
  }
}

function compactTrendMatch(match: MatchSummary, index: number) {
  const currentParticipant = match.participants.find((participant) => participant.championId === match.championId && participant.kills === match.kills && participant.deaths === match.deaths && participant.assists === match.assists)
  const ownTeamId = currentParticipant?.teamId
  const enemyTeamId = ownTeamId === 100 ? 200 : ownTeamId === 200 ? 100 : undefined
  const ownQuality = ownTeamId ? summarizeTeamQuality(match, ownTeamId, ownTeamId) : null
  const enemyQuality = enemyTeamId ? summarizeTeamQuality(match, enemyTeamId, ownTeamId) : null
  return {
    n: index + 11,
    result: match.win ? '胜' : '负',
    selfLabel: `${currentParticipant?.position || '位置未知'}-${match.championName || match.championId}，${match.kills}/${match.deaths}/${match.assists}`,
    selfKdaScore: match.kda,
    ownTeam: ownQuality,
    enemyTeam: enemyQuality,
    signalReason: buildSignalReason(ownQuality, enemyQuality, ownQuality?.premadeGroups.length ?? 0, enemyQuality?.premadeGroups.length ?? 0)
  }
}

function buildTestAccountEloSignals(matches: MatchSummary[]) {
  const signals = matches.map((match, index) => {
    const currentParticipant = match.participants.find((participant) => participant.championId === match.championId && participant.kills === match.kills && participant.deaths === match.deaths && participant.assists === match.assists)
    const ownTeamId = currentParticipant?.teamId
    const enemyTeamId = ownTeamId === 100 ? 200 : ownTeamId === 200 ? 100 : undefined
    const ownQuality = ownTeamId ? summarizeTeamQuality(match, ownTeamId, ownTeamId) : null
    const enemyQuality = enemyTeamId ? summarizeTeamQuality(match, enemyTeamId, ownTeamId) : null
    const ownPressure = ownQuality?.lowRecentFormPlayers ?? 0
    const enemyPressure = enemyQuality?.lowRecentFormPlayers ?? 0
    const enemyPremade = enemyQuality?.premadeGroups.length ?? 0
    const ownPremade = ownQuality?.premadeGroups.length ?? 0
    const likelyAssignedPressure = ownPressure > enemyPressure || enemyPremade > ownPremade || (ownQuality?.averageKda ?? 0) + 0.5 < (enemyQuality?.averageKda ?? 0)

    return {
      n: index + 1,
      result: match.win ? '胜' : '负',
      self: `${currentParticipant?.position || '位置未知'}-${match.championName || match.championId}，${match.kills}/${match.deaths}/${match.assists}`,
      ownTeam: ownQuality,
      enemyTeam: enemyQuality,
      likelyAssignedPressure,
      reason: buildSignalReason(ownQuality, enemyQuality, ownPremade, enemyPremade)
    }
  })

  const pressureGames = signals.filter((signal) => signal.likelyAssignedPressure).length
  return {
    pressureGames,
    pressureRate: matches.length ? Number(((pressureGames / matches.length) * 100).toFixed(1)) : 0,
    summary: pressureGames >= 6 ? '强' : pressureGames >= 4 ? '中' : pressureGames >= 2 ? '弱' : '无明显证据',
    signals
  }
}

function summarizeTeamQuality(match: MatchSummary, teamId: number, ownTeamId?: number) {
  const players = match.participants.filter((participant) => participant.teamId === teamId)
  const forms = players.map((participant) => participant.recentForm).filter(Boolean) as NonNullable<Participant['recentForm']>[]
  const lowRecentFormPlayers = players.filter((participant) => participant.recentForm && (participant.recentForm.winRate <= 40 || participant.recentForm.currentStreak.startsWith('连败') || participant.recentForm.averageKda < 2)).length
  const premadeGroups = Array.from(new Set(players.map((participant) => participant.premadeGroup).filter(Boolean) as string[]))

  return {
    side: teamId === ownTeamId ? '我方' : '敌方',
    averageKda: average(players.map((player) => kdaScore(player)).reduce((sum, value) => sum + value, 0), players.length),
    averageDeaths: average(players.reduce((sum, player) => sum + player.deaths, 0), players.length),
    averageDamage: Math.round(average(players.reduce((sum, player) => sum + (player.totalDamageDealtToChampions ?? 0), 0), players.length)),
    averageGold: Math.round(average(players.reduce((sum, player) => sum + (player.goldEarned ?? 0), 0), players.length)),
    recentFormsFound: forms.length,
    averageRecentWinRate: forms.length ? average(forms.reduce((sum, form) => sum + form.winRate, 0), forms.length) : undefined,
    lowRecentFormPlayers,
    premadeGroups
  }
}

function buildSignalReason(ownQuality: ReturnType<typeof summarizeTeamQuality> | null, enemyQuality: ReturnType<typeof summarizeTeamQuality> | null, ownPremade: number, enemyPremade: number) {
  const reasons: string[] = []
  if ((ownQuality?.lowRecentFormPlayers ?? 0) > (enemyQuality?.lowRecentFormPlayers ?? 0)) reasons.push('我方低近期状态玩家更多')
  if (enemyPremade > ownPremade) reasons.push('敌方开黑/疑似开黑更多')
  if ((ownQuality?.averageKda ?? 0) + 0.5 < (enemyQuality?.averageKda ?? 0)) reasons.push('敌方本局整体KDA更高')
  if ((ownQuality?.averageRecentWinRate ?? 50) + 10 < (enemyQuality?.averageRecentWinRate ?? 50)) reasons.push('敌方近期胜率明显更高')
  return reasons.length ? reasons.join('；') : '未出现明显系统压力数据特征'
}

function average(value: number, total: number) {
  return total ? Number((value / total).toFixed(2)) : 0
}

function kdaScore(participant: Participant) {
  return participant.deaths === 0 ? participant.kills + participant.assists : Number(((participant.kills + participant.assists) / participant.deaths).toFixed(2))
}

function compactParticipant(participant: Participant) {
  return {
    name: participant.summonerName,
    champion: participant.championName || participant.championId,
    position: participant.position,
    lane: participant.lane,
    role: participant.role,
    premadeGroup: participant.premadeGroup,
    recentForm: participant.recentForm,
    kda: `${participant.kills}/${participant.deaths}/${participant.assists}`,
    damage: participant.totalDamageDealtToChampions,
    gold: participant.goldEarned,
    cs: (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0)
  }
}

function formatAiError(status: number, statusText: string, body: string) {
  const cleanedBody = extractAiErrorMessage(body)
  if (status === 504) {
    return `AI 请求超时：你的 AI API 网关 ${status} ${statusText}，通常是上游模型响应太慢或服务暂时不可用。请稍后重试，或换一个更快的模型。${cleanedBody ? `\n详情：${cleanedBody}` : ''}`
  }

  if (status === 401 || status === 403) {
    return `AI 鉴权失败：请检查 API Key、Base URL 和模型权限。${cleanedBody ? `\n详情：${cleanedBody}` : ''}`
  }

  if (status === 404) {
    return `AI 接口地址不存在：${status} ${statusText}。请检查 AI API Base URL，通常填写网关域名即可，例如 https://你的-ai-api地址，程序会自动补 /v1/chat/completions；如果你的网关有自定义前缀，请填写到 /v1 为止。${cleanedBody ? `\n详情：${cleanedBody}` : ''}`
  }

  if (status === 429) {
    return `AI 请求被限流：请稍后重试，或检查 AI API 额度/并发限制。${cleanedBody ? `\n详情：${cleanedBody}` : ''}`
  }

  return `AI 请求失败：${status} ${statusText}${cleanedBody ? `\n详情：${cleanedBody}` : ''}`
}

function extractAiErrorMessage(body: string) {
  if (!body.trim()) return ''

  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    if (typeof json.error === 'string') return json.error
    return json.error?.message || json.message || ''
  } catch {
    return body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
  }
}
