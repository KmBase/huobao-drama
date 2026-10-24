/**
 * 打包资源准备 — 组装 desktop/resources/（electron-builder extraResources 的来源）
 *
 * 1. frontend/           ← nuxt generate 产物（.output/public，含 index.html）
 * 2. workspace-template/ ← backend/workspace（skills + prompts，首启动拷入 userData）
 * 3. bin-<os>/           ← ffmpeg/ffprobe/cloudflared 按平台分目录（electron-builder ${os}
 *                          宏各取所需，避免 mac 包带 exe、win 包带 mac 二进制白白 +144MB）
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(__dirname, '..')
const REPO = path.resolve(DESKTOP, '..')
const RES = path.join(DESKTOP, 'resources')

fs.rmSync(RES, { recursive: true, force: true })
fs.mkdirSync(RES, { recursive: true })

// 1. 前端静态产物
const frontendSrc = path.join(REPO, 'frontend', '.output', 'public')
if (!fs.existsSync(path.join(frontendSrc, 'index.html'))) {
  console.error('缺少前端产物：请先在 frontend/ 执行 npm run generate')
  process.exit(1)
}
fs.cpSync(frontendSrc, path.join(RES, 'frontend'), { recursive: true })
console.log('resources/frontend ✓')

// 2. workspace 模板（skills 技能 + prompts 提示词）
const workspaceSrc = path.join(REPO, 'backend', 'workspace')
fs.cpSync(workspaceSrc, path.join(RES, 'workspace-template'), { recursive: true })
console.log('resources/workspace-template ✓')

// 3. ffmpeg 二进制（macOS/Linux 用 ffmpeg-static 当前平台的产物；
//    Windows 交叉打包：ffmpeg.exe 从 ffmpeg-static GitHub release 获取（本地缓存），
//    ffprobe.exe 直接用 ffprobe-static 自带的 win32/x64 产物）
const req = createRequire(import.meta.url)
const binMac = path.join(RES, 'bin-mac')
const binWin = path.join(RES, 'bin-win')
fs.mkdirSync(binMac, { recursive: true })
fs.mkdirSync(binWin, { recursive: true })
const ffmpegPath = req('ffmpeg-static')
const ffprobePath = req('ffprobe-static')?.path
if (!ffmpegPath || !ffprobePath || !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
  console.error('ffmpeg-static/ffprobe-static 二进制缺失，请重新 npm install（或配置 FFMPEG_BINARIES_URL 镜像）')
  process.exit(1)
}
fs.copyFileSync(ffmpegPath, path.join(binMac, 'ffmpeg'))
fs.copyFileSync(ffprobePath, path.join(binMac, 'ffprobe'))
fs.chmodSync(path.join(binMac, 'ffmpeg'), 0o755)
fs.chmodSync(path.join(binMac, 'ffprobe'), 0o755)
console.log('resources/bin-mac ✓')

// 3b. Windows 二进制（打 win 包用；不打 win 包时缺失不报错，仅提示）
const winBinDir = path.join(DESKTOP, 'build', 'win-bin')
const ffmpegWin = path.join(winBinDir, 'ffmpeg.exe')
const ffprobeWinSrc = path.join(path.dirname(req.resolve('ffprobe-static/package.json')), 'bin', 'win32', 'x64', 'ffprobe.exe')
if (!fs.existsSync(ffmpegWin)) {
  console.warn('提示: 缺少 build/win-bin/ffmpeg.exe，Windows 包将无法内置 ffmpeg。' +
    '获取: https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64')
}
if (fs.existsSync(ffmpegWin) && fs.existsSync(ffprobeWinSrc)) {
  fs.copyFileSync(ffmpegWin, path.join(binWin, 'ffmpeg.exe'))
  fs.copyFileSync(ffprobeWinSrc, path.join(binWin, 'ffprobe.exe'))
  console.log('resources/bin-win ✓')
}

const CLOUDFLARED_BASE = 'github.com/cloudflare/cloudflared/releases/latest/download'
/**
 * GitHub 加速镜像（国内网络直连大文件常被重置）：镜像前缀 + 完整 GitHub 路径。
 * 顺序即优先级，全部失败再直连 GitHub 兜底；镜像失效时改这个列表即可。
 */
const GH_MIRROR_PREFIXES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
]
/** 单个 URL 的下载超时：镜像慢速下 50MB 需数分钟，取宽值；网络不通时不会无限挂起 */
const DOWNLOAD_TIMEOUT_MS = Number(process.env.CLOUDFLARED_DOWNLOAD_TIMEOUT_MS) || 300_000

const CLOUDFLARED_SOURCES = {
  'cloudflared.exe': `${CLOUDFLARED_BASE}/cloudflared-windows-amd64.exe`,
  'cloudflared-arm64': `${CLOUDFLARED_BASE}/cloudflared-darwin-arm64.tgz`,
  'cloudflared-x64': `${CLOUDFLARED_BASE}/cloudflared-darwin-amd64.tgz`,
}

// 4. cloudflared 二进制（内网穿透托管；Agnes 等协议只收公网媒体 URL）
//    - win x64：官方单文件 exe
//    - darwin：官方 tgz（arm64/x64 双架构各一，运行时按 process.arch 挑）
//    查找顺序：build/bin 本地缓存 → GitHub Release 下载
await bundleCloudflared(binMac, binWin)

async function bundleCloudflared(binMacDir, binWinDir) {
  const cacheDir = path.join(DESKTOP, 'build', 'bin')
  fs.mkdirSync(cacheDir, { recursive: true })
  const jobs = [
    { target: path.join(binWinDir, 'cloudflared.exe'), cache: path.join(cacheDir, 'cloudflared.exe'), source: CLOUDFLARED_SOURCES['cloudflared.exe'] },
    { target: path.join(binMacDir, 'cloudflared-arm64'), cache: path.join(cacheDir, 'cloudflared-arm64'), source: CLOUDFLARED_SOURCES['cloudflared-arm64'] },
    { target: path.join(binMacDir, 'cloudflared-x64'), cache: path.join(cacheDir, 'cloudflared-x64'), source: CLOUDFLARED_SOURCES['cloudflared-x64'] },
  ]
  for (const job of jobs) {
    if (fs.existsSync(job.cache)) {
      fs.copyFileSync(job.cache, job.target)
      fs.chmodSync(job.target, 0o755)
      console.log(`resources/bin ✓ cloudflared（本地缓存 ${path.basename(job.cache)}）`)
      continue
    }
    try {
      const buffer = await downloadBinary(job.source)
      if (job.source.endsWith('.tgz')) {
        // darwin 官方产物是 tgz，内含名为 cloudflared 的单文件；零依赖解包
        const inner = extractFirstTarFile(zlib.gunzipSync(buffer))
        fs.writeFileSync(job.cache, inner, { mode: 0o755 })
      } else {
        fs.writeFileSync(job.cache, buffer, { mode: 0o755 })
      }
      fs.copyFileSync(job.cache, job.target)
      fs.chmodSync(job.target, 0o755)
      console.log(`resources/bin ✓ cloudflared（已下载 ${path.basename(job.source)}）`)
    } catch (err) {
      console.error(
        `cloudflared 获取失败：${err?.message || String(err)}\n` +
        `  打包要求内置 cloudflared（内网穿透）。请手动下载后放入 ${cacheDir}（任一下载源）：\n` +
        Object.values(CLOUDFLARED_SOURCES).map(p =>
          `  - https://${p}\n    ${GH_MIRROR_PREFIXES.map(m => `${m}https://${p}`).join('\n    ')}`,
        ).join('\n'),
      )
      process.exit(1)
    }
  }
}

/** 镜像优先逐个尝试（ghfast.top → gh-proxy.com → 直连 GitHub），任一成功即返回 */
function buildCandidateUrls(ghPath) {
  return [...GH_MIRROR_PREFIXES.map(prefix => `${prefix}https://${ghPath}`), `https://${ghPath}`]
}

async function downloadBinary(ghPath) {
  const candidates = buildCandidateUrls(ghPath)
  const errors = []
  for (const url of candidates) {
    const source = new URL(url).host
    try {
      const buffer = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          return Buffer.from(await resp.arrayBuffer())
        })
      console.log(`  ✓ 经 ${source} 下载成功（${(buffer.length / 1024 / 1024).toFixed(1)}MB）`)
      return buffer
    } catch (err) {
      errors.push(`${source}: ${err?.name === 'TimeoutError' ? `超时（>${DOWNLOAD_TIMEOUT_MS / 1000}s）` : err?.message || String(err)}`)
    }
  }
  throw new Error(`所有下载源均失败 —— ${errors.join('；')}`)
}

/** 极简 tar 读取：取包内第一个普通文件的内容（cloudflared tgz 只有一个文件） */
function extractFirstTarFile(buffer) {
  for (let offset = 0; offset + 512 <= buffer.length; offset += 512) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(b => b === 0)) break
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim() || '0', 8) || 0
    const typeflag = String.fromCharCode(header[156] || 48)
    const dataStart = offset + 512
    if (typeflag === '0' || typeflag === '\0') {
      return buffer.subarray(dataStart, dataStart + size)
    }
    offset += Math.ceil(size / 512) * 512 - 512 // 跳过文件数据块
  }
  throw new Error('tgz 内未找到普通文件')
}
