<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { CurrentSummoner, MatchSummary, Participant, RecentMatchesPayload } from '../main/types'
import type { MatchLoadProgress } from './api'
import { analyzeMatches, detectLeagueClient, fetchCurrentSummoner, fetchRecentMatchesWithProgress, loadAiConfig, loadLeagueDir, saveAiConfig, saveLeagueDir } from './api'

const aiConfig = ref(loadAiConfig())
const leagueDir = ref(loadLeagueDir())
const summoner = ref<CurrentSummoner | null>(null)
const recent = ref<RecentMatchesPayload | null>(null)
const report = ref('')
const loading = ref('')
const matchProgress = ref<MatchLoadProgress | null>(null)
const matchLimit = ref(1)
const error = ref('')
const savedMessage = ref('')
const reportSection = ref<HTMLElement | null>(null)
const showBaseUrl = ref(false)
const showApiKey = ref(false)
const showLeagueAdvanced = ref(false)
const leagueDetectMessage = ref('')
const leagueDetecting = ref(false)

const summonerName = computed(() => {
  if (!summoner.value) return '未检测'
  if (summoner.value.gameName && summoner.value.tagLine) return `${summoner.value.gameName}#${summoner.value.tagLine}`
  return summoner.value.displayName || summoner.value.gameName || '未知召唤师'
})

const matchProgressPercent = computed(() => {
  if (!matchProgress.value?.total) return 1
  return Math.max(1, Math.min(100, Math.round((matchProgress.value.current / matchProgress.value.total) * 100)))
})

const matchProgressPhase = computed(() => matchProgress.value?.phase.replace(/\s+\d+\/\d+$/, '') || '')
const hydratingForms = ref(false)
const isMatchLoading = computed(() => hydratingForms.value)

function formatUserError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  if (/ECONNREFUSED|Failed to fetch|fetch failed|NetworkError|127\.0\.0\.1:5041/i.test(message)) {
    return '本地服务未连接。请确认项目 API 服务正在运行，并先打开英雄联盟客户端登录到大厅后再重试。'
  }
  if (/League Client|lockfile|LCU|英雄联盟客户端|客户端/i.test(message)) {
    return message
  }
  return message
}

async function run<T>(label: string, action: () => Promise<T>) {
  loading.value = label
  error.value = ''
  await nextTick()
  try {
    return await action()
  } catch (err) {
    error.value = formatUserError(err)
  } finally {
    loading.value = ''
  }
}

async function autoDetectLeagueClient() {
  leagueDetecting.value = true
  leagueDetectMessage.value = ''
  error.value = ''
  try {
    const result = await detectLeagueClient(leagueDir.value)
    if (result.ok && result.leagueDir) {
      leagueDir.value = result.leagueDir
      saveLeagueDir(result.leagueDir)
      const sourceText = result.source === 'process' ? '运行中的客户端' : result.source === 'custom' ? '已填写路径' : '常见安装目录'
      leagueDetectMessage.value = `已检测到 LOL 客户端（${sourceText}）：${result.leagueDir}`
    } else {
      leagueDetectMessage.value = result.error || '未检测到 LOL 客户端。'
      showLeagueAdvanced.value = true
    }
  } catch (err) {
    leagueDetectMessage.value = formatUserError(err)
    showLeagueAdvanced.value = true
  } finally {
    leagueDetecting.value = false
  }
}

async function detectSummoner() {
  saveLeagueDir(leagueDir.value)
  const data = await run('正在检测 LOL 客户端...', () => fetchCurrentSummoner(leagueDir.value))
  if (data) summoner.value = data
}

async function loadRecentMatches() {
  saveLeagueDir(leagueDir.value)
  report.value = ''
  loading.value = `正在获取最近 ${matchLimit.value} 场单双排...`
  error.value = ''
  hydratingForms.value = true
  matchProgress.value = { phase: '准备读取对局数据', current: 0, total: matchLimit.value }

  try {
    const data = await fetchRecentMatchesWithProgress(
      leagueDir.value,
      matchLimit.value,
      (progress) => {
        matchProgress.value = progress
        if (progress.phase === '完成' || progress.phase.includes('完成')) {
          loading.value = ''
          hydratingForms.value = false
        } else {
          loading.value = progress.phase
        }
      },
      (partialData) => {
        recent.value = partialData
        summoner.value = partialData.summoner
      },
    )
    recent.value = data
    summoner.value = data.summoner
    hydratingForms.value = false
  } catch (err) {
    error.value = formatUserError(err)
    matchProgress.value = null
    hydratingForms.value = false
    loading.value = ''
  }
}

async function analyze() {
  if (!recent.value) {
    error.value = `请先获取最近 ${matchLimit.value} 场单双排数据。`
    return
  }

  report.value = ''
  saveApiSettings(false)
  const data = await run('AI 正在深度分析对局...', () => analyzeMatches(aiConfig.value, recent.value!))
  if (data) {
    report.value = data
    await nextTick()
    reportSection.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    reportSection.value?.focus({ preventScroll: true })
  }
}

function saveApiSettings(showMessage = true) {
  saveAiConfig(aiConfig.value)
  if (!showMessage) return
  savedMessage.value = 'API 设置已保存，刷新后会自动保留。'
  window.setTimeout(() => { savedMessage.value = '' }, 2500)
}

function clearApiSettings() {
  aiConfig.value = { ...aiConfig.value, baseUrl: '', apiKey: '', model: '', temperature: 0.8 }
  saveAiConfig(aiConfig.value)
  savedMessage.value = 'API 设置已清空。'
}

// === 对局数据辅助函数 ===

function participantChampion(participant: Participant) {
  return participant.championName || (participant.championId ? recent.value?.championMap[participant.championId]?.name : undefined) || `英雄 ${participant.championId ?? '-'}`
}

function participantCs(participant: Participant) {
  return (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0)
}

function displayPosition(participant: Participant, _team: Participant[], index: number) {
  if (participant.position === 'BOTTOM/CARRY') return '下路AD'
  if (participant.position === 'BOTTOM/SUPPORT') return '辅助'
  if (participant.position) return participant.position
  const slot = participant.participantId ? ((participant.participantId - 1) % 5) + 1 : index + 1
  if (slot === 1) return '上单'
  if (slot === 2) return '打野'
  if (slot === 3) return '中单'
  if (slot === 4) return '下路AD'
  if (slot === 5) return '辅助'
  return '位置未知'
}

function positionIcon(pos: string) {
  if (pos.includes('上')) return '🗡️'
  if (pos.includes('打野')) return '🌿'
  if (pos.includes('中')) return '⚡'
  if (pos.includes('下路') || pos.includes('AD')) return '🏹'
  if (pos.includes('辅助')) return '🛡️'
  return '❓'
}

function teamParticipants(match: MatchSummary, teamId: number) {
  return match.participants.filter((p) => p.teamId === teamId)
}

function sortedTeamParticipants(match: MatchSummary, teamId: number) {
  const order = new Map([
    ['上单', 1],
    ['打野', 2],
    ['中单', 3],
    ['下路AD', 4],
    ['辅助', 5]
  ])
  return [...teamParticipants(match, teamId)].sort((a, b) => {
    const posA = displayPosition(a, teamParticipants(match, teamId), 0)
    const posB = displayPosition(b, teamParticipants(match, teamId), 0)
    return (order.get(posA) ?? 99) - (order.get(posB) ?? 99)
  })
}

function currentParticipant(match: MatchSummary) {
  return match.participants.find((p) => p.championId === match.championId && p.kills === match.kills && p.deaths === match.deaths && p.assists === match.assists)
}

function myTeamId(match: MatchSummary) {
  return currentParticipant(match)?.teamId ?? 100
}

function enemyTeamId(match: MatchSummary) {
  return myTeamId(match) === 100 ? 200 : 100
}

function orderedTeamIds(match: MatchSummary) {
  return [myTeamId(match), enemyTeamId(match)]
}

function teamSideLabel(match: MatchSummary, teamId: number) {
  return teamId === myTeamId(match) ? '我方' : '对手'
}

function teamRecentStats(match: MatchSummary, teamId: number) {
  const forms = teamParticipants(match, teamId)
    .flatMap((p) => p.recentForm ? [p.recentForm] : [])
  if (!forms.length) return { count: 0, averageWinRate: 0, hot: 0, cold: 0 }
  const winRates = forms.map((f) => f.winRate)
  const averageWinRate = Number((winRates.reduce((s, w) => s + w, 0) / forms.length).toFixed(1))
  return {
    count: forms.length,
    averageWinRate,
    hot: forms.filter((f) => f.winRate >= 60).length,
    cold: forms.filter((f) => f.winRate <= 40).length
  }
}

function matchVsStats(match: MatchSummary) {
  const own = teamRecentStats(match, myTeamId(match))
  const enemy = teamRecentStats(match, enemyTeamId(match))
  const diff = Number((own.averageWinRate - enemy.averageWinRate).toFixed(1))
  const leader = Math.abs(diff) < 0.1 ? 'even' : diff > 0 ? 'own' : 'enemy'
  return { own, enemy, diff: Math.abs(diff), leader }
}

// === 新增：数据可视化辅助函数 ===

function winRateColor(rate: number): string {
  if (rate >= 60) return '#22C55E'
  if (rate >= 50) return '#4F7CFF'
  if (rate >= 40) return '#F59E0B'
  return '#EF4444'
}

function winRateBgColor(rate: number): string {
  if (rate >= 60) return 'rgba(34,197,94,0.16)'
  if (rate >= 50) return 'rgba(79,124,255,0.16)'
  if (rate >= 40) return 'rgba(245,158,11,0.16)'
  return 'rgba(239,68,68,0.16)'
}

function playerKdaScore(p: Participant): number {
  return p.deaths === 0 ? p.kills + p.assists : Number(((p.kills + p.assists) / p.deaths).toFixed(2))
}

function playerTag(p: Participant, match: MatchSummary): string {
  const form = p.recentForm
  const kda = playerKdaScore(p)
  if (form && form.winRate >= 70 && kda >= 3) return '🔥'
  if (form && form.winRate <= 30) return '💀'
  if (form && form.currentStreak.startsWith('连败') && form.winRate <= 40) return '⚠️'
  if (kda >= 4) return '⭐'
  return ''
}

function playerTagText(p: Participant, match: MatchSummary): string {
  const tag = playerTag(p, match)
  if (tag === '🔥') return '大腿'
  if (tag === '💀') return '高风险'
  if (tag === '⚠️') return '低迷'
  if (tag === '⭐') return 'MVP'
  return ''
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}分${s}秒`
}

function matchGameDuration(match: MatchSummary): string {
  return formatDuration(match.gameDuration)
}

function isParticipantFormLoading(participant: Participant): boolean {
  return isMatchLoading.value && (!participant.recentForm || participant.recentForm.source === 'currentMatchesFallback')
}

type ReportTone = 'normal' | 'success' | 'warning' | 'danger'
type ReportLine = { text: string; tone: ReportTone }
type ReportSection = { title: string; lines: ReportLine[] }

const reportMatch = computed(() => recent.value?.matches[0] ?? null)
const reportPressureScore = computed(() => {
  const matched = report.value.match(/ELO\s*压力(?:指数)?[：:]\s*(\d{1,3})/i)
  if (!matched) return null
  return Math.max(0, Math.min(100, Number(matched[1])))
})
const reportPressureLabel = computed(() => {
  const score = reportPressureScore.value
  if (score === null) return 'AI 战报'
  if (score >= 80) return '高压局'
  if (score >= 60) return '压力偏高'
  if (score >= 40) return '中等压力'
  return '正常波动'
})
const reportOverviewCards = computed(() => {
  const cards: Array<{ label: string; value: string; hint: string; tone: ReportTone }> = []
  const score = reportPressureScore.value
  cards.push({
    label: 'ELO压力',
    value: score === null ? '未识别' : `${score}/100`,
    hint: reportPressureLabel.value,
    tone: score === null ? 'normal' : score >= 80 ? 'danger' : score >= 60 ? 'warning' : 'success'
  })

  if (recent.value) {
    cards.push({
      label: `最近${recent.value.stats.total}场`,
      value: `${recent.value.stats.winRate}%`,
      hint: `${recent.value.stats.wins}胜${recent.value.stats.losses}负 / KDA ${recent.value.stats.averageKda}`,
      tone: recent.value.stats.winRate >= 50 ? 'success' : recent.value.stats.winRate >= 35 ? 'warning' : 'danger'
    })
  }

  const match = reportMatch.value
  if (match) {
    const vs = matchVsStats(match)
    cards.push({
      label: '我方赛前状态',
      value: `${vs.own.averageWinRate}%`,
      hint: `${vs.own.hot}热手 / ${vs.own.cold}冷手`,
      tone: vs.own.averageWinRate >= 50 ? 'success' : vs.own.averageWinRate >= 35 ? 'warning' : 'danger'
    })
    cards.push({
      label: '对手赛前状态',
      value: `${vs.enemy.averageWinRate}%`,
      hint: `${vs.enemy.hot}热手 / ${vs.enemy.cold}冷手`,
      tone: vs.enemy.averageWinRate >= 50 ? 'danger' : vs.enemy.averageWinRate >= 35 ? 'warning' : 'success'
    })
    const self = currentParticipant(match)
    if (self) {
      const position = displayPosition(self, teamParticipants(match, self.teamId ?? myTeamId(match)), 0)
      cards.push({
        label: '本人本局',
        value: `${match.kills}/${match.deaths}/${match.assists}`,
        hint: `${position} · ${participantChampion(self)}`,
        tone: match.kda >= 3 ? 'success' : match.kda >= 1.5 ? 'warning' : 'danger'
      })
    }
  }

  return cards
})
const reportSections = computed(() => parseReportSections(report.value))

function parseReportSections(text: string): ReportSection[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => cleanReportLine(line))
    .filter(Boolean)
    .filter((line) => !/^[-:|\s]+$/.test(line))

  const sections: ReportSection[] = []
  let current: ReportSection | null = null

  for (const line of lines) {
    if (/^[一二三四五六七八九十]+[、.．]\s*/.test(line)) {
      current = { title: line, lines: [] }
      sections.push(current)
      continue
    }

    if (!current) {
      current = { title: '总览结论', lines: [] }
      sections.push(current)
    }

    current.lines.push({ text: line, tone: reportLineTone(line) })
  }

  return sections
}

function cleanReportLine(line: string) {
  return line
    .trim()
    .replace(/\*\*/g, '')
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '')
    .replace(/\s*\|\s*/g, ' ｜ ')
    .replace(/^-\s*/, '• ')
    .trim()
}

function reportLineTone(line: string): ReportTone {
  if (/失败|劣势|死亡|低状态|不合格|崩|送|压力|冷手|高风险|爆/.test(line)) return 'danger'
  if (/疑似|数据不足|样本|注意|风险|倾向/.test(line)) return 'warning'
  if (/胜利|优势|热手|大腿|合格|正常|可赢/.test(line)) return 'success'
  return 'normal'
}

function championIconUrl(championId?: number) {
  return championId ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png` : ''
}

async function copyReport() {
  await navigator.clipboard.writeText(report.value)
}
</script>

<template>
  <main class="shell dashboard-shell">
    <!-- 顶部工具栏 -->
    <section class="dashboard-toolbar card">
      <div class="toolbar-brand">
        <p class="eyebrow">lolmasite</p>
        <h1>AI 深度分析对局</h1>
        <p class="subtitle">读取 LCU 最近 1/10/20/30 场单双排，调用 AI API 生成中文复盘。</p>
      </div>
      <div class="toolbar-actions">
        <label class="match-limit toolbar-limit">
          <span class="limit-label">分析场次</span>
          <select v-model.number="matchLimit">
            <option :value="1">1 场</option>
            <option :value="10">10 场</option>
            <option :value="20">20 场</option>
            <option :value="30">30 场</option>
          </select>
        </label>
        <button class="btn-secondary" @click="detectSummoner">检测客户端</button>
        <button class="btn-secondary" @click="loadRecentMatches">获取战绩</button>
        <button class="btn-primary" @click="analyze">AI 分析</button>
      </div>
    </section>

    <div class="dashboard-body">
      <aside class="dashboard-sidebar">
        <section class="card sidebar-card">
          <div class="sidebar-section-title">
            <h2>当前账号</h2>
          </div>
          <div class="summoner compact-summoner">{{ summonerName }}</div>
          <p class="sidebar-muted">等级：{{ summoner?.summonerLevel ?? '-' }}</p>
          <div v-if="recent" class="sidebar-metrics">
            <div class="sidebar-metric">
              <span>胜率</span>
              <strong>{{ recent.stats.winRate }}%</strong>
            </div>
            <div class="sidebar-metric">
              <span>胜负</span>
              <strong>{{ recent.stats.wins }}-{{ recent.stats.losses }}</strong>
            </div>
            <div class="sidebar-metric">
              <span>KDA</span>
              <strong>{{ recent.stats.averageKda }}</strong>
            </div>
            <div class="sidebar-metric">
              <span>走势</span>
              <strong>{{ recent.stats.currentStreak }}</strong>
            </div>
          </div>
        </section>

        <section v-if="loading || matchProgress || error" class="card sidebar-card status-panel">
          <div class="sidebar-section-title">
            <h2>运行状态</h2>
          </div>
          <p v-if="loading && !loading.includes('AI') && !matchProgress" class="status compact-status">{{ loading }}</p>
          <div v-if="matchProgress" class="progress-card compact-progress" :class="{ completed: matchProgress.phase === '完成' || matchProgress.phase.includes('完成'), active: isMatchLoading }">
            <div class="progress-meta">
              <span v-if="matchProgress.phase === '完成' || matchProgress.phase.includes('完成')">✅ 战绩获取完成</span>
              <span v-else class="progress-loading-title">⏳ 战绩获取中</span>
              <span v-if="!(matchProgress.phase === '完成' || matchProgress.phase.includes('完成'))" class="progress-loading-detail"><strong>{{ matchProgressPercent }}%</strong> {{ matchProgressPhase }}</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar" :style="{ width: `${matchProgressPercent}%` }" />
            </div>
          </div>
          <p v-if="error" class="error compact-error">{{ error }}</p>
        </section>

        <section class="card sidebar-card">
          <div class="sidebar-section-title">
            <h2>LOL 客户端</h2>
          </div>
          <div class="inline-actions compact-actions">
            <button @click="autoDetectLeagueClient" :disabled="leagueDetecting">{{ leagueDetecting ? '检测中...' : '自动检测' }}</button>
            <button @click="showLeagueAdvanced = !showLeagueAdvanced">{{ showLeagueAdvanced ? '隐藏高级' : '高级设置' }}</button>
          </div>
          <p class="league-help">先打开英雄联盟客户端并登录大厅，然后点“自动检测”。</p>
          <p v-if="leagueDetectMessage" class="saved-message">{{ leagueDetectMessage }}</p>
          <div v-if="leagueDir" class="detected-path">当前路径：{{ leagueDir }}</div>
          <div v-if="showLeagueAdvanced" class="form sidebar-form league-advanced-form">
            <label class="full">League Client 路径<input v-model="leagueDir" placeholder="例如 E:/WeGameApps/英雄联盟/LeagueClient" /></label>
          </div>
        </section>

        <section class="card sidebar-card">
          <div class="sidebar-section-title api-sidebar-title">
            <h2>AI API 设置</h2>
            <a class="api-title-link" href="https://api.8q8k.com/" target="_blank" rel="noopener noreferrer">获取 Key</a>
          </div>
          <div class="api-config-status" :class="aiConfig.apiKey && aiConfig.baseUrl && aiConfig.model ? 'is-ready' : 'is-missing'">
            {{ aiConfig.apiKey && aiConfig.baseUrl && aiConfig.model ? 'API 已配置' : 'API 未完整配置' }}
          </div>
          <div class="api-config-body">
            <div class="inline-actions compact-actions">
              <button @click="saveApiSettings()">保存</button>
              <button @click="clearApiSettings">清空</button>
            </div>
            <p v-if="savedMessage" class="saved-message">{{ savedMessage }}</p>
            <div class="form sidebar-form">
              <label class="secret-field">
                <span class="field-label-row">
                  <span>Base URL</span>
                  <button type="button" class="secret-toggle" @click="showBaseUrl = !showBaseUrl">{{ showBaseUrl ? '隐藏' : '显示' }}</button>
                </span>
                <input v-model="aiConfig.baseUrl" :type="showBaseUrl ? 'text' : 'password'" placeholder="https://你的-ai-api地址/v1" />
              </label>
              <label class="secret-field">
              <span class="field-label-row">
                <span>API Key</span>
                <button type="button" class="secret-toggle" @click="showApiKey = !showApiKey">{{ showApiKey ? '隐藏' : '显示' }}</button>
              </span>
              <input v-model="aiConfig.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." />
            </label>
            <label>Model<input v-model="aiConfig.model" placeholder="模型名称" /></label>
            <label>Temperature<input v-model.number="aiConfig.temperature" type="number" min="0" max="2" step="0.1" /></label>
            <details class="prompt-details full">
              <summary>Prompt 模板</summary>
              <textarea v-model="aiConfig.prompt" rows="8" />
            </details>
            </div>
          </div>
        </section>
      </aside>

      <section class="dashboard-main">
        <section v-if="recent" class="main-summary-grid">
          <article class="card summary-card">
            <span>最近 {{ recent.stats.total }} 场</span>
            <strong>{{ recent.stats.winRate }}%</strong>
            <small>{{ recent.stats.wins }} 胜 {{ recent.stats.losses }} 负</small>
          </article>
          <article class="card summary-card">
            <span>平均 KDA</span>
            <strong>{{ recent.stats.averageKda }}</strong>
            <small>{{ recent.stats.averageKills }}/{{ recent.stats.averageDeaths }}/{{ recent.stats.averageAssists }}</small>
          </article>
          <article class="card summary-card">
            <span>当前走势</span>
            <strong>{{ recent.stats.currentStreak }}</strong>
            <small>基于最近单双排样本</small>
          </article>
        </section>

        <!-- AI 报告 -->
    <section ref="reportSection" class="card report report-dashboard" v-if="report" tabindex="-1">
      <div class="report-title">
        <div>
          <p class="eyebrow">AI BATTLE REPORT</p>
          <h2>AI 对局复盘</h2>
        </div>
        <button @click="copyReport">复制原文</button>
      </div>

      <div class="report-hero" v-if="reportMatch">
        <div class="report-hero-main">
          <div class="champion-avatar large">
            <img v-if="championIconUrl(reportMatch.championId)" :src="championIconUrl(reportMatch.championId)" :alt="reportMatch.championName || '英雄头像'" />
            <span v-else>{{ reportMatch.championName?.slice(0, 1) || '?' }}</span>
          </div>
          <div>
            <p class="report-badge" :class="reportMatch.win ? 'tone-success' : 'tone-danger'">{{ reportMatch.win ? '胜利' : '失败' }}</p>
            <h3>{{ reportMatch.championName || `英雄 ${reportMatch.championId ?? '-'}` }} · {{ reportMatch.kills }}/{{ reportMatch.deaths }}/{{ reportMatch.assists }}</h3>
            <p>{{ matchGameDuration(reportMatch) }} ｜ KDA {{ reportMatch.kda }} ｜ {{ reportPressureLabel }}</p>
          </div>
        </div>
        <div v-if="reportPressureScore !== null" class="pressure-ring" :style="{ '--score': `${reportPressureScore}%` }">
          <strong>{{ reportPressureScore }}</strong>
          <span>压力指数</span>
        </div>
      </div>

      <div class="report-overview-grid">
        <div v-for="card in reportOverviewCards" :key="card.label" class="report-metric" :class="`tone-${card.tone}`">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </div>
      </div>

      <div class="report-lineups" v-if="reportMatch">
        <div v-for="teamId in orderedTeamIds(reportMatch)" :key="teamId" class="lineup-card" :class="teamId === myTeamId(reportMatch) ? 'lineup-own' : 'lineup-enemy'">
          <div class="lineup-title">
            <strong>{{ teamSideLabel(reportMatch, teamId) }}</strong>
            <span>{{ teamId === 100 ? '蓝方' : '红方' }}</span>
          </div>
          <div class="lineup-icons">
            <div v-for="(p, idx) in sortedTeamParticipants(reportMatch, teamId)" :key="`${teamId}-${p.summonerName}-${p.championId}`" class="lineup-player" :title="`${participantChampion(p)} ${displayPosition(p, teamParticipants(reportMatch, teamId), idx)} ${p.kills}/${p.deaths}/${p.assists}`">
              <img v-if="championIconUrl(p.championId)" :src="championIconUrl(p.championId)" :alt="participantChampion(p)" />
              <span v-else>{{ participantChampion(p).slice(0, 1) }}</span>
              <small>{{ positionIcon(displayPosition(p, teamParticipants(reportMatch, teamId), idx)) }}</small>
            </div>
          </div>
        </div>
      </div>

      <div class="report-sections">
        <article v-for="section in reportSections" :key="section.title" class="report-section-card">
          <h3>{{ section.title }}</h3>
          <ul>
            <li v-for="(line, idx) in section.lines" :key="idx" :class="`tone-${line.tone}`">{{ line.text }}</li>
          </ul>
        </article>
      </div>

      <details class="raw-report">
        <summary>查看完整 AI 原文</summary>
        <pre>{{ report }}</pre>
      </details>
    </section>

        <!-- 设置区 -->
        <section v-if="!recent" class="card empty-state">
          <p class="eyebrow">WAITING FOR DATA</p>
          <h2>等待战绩数据</h2>
          <p>请先检测客户端并获取最近战绩，右侧会展示对局详情和 AI 分析结果。</p>
        </section>

        <!-- ==================== 对局详情（新设计） ==================== -->
        <section v-if="recent" class="matches-section" :class="{ 'matches-loading': isMatchLoading }">
          <div class="section-heading">
            <div>
              <p class="eyebrow">MATCH ANALYSIS</p>
              <h2>最近对局详情</h2>
            </div>
            <span class="section-count">{{ recent.matches.length }} 场</span>
          </div>
          <div v-if="loading.includes('AI')" class="ai-status-banner match-ai-status">
            <div class="loading-spinner" />
            <div>
              <strong>{{ loading }}</strong>
              <p>旧复盘已收起，完成后会显示最新分析。</p>
            </div>
          </div>
          <div v-if="isMatchLoading" class="matches-loading-banner">
        <div class="loading-spinner" />
        <div>
          <strong>战绩获取中</strong>
          <p>玩家近期胜率正在逐个加载，当前显示的是临时/部分数据，请等待完成后再判断。</p>
        </div>
      </div>
      <div class="matches">
        <div v-for="match in recent.matches" :key="match.gameId" class="match-card" :class="match.win ? 'match-win' : 'match-lose'">

          <!-- 第一层：对局结果摘要 -->
          <div class="match-header">
            <div class="match-result" :class="match.win ? 'result-win' : 'result-lose'">
              <span class="result-label">{{ match.win ? '胜利' : '失败' }}</span>
            </div>
            <div class="match-meta">
              <span class="match-champion">{{ match.championName || `英雄 ${match.championId ?? '-'}` }}</span>
              <span class="match-kda">{{ match.kills }}/{{ match.deaths }}/{{ match.assists }}</span>
              <span class="match-kda-ratio">KDA {{ match.kda }}</span>
            </div>
            <div class="match-duration">{{ matchGameDuration(match) }}</div>
            <!-- 双方胜率对比条 -->
            <div v-if="matchVsStats(match).own.count > 0" class="winrate-compare">
              <div class="winrate-bar-container">
                <div class="winrate-bar-label">
                  <span class="team-label blue-label">我方</span>
                  <span class="winrate-value" :style="{ color: winRateColor(matchVsStats(match).own.averageWinRate) }">{{ matchVsStats(match).own.averageWinRate }}%</span>
                </div>
                <div class="winrate-bar-track">
                  <div class="winrate-bar-fill blue-fill" :style="{ width: `${matchVsStats(match).own.averageWinRate}%` }" />
                </div>
              </div>
              <div class="winrate-bar-container">
                <div class="winrate-bar-label">
                  <span class="team-label red-label">对手</span>
                  <span class="winrate-value" :style="{ color: winRateColor(matchVsStats(match).enemy.averageWinRate) }">{{ matchVsStats(match).enemy.averageWinRate }}%</span>
                </div>
                <div class="winrate-bar-track">
                  <div class="winrate-bar-fill red-fill" :style="{ width: `${matchVsStats(match).enemy.averageWinRate}%` }" />
                </div>
              </div>
            </div>
          </div>

          <!-- 第二层：双方阵容对比 -->
          <div class="teams-container">
            <div v-for="teamId in orderedTeamIds(match)" :key="teamId" class="team-panel" :class="teamId === myTeamId(match) ? 'team-own' : 'team-enemy'">
              <div class="team-header">
                <span class="team-name">{{ teamSideLabel(match, teamId) }}</span>
                <span class="team-side">{{ teamId === 100 ? '蓝方' : '红方' }}</span>
                <span class="team-result" :class="teamParticipants(match, teamId)[0]?.win ? 'tr-win' : 'tr-lose'">{{ teamParticipants(match, teamId)[0]?.win ? '胜' : '负' }}</span>
              </div>
              <div class="player-cards">
                <div v-for="(p, idx) in sortedTeamParticipants(match, teamId)" :key="`${match.gameId}-${teamId}-${p.summonerName}-${p.championId}`" class="player-card" :class="{ 'is-self': p.championId === match.championId && p.kills === match.kills && p.deaths === match.deaths && p.assists === match.assists }">
                  <div class="pc-avatar">
                    <img v-if="championIconUrl(p.championId)" :src="championIconUrl(p.championId)" :alt="participantChampion(p)" />
                    <span v-else>{{ participantChampion(p).slice(0, 1) }}</span>
                  </div>
                  <div class="pc-main">
                    <div class="pc-row1">
                      <span class="pc-champion">{{ participantChampion(p) }}</span>
                      <span class="pc-position">{{ positionIcon(displayPosition(p, teamParticipants(match, teamId), idx)) }} {{ displayPosition(p, teamParticipants(match, teamId), idx) }}</span>
                    </div>
                    <div class="pc-name" :title="p.summonerName || '未知召唤师'">{{ p.summonerName || '未知' }}</div>
                    <div class="pc-row3">
                      <span class="pc-kda" :class="{ 'kda-good': playerKdaScore(p) >= 3, 'kda-bad': playerKdaScore(p) < 1.5 }">{{ p.kills }}/{{ p.deaths }}/{{ p.assists }}</span>
                      <span class="pc-stat">⚔️ {{ p.totalDamageDealtToChampions ?? '-' }}</span>
                      <span class="pc-stat">💰 {{ p.goldEarned ?? '-' }}</span>
                    </div>
                  </div>
                  <div class="pc-form" v-if="p.recentForm">
                    <div v-if="isParticipantFormLoading(p)" class="form-loading-badge">⏳</div>
                    <div class="form-bar-label">
                      <span class="form-rate" :style="{ color: winRateColor(p.recentForm.winRate) }">{{ p.recentForm.winRate }}%</span>
                      <span class="form-detail">{{ p.recentForm.wins }}胜{{ p.recentForm.losses }}负</span>
                    </div>
                    <div class="form-bar-track">
                      <div class="form-bar-fill" :style="{ width: `${p.recentForm.winRate}%`, background: winRateColor(p.recentForm.winRate) }" />
                    </div>
                    <div v-if="p.recentForm.confidence === 'low'" class="form-low-confidence">样本有限</div>
                  </div>
                  <div class="pc-form pc-form-empty" v-else>
                    <span class="form-no-data">{{ isMatchLoading ? '⏳ 获取中' : '数据不足' }}</span>
                  </div>
                  <div v-if="playerTag(p, match)" class="player-tag" :title="playerTagText(p, match)">{{ playerTag(p, match) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        </section>
      </section>
    </div>
  </main>
</template>
