/**
 * 叙事风格包服务 — 将项目绑定的风格包解析为注入 agent instructions 的文本块
 * dramas.style_pack 存 style_packs.value；查不到/已停用时返回空串（不注入）
 * 风格包按 agent 分段存储（episode_split/script/extractor/storyboard/prompt 五段），每个 agent 只收自己职责的段落
 */
import { db, schema } from '../db/index.js'
import { and, eq } from 'drizzle-orm'

export interface DramaStylePack {
  name: string
  value: string
  episodeSplitGuide: string
  scriptGuide: string
  extractorGuide: string
  storyboardGuide: string
  promptGuide: string
}

/** 查询项目绑定的叙事风格包；未绑定/查不到返回 null */
export async function getDramaStylePack(dramaId: number | null | undefined): Promise<DramaStylePack | null> {
  if (!dramaId) return null
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.stylePack) return null
  const [pack] = await db.select().from(schema.stylePacks)
    .where(and(eq(schema.stylePacks.value, drama.stylePack), eq(schema.stylePacks.isActive, true)))
  if (!pack) return null
  return {
    name: pack.name,
    value: pack.value,
    episodeSplitGuide: pack.episodeSplitGuide || '',
    scriptGuide: pack.scriptGuide || '',
    extractorGuide: pack.extractorGuide || '',
    storyboardGuide: pack.storyboardGuide || '',
    promptGuide: pack.promptGuide || '',
  }
}

/** agent type → 风格包分段字段 */
const AGENT_GUIDE_COLUMN: Record<string, keyof Omit<DramaStylePack, 'name' | 'value'>> = {
  episode_splitter: 'episodeSplitGuide',
  script_rewriter: 'scriptGuide',
  extractor: 'extractorGuide',
  storyboard_breaker: 'storyboardGuide',
  prompt_generator: 'promptGuide',
}

/** 拼装注入 instructions 的风格包文本块：项目绑定了风格包且该 agent 有对应分段才注入；否则 '' */
export async function getDramaStylePackBlock(dramaId: number | null | undefined, agentType?: string): Promise<string> {
  const pack = await getDramaStylePack(dramaId)
  if (!pack || !agentType) return ''
  const column = AGENT_GUIDE_COLUMN[agentType]
  if (!column) return ''
  const guide = pack[column]
  if (!guide) return ''
  return [
    `本项目绑定了叙事风格包「${pack.name}」，以下指导适用于你的产出：`,
    guide,
  ].join('\n')
}
