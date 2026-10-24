/**
 * workspace 覆盖层 — serverless 形态的 skills/prompts 在线编辑存储
 *
 * 本地形态（dev/桌面/standard）直写 workspace 文件，不走本模块；
 * serverless（Vercel）文件系统只读，编辑内容落 workspace_overrides 表，
 * 读侧（loadAgentSkills / loadAgentPromptFile / 对应路由）覆盖层优先于文件。
 *
 * key 规范：skill/<path>:<lang> | prompt/<agentType>:<lang>（lang ∈ zh/en/ja/ko）
 */
import { eq, like } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export const skillOverrideKey = (skillPath: string, lang: string) => `skill/${skillPath}:${lang}`
export const promptOverrideKey = (agentType: string, lang: string) => `prompt/${agentType}:${lang}`

export async function getOverride(key: string): Promise<string | null> {
  const [row] = await db.select().from(schema.workspaceOverrides).where(eq(schema.workspaceOverrides.key, key))
  return row?.content ?? null
}

export async function setOverride(key: string, content: string): Promise<void> {
  await db.insert(schema.workspaceOverrides)
    .values({ key, content, updatedAt: now() })
    .onConflictDoUpdate({
      target: schema.workspaceOverrides.key,
      set: { content, updatedAt: now() },
    })
}

export async function deleteOverride(key: string): Promise<void> {
  await db.delete(schema.workspaceOverrides).where(eq(schema.workspaceOverrides.key, key))
}

/** 按 key 前缀批量读取（如 'skill/'），返回 key → content 映射；loadAgentSkills 注入用 */
export async function listOverridesByPrefix(prefix: string): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.workspaceOverrides)
    .where(like(schema.workspaceOverrides.key, `${prefix}%`))
  return new Map(rows.map(r => [r.key, r.content]))
}
