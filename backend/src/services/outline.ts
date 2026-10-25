/**
 * 分集大纲服务 — 大纲落为 workspace 本地 md（outlines/drama-<id>.md），作为全局提示词注入全部 agent
 * 写入时机：AI 分集 apply 后自动重建；剧集增删后可手动 sync 重建（从 episodes 表的 summary/hook 汇编）
 * 注入时机：buildInstructions 按请求追加，并标注"当前处理第 X 集"，agent 据此承接前集钩子、落本集钩子
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { skillsManagerWorkspace } from '../agents/skills.js'

const OUTLINE_DIR = 'outlines'

function outlinePath(dramaId: number): string {
  return `${OUTLINE_DIR}/drama-${dramaId}.md`
}

function buildMarkdown(dramaTitle: string, episodes: Array<{ episodeNumber: number; title: string; summary: string | null; hook: string | null }>): string {
  const lines: string[] = [
    `# 《${dramaTitle}》分集大纲（共 ${episodes.length} 集）`,
    '',
    '> 给 Agent 的使用说明：本大纲是全集蓝图，与你的产出绑定。',
    '- 改写第 X 集时：开头自然承接第 X-1 集「结尾钩子」（第 1 集或前集无钩子则直接入戏）；结尾把剧情落在第 X 集「结尾钩子」上并强化，不得提前展开后集内容。',
    '- 资产提取与分镜拆解同样参考全局节奏与各集钩子，保证跨集一致。',
    '- 大纲与剧集实际内容冲突时，以剧集实际内容为准。',
    '',
  ]
  for (const ep of episodes) {
    lines.push(`## 第 ${ep.episodeNumber} 集 · ${ep.title}`)
    if (ep.summary) lines.push(`- 概要：${ep.summary}`)
    if (ep.hook) lines.push(`- 结尾钩子：${ep.hook}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 从 episodes 表汇编并写入大纲 md；无剧集时删除文件。返回是否写入 */
export async function syncOutlineFile(dramaId: number): Promise<boolean> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return false
  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .orderBy(schema.episodes.episodeNumber)
  const fsm = skillsManagerWorkspace.filesystem!
  if (!eps.length) {
    if (await fsm.exists(outlinePath(dramaId))) await fsm.deleteFile(outlinePath(dramaId))
    return false
  }
  const md = buildMarkdown(drama.title, eps.map(e => ({
    episodeNumber: e.episodeNumber,
    title: e.title,
    summary: e.summary ?? null,
    hook: e.hook ?? null,
  })))
  await fsm.writeFile(outlinePath(dramaId), md, { recursive: true })
  return true
}

/** 读取注入用的大纲文本块；无大纲返回 ''（含"当前处理第 X 集"指令行） */
export async function getOutlineBlock(dramaId: number | null | undefined, episodeId: number | null | undefined): Promise<string> {
  if (!dramaId) return ''
  const fsm = skillsManagerWorkspace.filesystem!
  const p = outlinePath(dramaId)
  try {
    if (!await fsm.exists(p)) return ''
    const md = String(await fsm.readFile(p, { encoding: 'utf-8' })).trim()
    if (!md) return ''
    let directive = ''
    if (episodeId) {
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
      if (ep) directive = `\n\n【当前任务】你正在处理第 ${ep.episodeNumber} 集《${ep.title}》，请按上述说明落实该集的钩子承接。`
    }
    return `以下是本项目的分集大纲（全局蓝图）：\n\n${md}${directive}`
  } catch {
    return ''
  }
}
