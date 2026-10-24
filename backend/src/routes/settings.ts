/**
 * 应用设置路由 — 全局配置的读写入口
 * - AI 内容语言
 * - 引导漫游已读状态
 * - 公网媒体地址（内网穿透 / 反代的公网出口，供 URL-only 协议回源本地文件）
 */
import { Hono } from 'hono'
import {
  getContentLanguage, setContentLanguage, getToursSeen, setToursSeen,
  getPublicMediaBaseUrl, setPublicMediaBaseUrl, isValidPublicBaseUrl,
  CONTENT_LANGUAGES, type ContentLanguage,
} from '../services/app-settings.js'
import { success, badRequest } from '../utils/response.js'

const app = new Hono()

// GET /content-language — 当前 AI 内容语言
app.get('/content-language', async (c) => {
  return success(c, { language: await getContentLanguage() })
})

// PUT /content-language — 设置 AI 内容语言（body: { language: 'zh'|'en'|'ja'|'ko' }）
app.put('/content-language', async (c) => {
  const body = await c.req.json().catch(() => null)
  const language = body?.language
  if (!(CONTENT_LANGUAGES as readonly string[]).includes(language)) {
    return badRequest(c, `language 必须是 ${CONTENT_LANGUAGES.join(' / ')} 之一`)
  }
  const saved = await setContentLanguage(language as ContentLanguage)
  return success(c, { language: saved })
})

// GET /tours-seen — 已看过的引导漫游 id 列表
app.get('/tours-seen', async (c) => {
  return success(c, { seen: await getToursSeen() })
})

// PUT /tours-seen — 写入已看过的引导漫游 id 列表（body: { seen: string[] }）
app.put('/tours-seen', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!Array.isArray(body?.seen) || !body.seen.every((v: unknown) => typeof v === 'string')) {
    return badRequest(c, 'seen 必须是字符串数组')
  }
  return success(c, { seen: await setToursSeen(body.seen) })
})

// GET /public-media-base-url — 当前公网媒体地址（未配置为 null）
app.get('/public-media-base-url', async (c) => {
  const url = await getPublicMediaBaseUrl()
  return success(c, {
    url,
    // 服务器版仍支持用环境变量配置，前端据此区分「已配置 / 来自环境变量」
    fromEnv: !url && !!String(process.env.PUBLIC_BASE_URL || '').trim(),
  })
})

// PUT /public-media-base-url — 设置公网媒体地址（body: { url: string }，空串清空）
app.put('/public-media-base-url', async (c) => {
  const body = await c.req.json().catch(() => null)
  const raw = typeof body?.url === 'string' ? body.url.trim() : ''
  if (raw && !isValidPublicBaseUrl(raw)) {
    return badRequest(c, '公网媒体地址必须是 http:// 或 https:// 开头的完整地址，例如 https://media.example.com')
  }
  try {
    return success(c, { url: await setPublicMediaBaseUrl(raw) })
  } catch (err) {
    return badRequest(c, (err as Error).message)
  }
})

export default app
