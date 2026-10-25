import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import tasks from './routes/tasks.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import stylePresets from './routes/stylePresets.js'
import stylePacks from './routes/stylePacks.js'
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import settings from './routes/settings.js'
import access from './routes/access.js'
import capabilities from './routes/capabilities.js'
import storage from './routes/storage.js'
import serverUpdate from './routes/serverUpdate.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { getCookie } from 'hono/cookie'
import { DATA_ROOT } from './utils/paths.js'
import { IS_SERVERLESS } from './utils/runtime-mode.js'
import { blobUrlFor } from './utils/storage.js'
import { hasAccessPassword, isTokenValid, isMediaTokenValid, ACCESS_COOKIE, ensureInitialAccessPassword } from './services/access-auth.js'
import { recoverInterruptedTasks } from './services/generation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// CORS：页面源无法枚举——桌面窗口是 http://127.0.0.1:5679（与 localhost:5679 不同源），
// 隧道域名动态分配（*.trycloudflare.com）或用户自有命名域名；API 无鉴权无 cookie
//（credentials 关闭，ACAO:* 符合规范），故放开为全源。跨源读取风险已在隧道开关处提示。
app.use('*', cors())
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check（version 供部署巡检/更新检查核对当前运行版本）
app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  version: process.env.HUOBAO_VERSION || undefined,
  timestamp: new Date().toISOString(),
}))

// 访问密码鉴权：启用后拦截 /api/* 与 /static/*（前端 HTML 放行，锁屏交互在 SPA 内完成）。
// 令牌来源优先级：cookie（页面请求自动携带）> x-access-token 头 > ?token= 查询参数（外链下载用）。
// 登录/状态接口与 health 豁免，否则用户会被锁死在外。
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path === '/api/v1/health' || path.startsWith('/api/v1/access/')) return next()
  if (!(await hasAccessPassword())) return next()
  const token = getCookie(c, ACCESS_COOKIE) || c.req.header('x-access-token')
    || new URL(c.req.url).searchParams.get('token') || undefined
  if (await isTokenValid(token)) return next()
  return c.json({ code: 401, message: 'UNAUTHORIZED' }, 401)
})
// /static/* 额外接受 ?token= 里的媒体令牌（仅放行静态媒体、不能调 API）：
// 生图/生视频把带令牌的公网媒体 URL 提交给上游（Agnes 等），上游回源下载参考图/首尾帧才不会被 401 拦住
app.use('/static/*', async (c, next) => {
  if (!(await hasAccessPassword())) return next()
  const token = getCookie(c, ACCESS_COOKIE) || c.req.header('x-access-token')
  const queryToken = new URL(c.req.url).searchParams.get('token') || undefined
  if (await isTokenValid(token)) return next()
  if (await isTokenValid(queryToken)) return next()
  if (await isMediaTokenValid(queryToken)) return next()
  return c.json({ code: 401, message: 'UNAUTHORIZED' }, 401)
})

// API routes
const api = new Hono()
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/style-packs', stylePacks)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/storage', storage)
api.route('/settings', settings)
api.route('/access', access)
api.route('/capabilities', capabilities)
api.route('/server-update', serverUpdate)

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，命中文件时在返回的 Response 上直接加
// immutable 长缓存。不能事后读 c.res 判断：404 时 serveStatic 不落响应，
// 中途读 c.res 会触发 hono 懒响应合并异常，把本应 404 的请求变成 500。
// serverless 形态：媒体在 Vercel Blob，按规范相对路径 302 到 Blob URL（DB 存的 static/... 引用不变）
app.use('/static/*', async (c) => {
  if (IS_SERVERLESS) {
    const raw = new URL(c.req.url).pathname.slice('/static/'.length)
    const relativePath = `static/${decodeURIComponent(raw)}`
    try {
      return c.redirect(await blobUrlFor(relativePath), 302)
    } catch {
      return c.notFound()
    }
  }
  const res = await serveStatic({ root: DATA_ROOT })(c, async () => {})
  if (res && res.status === 200) res.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  // 未命中必须显式返回已定型的 404：若放任返回 undefined，外层 cors 等中间件读 c.res
  // 会先触发懒响应，hono 兜底 404 再经 setter 合并路径时会抛 RangeError（500）
  return res ?? c.notFound()
})

// Serve frontend (production build) — 桌面版由主进程注入 FRONTEND_DIST（resources/frontend）
const distPath = process.env.FRONTEND_DIST || path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

/**
 * HTTP 入口 — 双形态共用同一 app：
 * - Node 常驻（dev/桌面/standard 服务器）：tsx/tsc 直跑本文件，serve() 监听端口
 * - Serverless（Vercel）：deploy/vercel/api/[[...route]].ts 经 hono/vercel 挂载本文件导出的 app，
 *   serve() 与启动清理仅在 Node 常驻形态执行
 */

// 初始访问密码（HUOBAO_ACCESS_PASSWORD）：仅在数据库从未设过密码时生效，之后在设置页维护
ensureInitialAccessPassword()
  .then(seeded => { if (seeded) console.log('🔐 已从环境变量初始化访问密码') })
  .catch(err => console.error('初始访问密码设置失败:', err?.message))

export default app

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 5679)
  console.log(`🚀 Huobao Drama TS server on http://localhost:${port}`)

  // 进程重启后内存中的轮询线程全部丢失。交给 generation 恢复：
  // 无上游 taskId（提交期中断）→ 标 failed；有 taskId → 恢复 processing 并续跑轮询，
  // 上游已完成的直接补下载回写，不重新提交、不重复计费。
  // （serverless 无"重启"语义，任务续跑由 /tasks/sweep cron 驱动）
  recoverInterruptedTasks()
    .then(({ failed, resumed }) => {
      if (failed > 0) console.log(`🔁 启动恢复: ${failed} 个提交期中断的任务已标失败`)
      if (resumed > 0) console.log(`🔁 启动恢复: ${resumed} 个带上游任务 ID 的任务已续跑轮询`)
    })
    .catch(err => console.error('启动恢复失败:', err?.message))

  serve({ fetch: app.fetch, port })
}
