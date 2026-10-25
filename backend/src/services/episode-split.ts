/**
 * AI 分集服务 — 走注册的 episode_splitter（原著分集）Agent：
 * 模型通读原著，按剧本写作原则改编出各集正文（episodes.content，改编后的剧本体而非原文摘抄），
 * 同时产出每集标题/概要/结尾钩子（写入大纲与剧集）。
 * 长文按段落切块逐段送模型（每段带前情上下文），保证跨集衔接；不做本地机械切分。
 * instructions 拼装与其它 agent 同源（prompt 文件 + 技能 + 风格包），可在线编辑。
 * 与风格包生成同口径：preview 只返回不落库，前端预览确认后走 apply
 */
import { Agent } from '@mastra/core/agent'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { getModel, buildAgentInstructions } from '../agents/index.js'
import { loadBasePromptFile } from '../agents/prompts.js'

export interface EpisodeOutline {
  title: string
  summary: string
  hook: string
  content: string
}

/** 一次调用最多喂给模型的原文长度，超过则按段落切块逐段改编 */
const CHUNK_SIZE = 12000

function extractJson(raw: string): any {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON，请重试或换用更强的文本模型')
  return JSON.parse(text.slice(start, end + 1))
}

function normalizeOutline(raw: any): EpisodeOutline[] {
  const list = Array.isArray(raw?.episodes) ? raw.episodes : []
  const out: EpisodeOutline[] = []
  for (const item of list) {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const title = str(item?.title)
    const content = str(item?.content)
    if (!title || !content) continue
    out.push({ title, summary: str(item?.summary), hook: str(item?.hook), content })
  }
  if (!out.length) throw new Error('切分结果为空，请调整集数后重试')
  return out
}

async function runAgent(model: any, instructions: string, input: string): Promise<EpisodeOutline[]> {
  const agent = new Agent({ id: 'episode-splitter-run', name: 'episode-splitter-run', instructions, model })
  const result = await agent.generate([{ role: 'user', content: input }] as any)
  return normalizeOutline(extractJson(result.text))
}

/** 按段落边界把长文切成 CHUNK_SIZE 左右的块 */
function chunkText(text: string): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > CHUNK_SIZE) {
    let cut = rest.lastIndexOf('\n', CHUNK_SIZE)
    if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) chunks.push(rest)
  return chunks
}

/** 按各块长度比例分配集数，总和严格等于 episodeCount，每块至少 1 集 */
function allocateCounts(chunkLens: number[], episodeCount: number): number[] {
  const total = chunkLens.reduce((a, b) => a + b, 0)
  const raw = chunkLens.map(l => (l / total) * episodeCount)
  const counts = raw.map(r => Math.max(1, Math.floor(r)))
  let sum = counts.reduce((a, b) => a + b, 0)
  while (sum < episodeCount) {
    let best = 0
    for (let i = 1; i < counts.length; i++) if (raw[i]! - counts[i]! > raw[best]! - counts[best]!) best = i
    counts[best]!++
    sum++
  }
  while (sum > episodeCount) {
    let best = -1
    for (let i = 0; i < counts.length; i++) {
      if (counts[i]! > 1 && (best < 0 || raw[i]! - counts[i]! < raw[best]! - counts[best]!)) best = i
    }
    if (best < 0) break
    counts[best]!--
    sum--
  }
  return counts
}

/** 分集入口：短文一次改编，长文逐段改编；走 episode_splitter agent 的 instructions/模型解析 */
export async function splitNovelIntoEpisodes(
  source: string,
  opts: { episodeCount: number; textConfigId?: number; dramaId?: number; onProgress?: (detail: string) => void },
): Promise<Array<{ title: string; summary: string; hook: string; content: string }>> {
  const text = source.trim()
  if (!text) throw new Error('原文为空')
  if (opts.episodeCount < 1 || opts.episodeCount > 100) throw new Error('集数需在 1-100 之间')

  // 模型：prompt 文件 frontmatter 覆盖 → 请求指定文本配置 → 启用配置
  const promptFile = await loadBasePromptFile('episode_splitter')
  const model = await getModel(promptFile?.model || undefined, undefined, opts.textConfigId)
  const instructions = await buildAgentInstructions('episode_splitter', { dramaId: opts.dramaId })

  if (text.length <= CHUNK_SIZE) {
    opts.onProgress?.(`改编切分 ${opts.episodeCount} 集`)
    const input = `本次需要改编切分为 ${opts.episodeCount} 集。\n\n【小说原文】\n${text}`
    return runAgent(model, instructions, input)
  }

  // 长文：按段落切块，逐段送模型改编，块间带前情上下文保证衔接
  const chunks = chunkText(text)
  const counts = allocateCounts(chunks.map(c => c.length), opts.episodeCount)
  const episodes: EpisodeOutline[] = []
  for (let i = 0; i < chunks.length; i++) {
    const k = counts[i]!
    opts.onProgress?.(`改编第 ${i + 1}/${chunks.length} 段（本段 ${k} 集）`)
    const prev = episodes[episodes.length - 1]
    const prevNote = prev
      ? `前情衔接：前一集《${prev.title}》概要「${prev.summary || '无'}」，结尾钩子「${prev.hook || '无'}」。本段第一集要自然承接这个钩子。`
      : '这是全剧的第一段，第一集直接入戏。'
    const input = `本次是长文分段的第 ${i + 1}/${chunks.length} 段，本段需要改编切分为 ${k} 集。\n${prevNote}\n\n【小说原文 · 第 ${i + 1}/${chunks.length} 段】\n${chunks[i]}`
    const part = await runAgent(model, instructions, input)
    // 集数对不上时以模型产出为准，最终由前端预览确认
    episodes.push(...part)
  }
  return episodes
}

/**
 * 异步分集任务：落 sys_task（type=episode_split）后立即返回，后台执行，
 * 结果 JSON {episodes:[...]} 写入 result 列，供任务中心查看/确认建集。
 * 请求方应先校验原文与集数；此处兜底再校验一次。
 */
export async function startEpisodeSplitTask(
  dramaId: number | undefined,
  opts: { source: string; episodeCount: number; textConfigId?: number },
): Promise<number> {
  const source = opts.source.trim()
  if (!source) throw new Error('原文为空')
  if (opts.episodeCount < 1 || opts.episodeCount > 100) throw new Error('集数需在 1-100 之间')
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type: 'episode_split',
    dramaId: dramaId ?? null,
    prompt: `原著分集 · ${opts.episodeCount} 集 · ${source.length} 字`,
    params: JSON.stringify({ source, episodeCount: opts.episodeCount, textConfigId: opts.textConfigId }),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })
  const id = getInsertId(res)
  void runEpisodeSplitTask(id).catch(() => {})
  return id
}

/** 执行分集任务并回写终态；完成/失败回写都带 processing 守卫，用户取消后不覆盖 */
export async function runEpisodeSplitTask(id: number): Promise<void> {
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!task || task.status !== 'processing') return
  const writeProgress = async (detail: string) => {
    try {
      await db.update(schema.sysTask)
        .set({ progress: JSON.stringify({ stage: detail, lastPollAt: now() }), updatedAt: now() })
        .where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
    } catch { /* 进度写入失败不中断任务 */ }
  }
  try {
    const p = JSON.parse(task.params || '{}')
    const episodes = await splitNovelIntoEpisodes(String(p.source || ''), {
      episodeCount: Number(p.episodeCount) || 1,
      textConfigId: Number(p.textConfigId) || undefined,
      dramaId: task.dramaId ?? undefined,
      onProgress: writeProgress,
    })
    await db.update(schema.sysTask).set({
      status: 'completed',
      result: JSON.stringify({ episodes }),
      completedAt: now(),
      updatedAt: now(),
    }).where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
  } catch (err: any) {
    await db.update(schema.sysTask).set({
      status: 'failed',
      errorMsg: err?.message || '分集失败',
      completedAt: now(),
      updatedAt: now(),
    }).where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
  }
}
