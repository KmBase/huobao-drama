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
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import settings from './routes/settings.js'
import capabilities from './routes/capabilities.js'
import storage from './routes/storage.js'
import serverUpdate from './routes/serverUpdate.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { db, schema, affectedRows } from './db/index.js'
import { eq } from 'drizzle-orm'
import { now } from './utils/response.js'
import { DATA_ROOT } from './utils/paths.js'
import { IS_SERVERLESS } from './utils/runtime-mode.js'
import { blobUrlFor } from './utils/storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// Middleware
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check（version 供部署巡检/更新检查核对当前运行版本）
app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  version: process.env.HUOBAO_VERSION || undefined,
  timestamp: new Date().toISOString(),
}))

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
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/storage', storage)
api.route('/settings', settings)
api.route('/capabilities', capabilities)
api.route('/server-update', serverUpdate)

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存
app.use('/static/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
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
  return serveStatic({ root: DATA_ROOT })(c, async () => {})
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
export default app

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 5679)
  console.log(`🚀 Huobao Drama TS server on http://localhost:${port}`)

  // 进程重启后内存中的轮询线程全部丢失,残留的 processing 任务永远不会完成,
  // 启动时统一标记为 failed,避免前端一直显示"生成中"
  // （serverless 无"重启"语义，任务续跑由 /tasks/sweep cron 驱动）
  db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: '服务重启，生成任务中断，请重试', updatedAt: now() })
    .where(eq(schema.sysTask.status, 'processing'))
    .then(res => {
      const affected = affectedRows(res)
      if (affected > 0) console.log(`🔁 已清理 ${affected} 个中断的生成任务`)
    })
    .catch(err => console.error('清理中断任务失败:', err?.message))

  serve({ fetch: app.fetch, port })
}
