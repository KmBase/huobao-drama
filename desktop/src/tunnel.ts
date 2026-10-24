/**
 * 内网穿透管理器（cloudflared 托管）
 *
 * Agnes 等协议只接受"上游可公开访问"的媒体 URL（官方明确不支持 Base64），
 * 桌面版本地生成的图片/音频必须经公网出口回源。这里内置 cloudflared 二进制，
 * 由主进程拉起隧道并把得到的公网地址写入后端设置（app_settings.public_media_base_url），
 * 生成链路据此把本地 static 路径解析成公网 URL。
 *
 * 两种模式：
 * - quick：匿名快速隧道（`tunnel --url`），地址由 cloudflared 动态分配（*.trycloudflare.com），
 *   从 stderr 解析。零配置，但地址每次启动都会变。
 * - token：命名隧道（`tunnel run --token`），域名在 Cloudflare 控制台绑定，固定地址由用户填。
 *
 * 风险提示（配置页同步展示）：quick 隧道整站转发，后端 /api/v1/* 会一并暴露，
 * 建议改用命名隧道 + ingress 只放行 /static/*。
 */
import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import * as fs from 'fs'
import * as path from 'path'

export type TunnelMode = 'quick' | 'token'
export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unavailable'

export interface TunnelConfig {
  /** 应用启动时自动开启隧道 */
  autoStart: boolean
  mode: TunnelMode
  /** 命名隧道 token（token 模式必填） */
  token: string
  /** 命名隧道在 Cloudflare 控制台绑定的公网地址（token 模式由用户填写） */
  publicUrl: string
  /** 自定义 cloudflared 可执行文件路径（内置二进制缺失时兜底） */
  binaryPath: string
  /**
   * 后端固定端口偏好（默认 5679）。
   * 穿透地址指向固定端口才有意义：每次启动随机端口会让配置的隧道立刻失效。
   */
  backendPort: number
}

export interface TunnelState {
  status: TunnelStatus
  mode: TunnelMode
  /** quick 模式解析到的地址 / token 模式用户填写的地址 */
  publicUrl: string
  error: string
  /** 最近日志（诊断用，尾部截断） */
  log: string[]
}

const CONFIG_FILE = 'tunnel-config.json'
/** 隧道就绪超时：快捷隧道拿地址 / 命名隧道边缘注册（实测首次注册含 DNS 重试可达 15s+） */
const READY_TIMEOUT_MS = 45_000
const LOG_LIMIT = 40

const DEFAULT_CONFIG: TunnelConfig = { autoStart: false, mode: 'quick', token: '', publicUrl: '', binaryPath: '', backendPort: 5679 }

let config: TunnelConfig = { ...DEFAULT_CONFIG }
let state: TunnelState = { status: 'stopped', mode: 'quick', publicUrl: '', error: '', log: [] }
let child: ReturnType<typeof spawn> | null = null
let getWindow: () => BrowserWindow | null = () => null
let backendPort = 0

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function loadConfig(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    config = {
      autoStart: !!parsed?.autoStart,
      mode: parsed?.mode === 'token' ? 'token' : 'quick',
      token: typeof parsed?.token === 'string' ? parsed.token : '',
      publicUrl: typeof parsed?.publicUrl === 'string' ? parsed.publicUrl.trim() : '',
      binaryPath: typeof parsed?.binaryPath === 'string' ? parsed.binaryPath : '',
      backendPort: toValidPort(parsed?.backendPort) ?? DEFAULT_CONFIG.backendPort,
    }
  } catch {
    config = { ...DEFAULT_CONFIG }
  }
}

function toValidPort(v: unknown): number | null {
  const port = Number(v)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/**
 * 读后端固定端口偏好（供主进程在拉起后端前决定监听端口）。
 * 独立于模块内 config 状态：bootstrap 阶段就要用，避免初始化顺序耦合。
 */
export function loadBackendPortPreference(): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return toValidPort(parsed?.backendPort)
  } catch {
    return null
  }
}

function saveConfig(): void {
  const file = configPath()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2))
  fs.renameSync(tmp, file)
}

/** 内置二进制：打包后 resources/bin/cloudflared(.exe)；dev 走 desktop/build/bin */
function resolveBinary(): string | null {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  // mac 包对 arm64/x64 双架构出 dmg，但 bin 目录共用 → 按架构挑二进制
  const archSuffix = process.platform === 'darwin' ? `-${process.arch === 'arm64' ? 'arm64' : 'x64'}` : ''
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'bin', exe),
        path.join(process.resourcesPath, 'bin', `cloudflared${archSuffix}`),
      ]
    : [
        path.join(app.getAppPath(), 'build', 'bin', exe),
        path.join(app.getAppPath(), 'build', 'bin', `cloudflared${archSuffix}`),
        path.join(process.resourcesPath, 'bin', exe),
      ]
  if (config.binaryPath && fs.existsSync(config.binaryPath)) return config.binaryPath
  return candidates.find(p => fs.existsSync(p)) || null
}

function pushState(): void {
  getWindow()?.webContents.send('huobao:tunnel-state', state)
}

function log(line: string): void {
  const text = line.trim()
  if (!text) return
  state.log = [...state.log, text].slice(-LOG_LIMIT)
  pushState()
}

/** 把公网地址写进后端设置；失败不中断隧道（后端重启后会再同步） */
async function syncBackendUrl(url: string): Promise<void> {
  if (!backendPort) return
  try {
    await fetch(`http://127.0.0.1:${backendPort}/api/v1/settings/public-media-base-url`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch (err) {
    log(`同步后端设置失败: ${(err as Error).message}`)
  }
}

let stopping = false

/** 主动终止子进程（停止 / 退出前）。stopping 标记让 exit 回调不误报「异常退出」 */
function stopChild(): void {
  if (!child) return
  stopping = true
  try { child.kill() } catch { /* 已退出 */ }
  child = null
}

/**
 * 启动隧道。返回最终状态；快捷隧道在超时内未拿到地址时置 error。
 */
async function start(originPort: number): Promise<TunnelState> {
  if (state.status === 'starting' || state.status === 'running') return state
  stopChild()

  if (config.mode === 'token' && (!config.token.trim() || !/^https?:\/\//i.test(config.publicUrl.trim()))) {
    state = {
      status: 'error',
      mode: config.mode,
      publicUrl: '',
      error: '命名隧道需要先填写 Tunnel Token 与公网域名地址',
      log: state.log,
    }
    pushState()
    return state
  }

  backendPort = originPort

  const binary = resolveBinary()
  if (!binary) {
    state = {
      status: 'unavailable',
      mode: config.mode,
      publicUrl: '',
      error: '未找到 cloudflared 二进制（内置缺失且未在设置中指定自定义路径）',
      log: state.log,
    }
    pushState()
    return state
  }

  // flag 层级（cloudflared 2026.x）：--no-autoupdate/--url 属于 tunnel 级（必须在 run 之前），
  // --token 属于 run 级；--protocol 已被移除，边缘协议默认 auto（QUIC 失败自动回落 http2）
  const args = config.mode === 'token'
    ? ['tunnel', '--no-autoupdate', 'run', '--token', config.token.trim()]
    : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${originPort}`]

  state = { status: 'starting', mode: config.mode, publicUrl: '', error: '', log: state.log }
  pushState()

  try {
    child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    state = { ...state, status: 'error', error: `cloudflared 启动失败: ${(err as Error).message}` }
    pushState()
    return state
  }
  stopping = false

  const proc = child
  const onData = (chunk: Buffer) => {
    const text = chunk.toString()
    log(text)
    if (state.status !== 'starting') return
    // 成功标志：快捷隧道 = 日志里出现 trycloudflare 地址；命名隧道 = 边缘注册成功
    const quickMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
    if (quickMatch) {
      state = { ...state, status: 'running', publicUrl: quickMatch[0] }
      pushState()
      void syncBackendUrl(state.publicUrl)
      return
    }
    if (config.mode === 'token' && /Registered tunnel connection/i.test(text)) {
      state = { ...state, status: 'running', publicUrl: config.publicUrl.trim() }
      pushState()
      void syncBackendUrl(state.publicUrl)
    }
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)

  proc.on('exit', (code) => {
    if (child !== proc) return // 已被新进程替代，忽略旧进程的退出事件
    child = null
    // 主动停止（用户点停止 / 应用退出）：不改写状态，仅清掉后端里的失效地址
    if (stopping) {
      if (backendPort) void syncBackendUrl('')
      return
    }
    // 异常退出（含 token 失效、连不上边缘、参数错误等）：带上最后一条日志方便定位
    if (code !== 0) {
      const lastLog = [...state.log].reverse().find(l => l.trim()) || ''
      state = {
        ...state,
        status: 'error',
        error: `cloudflared 异常退出（code ${code ?? 'null'}）${lastLog ? `：${lastLog.slice(-160)}` : ''}`,
        publicUrl: '',
      }
      pushState()
      if (backendPort) void syncBackendUrl('')
      return
    }
    state = { ...state, status: 'stopped', error: '', publicUrl: '' }
    pushState()
    if (backendPort) void syncBackendUrl('')
  })

  // 统一等待就绪标志：快捷隧道 = trycloudflare 地址出现；命名隧道 = 边缘注册成功
  const ok = await new Promise<boolean>((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (state.status === 'running') { clearInterval(timer); resolve(true) }
      else if (Date.now() - started > READY_TIMEOUT_MS) { clearInterval(timer); resolve(false) }
    }, 200)
  })
  if (!ok) {
    const hint = config.mode === 'token'
      ? '等待隧道在边缘注册超时（30s），请检查网络或 Token 是否有效后重试'
      : `等待 trycloudflare 地址超时（${READY_TIMEOUT_MS / 1000}s），请检查网络后重试，或改用命名隧道模式`
    state = { ...state, status: 'error', error: hint }
    pushState()
    stopChild()
  }
  return state
}

async function stop(): Promise<TunnelState> {
  stopChild()
  state = { ...state, status: 'stopped', publicUrl: '', error: '' }
  pushState()
  await syncBackendUrl('')
  return state
}

export function getTunnelState(): TunnelState {
  return state
}

export function registerTunnelIpc(deps: { getWindow: () => BrowserWindow | null, getPort: () => number }): void {
  getWindow = deps.getWindow
  loadConfig()
  ipcMain.handle('huobao:tunnel-state', () => state)
  ipcMain.handle('huobao:tunnel-config', () => config)
  ipcMain.handle('huobao:tunnel-set-config', (_event, next: Partial<TunnelConfig>) => {
    config = {
      ...config,
      autoStart: next.autoStart ?? config.autoStart,
      mode: next.mode ?? config.mode,
      token: next.token ?? config.token,
      publicUrl: (next.publicUrl ?? config.publicUrl).trim(),
      binaryPath: next.binaryPath ?? config.binaryPath,
      backendPort: toValidPort(next.backendPort) ?? config.backendPort,
    }
    saveConfig()
    return config
  })
  ipcMain.handle('huobao:tunnel-start', () => start(deps.getPort()))
  ipcMain.handle('huobao:tunnel-stop', () => stop())
}

/** 应用启动后（后端 healthy、拿到端口）调用：按配置自启隧道 */
export function autoStartTunnel(originPort: number): void {
  if (!config.autoStart) return
  void start(originPort)
}

/** 应用退出前调用，防止 cloudflared 进程残留 */
export function shutdownTunnel(): void {
  stopChild()
}
