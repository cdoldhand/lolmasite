import type { CurrentSummoner, RecentMatchesPayload } from '../main/types'

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

export type ApiResponse<T> = {
  ok: boolean
  data?: T
  error?: string
}

export type MatchLoadProgress = {
  phase: string
  current: number
  total: number
}

export type ProgressResponse<T> = ApiResponse<T> & {
  progress?: MatchLoadProgress
}

const savedConfigKey = 'lolmasite-config'
const legacySavedConfigKey = 'lol-ai-match-analyzer-config'

export const initialAiConfig: AiConfig = {
  baseUrl: 'https://api.8q8k.com/v1',
  apiKey: '',
  model: '',
  temperature: 0.8,
  prompt: defaultPrompt
}

export function loadAiConfig(): AiConfig {
  const raw = localStorage.getItem(savedConfigKey) ?? localStorage.getItem(legacySavedConfigKey)
  if (!raw) return initialAiConfig

  try {
    const config = { ...initialAiConfig, ...JSON.parse(raw) }
    if (config.prompt.includes('短视频口播文案') || config.prompt.includes('30-60秒') || config.prompt.includes('teams.quality.averageRecentWinRate')) {
      return { ...config, prompt: defaultPrompt }
    }
    return config
  } catch {
    return initialAiConfig
  }
}

export function saveAiConfig(config: AiConfig) {
  localStorage.setItem(savedConfigKey, JSON.stringify(config))
}

const leagueDirKey = 'lolmasite-league-dir'
const legacyLeagueDirKey = 'lol-ai-match-analyzer-league-dir'

export type LeagueClientDetection = {
  ok: boolean
  leagueDir?: string
  source?: 'custom' | 'process' | 'commonPath'
  error?: string
}

export function loadLeagueDir() {
  return localStorage.getItem(leagueDirKey) || localStorage.getItem(legacyLeagueDirKey) || ''
}

export function saveLeagueDir(leagueDir: string) {
  localStorage.setItem(leagueDirKey, leagueDir)
}

export async function detectLeagueClient(leagueDir?: string) {
  return request<LeagueClientDetection>(withLeagueDir('/api/detect-league-client', leagueDir))
}

export async function fetchCurrentSummoner(leagueDir?: string) {
  return request<CurrentSummoner>(withLeagueDir('/api/current-summoner', leagueDir))
}

export async function fetchRecentMatches(leagueDir?: string, limit = 20) {
  return request<RecentMatchesPayload>(withLeagueDir(`/api/recent-matches?limit=${limit}`, leagueDir))
}

export async function fetchRecentMatchesWithProgress(
  leagueDir: string | undefined,
  limit: number,
  onProgress: (progress: MatchLoadProgress) => void,
  onUpdate?: (data: RecentMatchesPayload) => void,
) {
  const response = await fetch(withLeagueDir(`/api/recent-matches-progress?limit=${limit}`, leagueDir))
  if (!response.ok || !response.body) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: RecentMatchesPayload | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      const message = JSON.parse(line) as ProgressResponse<RecentMatchesPayload>
      if (!message.ok) throw new Error(message.error || '请求失败')
      if (message.progress) onProgress(message.progress)
      if (message.data) {
        data = message.data
        onUpdate?.(data)
      }
    }
  }

  if (!data) {
    throw new Error('没有收到最近对局数据。')
  }

  return data
}

export async function analyzeMatches(config: AiConfig, payload: RecentMatchesPayload) {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

  return request<string>('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, payload })
  })
}

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json() as ApiResponse<T>
  if (!body.ok) {
    throw new Error(body.error || '请求失败')
  }

  return body.data as T
}

function withLeagueDir(url: string, leagueDir?: string) {
  if (!leagueDir?.trim()) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}leagueDir=${encodeURIComponent(leagueDir.trim())}`
}
