/**
 * 服务器 / Docker 部署的版本检查与更新路由（桌面版更新走 Electron 桥，不经此路由）
 * serverless 形态为不可变部署，自更新不可用（前端按 capabilities 隐藏，此为后端兜底）
 */
import { Hono } from 'hono'
import { getServerUpdateState, checkServerUpdate, triggerWatchtowerUpdate } from '../services/server-update.js'
import { success, badRequest } from '../utils/response.js'
import { IS_SERVERLESS } from '../utils/runtime-mode.js'

const app = new Hono()

// GET /state — 当前版本 + 更新模式 + 上次检查结果
app.get('/state', (c) => success(c, getServerUpdateState()))

// POST /check — 拉取发布清单比较版本
app.post('/check', async (c) => success(c, await checkServerUpdate()))

// POST /apply — 触发 Watchtower 拉新镜像并重建本容器（仅 watchtower 模式可用）
app.post('/apply', async (c) => {
  if (IS_SERVERLESS) {
    return c.json({ code: 501, message: 'Serverless 部署为不可变部署，请通过 Vercel 重新部署完成更新' }, 501)
  }
  try {
    await triggerWatchtowerUpdate()
    return success(c, { triggered: true })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

export default app
