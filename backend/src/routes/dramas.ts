import { Hono } from 'hono'
import { and, eq, isNull, like, desc } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { splitNovelIntoEpisodes, startEpisodeSplitTask } from '../services/episode-split.js'
import { syncOutlineFile } from '../services/outline.js'

const app = new Hono()

// GET /dramas - List dramas
app.get('/', async (c) => {
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')

  const allRows = await db.select().from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt))
    .orderBy(desc(schema.dramas.updatedAt))
  let filtered = allRows

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, drama.id), isNull(schema.episodes.deletedAt)))
    const chars = await db.select().from(schema.characters)
      .where(and(eq(schema.characters.dramaId, drama.id), isNull(schema.characters.deletedAt)))
    const scns = await db.select().from(schema.scenes)
      .where(and(eq(schema.scenes.dramaId, drama.id), isNull(schema.scenes.deletedAt)))
    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: eps.length,
      episodes: toSnakeCaseArray(eps),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  const res = await db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    stylePack: body.style_pack ?? null,
    aspectRatio: body.aspect_ratio || '16:9',
    resolution: ['480p', '720p', '1080p'].includes(body.resolution) ? body.resolution : '720p',
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  })

  const [result] = await db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, getInsertId(res)))

  // 不再预建集 — 用户通过「添加集」流程创建（该流程会锁定图片/视频生成配置）
  return created(c, toSnakeCase(result))
})


// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const all = await db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')

  const eps = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
  // 资产为软删除：详情必须过滤 deleted_at，否则素材库删除后仍显示
  const chars = await db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, id), isNull(schema.characters.deletedAt)))
  const scns = await db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, id), isNull(schema.scenes.deletedAt)))
  const prps = await db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, id), isNull(schema.props.deletedAt)))

  // 每个素材被哪些集挂接（episode_ids），供素材库编辑弹窗做跨集引用管理
  const [epChars, epScenes, epProps] = await Promise.all([
    db.select().from(schema.episodeCharacters),
    db.select().from(schema.episodeScenes),
    db.select().from(schema.episodeProps),
  ])
  const epIdsOf = (links: { episodeId: number; [k: string]: unknown }[], key: string, assetId: number) =>
    links.filter(l => l[key] === assetId).map(l => l.episodeId)

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars).map((ch: any) => ({ ...ch, episode_ids: epIdsOf(epChars, 'characterId', ch.id) })),
    scenes: toSnakeCaseArray(scns).map((sc: any) => ({ ...sc, episode_ids: epIdsOf(epScenes, 'sceneId', sc.id) })),
    props: toSnakeCaseArray(prps).map((pr: any) => ({ ...pr, episode_ids: epIdsOf(epProps, 'propId', pr.id) })),
  })
})

// GET /dramas/:id/generation-tasks — 项目维度聚合 sys_task + video_merges（任务抽屉）
app.get('/:id/generation-tasks', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return notFound(c, '项目不存在')

  const tasks = (await db.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, dramaId)))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 200)

  const eps = await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId))
  const epIds = new Set(eps.map(e => e.id))
  const merges = (await db.select().from(schema.videoMerges).where(isNull(schema.videoMerges.deletedAt)))
    .filter(m => m.episodeId != null && epIds.has(m.episodeId))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 50)

  return success(c, {
    tasks: toSnakeCaseArray(tasks),
    merges: toSnakeCaseArray(merges),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.style_pack !== undefined) updates.stylePack = body.style_pack || null
  if (body.source_content !== undefined) updates.sourceContent = body.source_content || null
  if (body.model_chat !== undefined) updates.modelChat = body.model_chat || null
  if (body.model_image !== undefined) updates.modelImage = body.model_image || null
  if (body.model_video !== undefined) updates.modelVideo = body.model_video || null
  if (body.language !== undefined) updates.language = body.language || null
  if (body.resolution !== undefined) {
    if (!['480p', '720p', '1080p'].includes(body.resolution)) return badRequest(c, 'resolution 只支持 480p / 720p / 1080p')
    updates.resolution = body.resolution
  }
  if (body.aspect_ratio !== undefined) updates.aspectRatio = body.aspect_ratio
  if (body.status !== undefined) updates.status = body.status
  if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail || null
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  await db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id))
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

// POST /dramas/:id/split-episodes/preview — AI 分集预览：切分大纲 + 各集原文段落（只返回不落库）
app.post('/:id/split-episodes/preview', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const source = String(body.source_content ?? '').trim()
  if (!source) return badRequest(c, '原文内容必填')
  const episodeCount = Number(body.episode_count) || 0
  if (!episodeCount) return badRequest(c, 'episode_count 必填')
  try {
    const episodes = await splitNovelIntoEpisodes(source, {
      episodeCount,
      textConfigId: Number(body.text_config_id) || undefined,
      dramaId: id,
    })
    return success(c, { episodes })
  } catch (err) {
    return badRequest(c, (err as Error).message || '分集失败')
  }
})

// POST /dramas/:id/split-episodes/run — AI 分集异步任务：立即返回任务 id，结果写入 sys_task.result（任务中心查看/确认建集）
app.post('/:id/split-episodes/run', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const source = String(body.source_content ?? '').trim()
  if (!source) return badRequest(c, '原文内容必填')
  const episodeCount = Number(body.episode_count) || 0
  if (!episodeCount) return badRequest(c, 'episode_count 必填')
  try {
    const taskId = await startEpisodeSplitTask(id, {
      source,
      episodeCount,
      textConfigId: Number(body.text_config_id) || undefined,
    })
    return created(c, { task_id: taskId })
  } catch (err) {
    return badRequest(c, (err as Error).message || '分集任务提交失败')
  }
})

// POST /dramas/:id/split-episodes/apply — 按预览结果批量建集（content = 各集原始内容，编号顺延追加）
app.post('/:id/split-episodes/apply', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const body = await c.req.json()
  const items: Array<{ title?: string; content?: string; summary?: string; hook?: string }> = Array.isArray(body.episodes) ? body.episodes : []
  if (!items.length) return badRequest(c, 'episodes 必填')
  if (items.some(ep => !String(ep.content ?? '').trim())) return badRequest(c, '存在原始内容为空的集')

  const [drama] = await db.select().from(schema.dramas)
    .where(and(eq(schema.dramas.id, dramaId), isNull(schema.dramas.deletedAt)))
  if (!drama) return notFound(c, '剧本不存在')

  // 生成配置只在项目级维护（dramas.model_*），分集建集不再锁定每集配置
  const existing = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .orderBy(schema.episodes.episodeNumber)
  let nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1
  const ts = now()

  const createdIds: number[] = []
  for (const ep of items) {
    const res = await db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: nextNum,
      title: String(ep.title ?? '').trim() || `第${nextNum}集`,
      content: String(ep.content ?? '').trim(),
      summary: String(ep.summary ?? '').trim() || null,
      hook: String(ep.hook ?? '').trim() || null,
      createdAt: ts,
      updatedAt: ts,
    })
    createdIds.push(getInsertId(res))
    nextNum++
  }
  await db.update(schema.dramas).set({ updatedAt: now() }).where(eq(schema.dramas.id, dramaId))
  // 分集落库后重建大纲 md（全局提示词，注入全部 agent）
  try { await syncOutlineFile(dramaId) } catch (err) { console.error('[outline] 重建大纲失败:', (err as Error).message) }
  return created(c, { ids: createdIds, count: createdIds.length, start_number: nextNum - items.length })
})

// POST /dramas/:id/outline/sync — 从 episodes 表重建大纲 md（手动建集/编辑钩子后调用）
app.post('/:id/outline/sync', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const [drama] = await db.select().from(schema.dramas)
    .where(and(eq(schema.dramas.id, dramaId), isNull(schema.dramas.deletedAt)))
  if (!drama) return notFound(c, '剧本不存在')
  const written = await syncOutlineFile(dramaId)
  return success(c, { written })
})

export default app
