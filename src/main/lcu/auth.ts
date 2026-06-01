import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { LcuCredentials } from '../types.js'

const defaultInstallDirs = [
  ...['C', 'D', 'E', 'F', 'G'].flatMap((drive) => [
    `${drive}:/Riot Games/League of Legends`,
    `${drive}:/Program Files/Riot Games/League of Legends`,
    `${drive}:/Program Files (x86)/Riot Games/League of Legends`,
    `${drive}:/WeGameApps/英雄联盟`,
    `${drive}:/WeGameApps/英雄联盟/LeagueClient`,
    `${drive}:/WeGameApps/英雄联盟/League of Legends`
  ])
]

export type LeagueClientDetection = {
  ok: boolean
  leagueDir?: string
  source?: 'custom' | 'process' | 'commonPath'
  error?: string
}

export function detectLeagueClient(customDir?: string): LeagueClientDetection {
  const customDirResult = customDir ? findLeagueClientDirInDirs(getCustomCandidateDirs(customDir)) : null
  if (customDirResult) {
    return { ok: true, leagueDir: customDirResult.replace(/\\/g, '/'), source: 'custom' }
  }

  const processDir = findLeagueClientDirFromProcess()
  if (processDir) {
    return { ok: true, leagueDir: processDir.replace(/\\/g, '/'), source: 'process' }
  }

  const commonDir = findLeagueClientDirInDirs(defaultInstallDirs)
  if (commonDir) {
    return { ok: true, leagueDir: commonDir.replace(/\\/g, '/'), source: 'commonPath' }
  }

  return {
    ok: false,
    error: '未自动检测到 League Client。请先打开英雄联盟客户端并登录到大厅；如果仍失败，再到高级设置手动填写路径。'
  }
}

export function findLockfilePath(customDir?: string) {
  const normalizedCustomDir = customDir ? normalizeClientPath(customDir) : undefined
  const dirs = normalizedCustomDir
    ? [
        ...getCustomCandidateDirs(normalizedCustomDir),
        ...defaultInstallDirs
      ]
    : defaultInstallDirs
  for (const dir of dirs) {
    const lockfile = join(dir, 'lockfile')
    if (isValidLockfile(lockfile)) {
      return lockfile
    }
  }

  const processLockfile = findLockfileFromLeagueProcess()
  if (processLockfile) {
    return processLockfile
  }

  return null
}

function getCustomCandidateDirs(customDir: string) {
  const normalizedCustomDir = normalizeClientPath(customDir)
  return [
    normalizedCustomDir,
    join(normalizedCustomDir, 'LeagueClient'),
    join(dirname(normalizedCustomDir), 'LeagueClient')
  ]
}

function findLeagueClientDirInDirs(dirs: string[]) {
  for (const dir of dirs) {
    if (existsSync(join(dir, 'LeagueClientUx.exe')) || existsSync(join(dir, 'LeagueClient.exe')) || existsSync(join(dir, 'lockfile'))) {
      return dir
    }
  }
  return null
}

function findLockfileInDirs(dirs: string[]) {
  for (const dir of dirs) {
    const lockfile = join(dir, 'lockfile')
    if (isValidLockfile(lockfile)) return lockfile
  }
  return null
}

function normalizeClientPath(input: string) {
  const normalized = input.replace(/\\/g, '/').trim()
  return extname(normalized) ? dirname(normalized) : normalized
}

function isValidLockfile(lockfile: string) {
  return existsSync(lockfile) && readFileSync(lockfile, 'utf8').trim().split(':').length >= 5
}

function findLeagueClientDirFromProcess() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -First 1 -ExpandProperty ExecutablePath"
    ], { encoding: 'utf8', windowsHide: true }).trim()
    return output ? dirname(output) : null
  } catch {
    return null
  }
}

function findLockfileFromLeagueProcess() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -First 1 -ExpandProperty ExecutablePath"
    ], { encoding: 'utf8', windowsHide: true }).trim()
    if (!output) return null

    const lockfile = join(dirname(output), 'lockfile')
    return isValidLockfile(lockfile) ? lockfile : null
  } catch {
    return null
  }
}

function readCredentialsFromCommandLine(): LcuCredentials | null {
  try {
    const commandLine = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Where-Object { $_.CommandLine } | Select-Object -First 1 -ExpandProperty CommandLine"
    ], { encoding: 'utf8', windowsHide: true })

    const port = matchCommandLineValue(commandLine, 'app-port')
    const password = matchCommandLineValue(commandLine, 'remoting-auth-token')
    if (!port || !password) return null

    return {
      port: Number(port),
      password,
      protocol: 'https'
    }
  } catch {
    return null
  }
}

function matchCommandLineValue(commandLine: string, key: string) {
  return commandLine.match(new RegExp(`--${key}=([^\\s\"]+)`))?.[1]
}

function readCredentialsFromLogs(customDir?: string): LcuCredentials | null {
  const roots = customDir ? [normalizeClientPath(customDir), join(normalizeClientPath(customDir), 'LeagueClient')] : []
  roots.push(...defaultInstallDirs)

  const logs = roots.flatMap((root) => getRecentLeagueUxLogs(root)).sort((a, b) => b.mtime - a.mtime)
  for (const log of logs.slice(0, 20)) {
    try {
      const content = readFileSync(log.path, 'utf8')
      const port = matchCommandLineValue(content, 'app-port')
      const password = matchCommandLineValue(content, 'remoting-auth-token')
      if (port && password) {
        return {
          port: Number(port),
          password,
          protocol: 'https'
        }
      }
    } catch {}
  }

  return null
}

function getRecentLeagueUxLogs(root: string) {
  try {
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((name) => /LeagueClientUx.*\.log$/i.test(name))
      .map((name) => {
        const path = join(root, name)
        return { path, mtime: statSync(path).mtimeMs }
      })
  } catch {
    return []
  }
}

export function readLcuCredentials(customDir?: string): LcuCredentials {
  const logCredentials = readCredentialsFromLogs(customDir)
  if (logCredentials) {
    return logCredentials
  }

  const commandLineCredentials = readCredentialsFromCommandLine()
  if (commandLineCredentials) {
    return commandLineCredentials
  }

  const lockfile = findLockfilePath(customDir)
  if (!lockfile) {
    throw new Error('没有找到有效的 League Client lockfile，也无法从进程命令行或日志读取 LCU 参数。')
  }

  const [name, pid, port, password, protocol] = readFileSync(lockfile, 'utf8').trim().split(':')
  if (!name || !pid || !port || !password || !protocol) {
    throw new Error('lockfile 格式异常，无法读取 LCU 连接信息。')
  }

  return {
    port: Number(port),
    password,
    protocol
  }
}
