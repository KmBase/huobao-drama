/**
 * Vercel serverless 入口 — 把共享 Hono app 挂到 Vercel Node 函数
 *
 * 位置约定：必须放在 backend/ 内（如 backend/api/），使最近 package.json = backend/package.json，
 * @vercel/node 才能正确安装/解析 hono 等依赖（monorepo 依赖锚点，见 deploy/vercel/README.md）。
 *
 * 路由：/api/* 与 /static/* 经 vercel.json routes 进入本函数；
 * /static 在 serverless 形态 302 重定向到 Vercel Blob（见 src/index.ts）。
 */
import { handle } from 'hono/vercel'
import app from '../src/index.js'

export const config = {
  runtime: 'nodejs',
}

// Fluid compute 单次执行上限（Pro 800s 上限内取 300s；图片任务通常在此内完成，
// 超时任务由 /api/v1/tasks/sweep cron 兜底续跑）
export const maxDuration = 300

export default handle(app)
