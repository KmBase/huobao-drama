/**
 * 应用级全局设置（app_settings key-value 表）
 * - AI 内容语言：所有 Agent 产出（剧本/提取/分镜/提示词）统一使用的目标语言
 * - 引导漫游、公网媒体地址（内网穿透 / 反代出口）
 * 层次约束：本模块只依赖 db，严禁反向 import agents/*（agents/context.ts 会引用本模块）
 *
 * 注意：API 一律 async——libSQL 驱动下无同步会话方法，better-sqlite3 驱动的
 * 查询构建器同样是 thenable，await 两种 driver 通吃
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export const CONTENT_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type ContentLanguage = typeof CONTENT_LANGUAGES[number]

const CONTENT_LANGUAGE_KEY = 'content_language'

function isContentLanguage(v: unknown): v is ContentLanguage {
  return typeof v === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(v)
}

/** 读取全局内容语言；未设置或值非法时回退 'zh'（保持历史默认行为） */
export async function getContentLanguage(): Promise<ContentLanguage> {
  const [row] = await db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, CONTENT_LANGUAGE_KEY))
  return isContentLanguage(row?.value) ? row.value : 'zh'
}

/** 写入全局内容语言（upsert） */
export async function setContentLanguage(lang: ContentLanguage): Promise<ContentLanguage> {
  if (!isContentLanguage(lang)) throw new Error(`Invalid content language: ${lang}`)
  await db.insert(schema.appSettings)
    .values({ key: CONTENT_LANGUAGE_KEY, value: lang, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: lang, updatedAt: now() },
    })
  return lang
}

// ---- 公网媒体地址（内网穿透 / 反代，供 URL-only 协议的上游回源本地静态文件） ----

const PUBLIC_MEDIA_BASE_URL_KEY = 'public_media_base_url'

/** 公网媒体地址校验：必须是可解析的 http(s) 绝对地址；空串表示清空 */
export function isValidPublicBaseUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s) return false
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname
  } catch {
    return false
  }
}

/** 规范化：去首尾空格与结尾斜杠（拼 `${base}/${path}` 时不会出双斜杠） */
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/**
 * 读取公网媒体地址；未设置或值非法时返回 null。
 * 协议只接受公网 URL 时（Agnes），本地 static 文件靠它拼出上游可访问的地址。
 */
export async function getPublicMediaBaseUrl(): Promise<string | null> {
  const [row] = await db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, PUBLIC_MEDIA_BASE_URL_KEY))
  return isValidPublicBaseUrl(row?.value) ? normalizeBaseUrl(row!.value!) : null
}

/** 写入公网媒体地址（upsert）；传空串/非法值则删除该配置并返回 null */
export async function setPublicMediaBaseUrl(url: unknown): Promise<string | null> {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, PUBLIC_MEDIA_BASE_URL_KEY))
    return null
  }
  if (!isValidPublicBaseUrl(raw)) throw new Error(`Invalid public media base url: ${raw}`)
  const value = normalizeBaseUrl(raw)
  await db.insert(schema.appSettings)
    .values({ key: PUBLIC_MEDIA_BASE_URL_KEY, value, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: now() },
    })
  return value
}

const TOURS_SEEN_KEY = 'tours_seen'
const MAX_TOURS_SEEN = 64

function sanitizeTourIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter(v => typeof v === 'string' && v.length > 0 && v.length <= 100))].slice(0, MAX_TOURS_SEEN)
}

/** 已看过的引导漫游 id 列表（JSON 数组存储）；桌面端端口随启动变化，localStorage 不可靠，故落库 */
export async function getToursSeen(): Promise<string[]> {
  const [row] = await db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, TOURS_SEEN_KEY))
  try { return sanitizeTourIds(JSON.parse(row?.value || '[]')) } catch { return [] }
}

/** 写入已看过的引导漫游 id 列表（upsert） */
export async function setToursSeen(ids: unknown): Promise<string[]> {
  const clean = sanitizeTourIds(ids)
  const value = JSON.stringify(clean)
  await db.insert(schema.appSettings)
    .values({ key: TOURS_SEEN_KEY, value, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: now() },
    })
  return clean
}
