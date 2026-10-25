import { Hono } from 'hono'
import { and, desc, eq, inArray, like, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage, generateVideo, sweepProcessingTasks, cancelTask, retryTask, refreshTask } from '../services/generation.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

type TaskType = 'image' | 'video'

const WAN_MEDIA_TYPES = new Set([
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
  'file',
  'link',
])

/**
 * 兼容项目原有扁平入参，也支持 Wan 3.0 官方 model/input/parameters 结构。
 */
function normalizeVideoRequest(body: any) {
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : {}
  const media = Array.isArray(input.media) ? input.media : []

  const mediaUrls = (type: string) => media
    .filter((item: any) => item?.type === type)
    .map((item: any) => item?.url)

  return {
    ...body,
    prompt: body.prompt ?? input.prompt ?? '',
    reference_image_urls: body.reference_image_urls ?? mediaUrls('reference_image'),
    reference_video_urls: body.reference_video_urls ?? mediaUrls('reference_video'),
    reference_audio_urls: body.reference_audio_urls ?? mediaUrls('reference_audio'),
    first_frame_url: body.first_frame_url ?? mediaUrls('first_frame')[0],
    last_frame_url: body.last_frame_url ?? mediaUrls('last_frame')[0],
    file_url: body.file_url ?? mediaUrls('file')[0],
    link_url: body.link_url ?? mediaUrls('link')[0],
    generate_audio: body.generate_audio ?? parameters.audio,
    duration: body.duration ?? parameters.duration,
    aspect_ratio: body.aspect_ratio ?? parameters.ratio,
    resolution: body.resolution ?? parameters.resolution,
    seed: body.seed ?? parameters.seed,
    prompt_extend: body.prompt_extend ?? parameters.prompt_extend,
    watermark: body.watermark ?? parameters.watermark,
    official_media: media,
  }
}

function validateVideoRequest(body: any, provider?: string): string | null {
  for (const key of ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls']) {
    if (body[key] !== undefined && !Array.isArray(body[key])) return `${key} 必须为数组`
    if (Array.isArray(body[key]) && body[key].some((url: any) => typeof url !== 'string' || !url.trim())) {
      return `${key} 中的每个 URL 都必须为非空字符串`
    }
  }

  if (body.official_media.length) {
    for (const item of body.official_media) {
      if (!item || typeof item !== 'object' || !WAN_MEDIA_TYPES.has(item.type) || typeof item.url !== 'string' || !item.url.trim()) {
        return 'input.media 中的每项都必须包含官方支持的 type 和非空 url'
      }
    }
    for (const type of ['first_frame', 'last_frame', 'file', 'link']) {
      if (body.official_media.filter((item: any) => item.type === type).length > 1) {
        return `Wan 3.0 input.media 中 ${type} 最多 1 项`
      }
    }
  }

  const imgs = body.reference_image_urls.length
  const vids = body.reference_video_urls.length
  const auds = body.reference_audio_urls.length
  const first = Boolean(body.first_frame_url)
  const last = Boolean(body.last_frame_url)
  const file = Boolean(body.file_url)
  const link = Boolean(body.link_url)

  if ((provider || '').toLowerCase() === 'aliyun') {
    if (imgs > 10 || vids > 5 || auds > 5) return 'Wan 3.0 参考素材超限：图片≤10、视频≤5、音频≤5'
    if (last && !first) return 'Wan 3.0 尾帧必须与首帧同时传入'
    if (file && link) return 'Wan 3.0 file 与 link 不能同时传入'
    if ((first || last) && (imgs + vids + auds > 0 || file || link)) {
      return 'Wan 3.0 的 first_frame/last_frame 不能与 reference_image/reference_video/reference_audio/file/link 混用'
    }
    const total = imgs + vids + auds + Number(first) + Number(last) + Number(file) + Number(link)
    if (total > 20) return 'Wan 3.0 input.media 最多 20 项'
  } else {
    if (imgs > 9 || vids > 3 || auds > 3) return '参考素材超限：图片≤9、视频≤3、音频≤3'
    if (auds > 0 && imgs + vids === 0) return '参考音频需要至少 1 个参考图片或视频'
  }

  if (!String(body.prompt || '').trim() && imgs + vids + auds === 0 && !first && !last && !file && !link) {
    return '视频生成需要至少一个参考素材或 prompt'
  }
  return null
}

// POST /tasks — 发起生成任务（body.type: image | video）
app.post('/', async (c) => {
  const body = await c.req.json()
  const type = body.type as TaskType
  if (type !== 'image' && type !== 'video') return badRequest(c, 'type 必须为 image 或 video')

  if (type === 'image') {
    if (!body.prompt) return badRequest(c, '提示词必填')
  }

  const videoBody = type === 'video' ? normalizeVideoRequest(body) : null

  try {
    // 请求显式指定 config_id（工作台按项目级配置换算）时优先；未指定回退当前启用的默认配置。
    // 生成配置只在项目级维护（dramas.model_*），剧集不再单独锁定配置。
    let configId: number | undefined = body.config_id
    let videoResolution: string | undefined
    let storyboardDramaId: number | undefined
    if (body.storyboard_id) {
      const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
      if (sb) {
        const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
        if (ep && type === 'video') {
          // 分辨率是项目级配置（dramas.resolution），各集继承
          const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, ep.dramaId))
          if (drama?.resolution) videoResolution = drama.resolution
        }
        storyboardDramaId = ep?.dramaId ?? undefined
      }
    }

    if (type === 'video' && videoBody) {
      const effectiveConfig = configId
        ? (await getConfigById(configId)) ?? await getActiveConfig('video')
        : await getActiveConfig('video')
      const validationError = validateVideoRequest(videoBody, effectiveConfig?.provider)
      if (validationError) return badRequest(c, validationError)
    }

    logTaskStart('TaskAPI', 'generate', {
      type,
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
    })
    logTaskPayload('TaskAPI', 'request body', body)

    // 视频生成时把项目视觉风格词注入提示词最前方（与图片侧的自动注入保持一致口径）
    let videoPrompt = videoBody?.prompt
    if (type === 'video' && String(videoPrompt || '').trim()) {
      const dramaId = body.drama_id ?? storyboardDramaId ?? null
      const stylePrompt = await getDramaStylePrompt(dramaId)
      if (stylePrompt) videoPrompt = `${stylePrompt}，\n${videoPrompt}`
    }

    const id = type === 'image'
      ? await generateImage({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        sceneId: body.scene_id,
        characterId: body.character_id,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        referenceImages: body.reference_images,
        frameType: body.frame_type,
        configId,
      })
      : await generateVideo({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        prompt: videoPrompt,
        model: videoBody!.model,
        referenceMode: 'reference',
        imageUrl: videoBody!.image_url,
        firstFrameUrl: videoBody!.first_frame_url,
        lastFrameUrl: videoBody!.last_frame_url,
        referenceImageUrls: videoBody!.reference_image_urls,
        referenceVideoUrls: videoBody!.reference_video_urls,
        referenceAudioUrls: videoBody!.reference_audio_urls,
        referenceFileUrl: videoBody!.file_url,
        referenceLinkUrl: videoBody!.link_url,
        generateAudio: videoBody!.generate_audio,
        duration: videoBody!.duration,
        aspectRatio: videoBody!.aspect_ratio,
        resolution: videoResolution || videoBody!.resolution,
        seed: videoBody!.seed,
        promptExtend: videoBody!.prompt_extend,
        watermark: videoBody!.watermark,
        configId,
      })

    const [record] = await db.select().from(schema.sysTask)
      .where(eq(schema.sysTask.id, id))
    logTaskSuccess('TaskAPI', 'generate', { taskId: id, type, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('TaskAPI', 'generate', { type, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /tasks/:id — 轮询任务状态
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask)
    .where(eq(schema.sysTask.id, id))
  return success(c, row || null)
})

// GET /tasks — 列表：type / status / drama_id / storyboard_id / keyword(prompt 模糊) + 分页 + 状态统计
app.get('/', async (c) => {
  const type = c.req.query('type')
  const status = c.req.query('status')
  const dramaId = Number(c.req.query('drama_id')) || undefined
  const storyboardId = Number(c.req.query('storyboard_id')) || undefined
  const keyword = (c.req.query('keyword') || '').trim()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size')) || 50))

  const conds = []
  if (type) conds.push(eq(schema.sysTask.type, type))
  if (status) conds.push(eq(schema.sysTask.status, status))
  if (dramaId) conds.push(eq(schema.sysTask.dramaId, dramaId))
  if (storyboardId) conds.push(eq(schema.sysTask.storyboardId, storyboardId))
  if (keyword) conds.push(like(schema.sysTask.prompt, `%${keyword}%`))
  const where = conds.length ? and(...conds) : undefined

  const [totalRow] = await db.select({ n: sql<number>`count(*)` }).from(schema.sysTask).where(where)
  const countRows = await db.select({ status: schema.sysTask.status, n: sql<number>`count(*)` })
    .from(schema.sysTask).groupBy(schema.sysTask.status)
  const items = await db.select().from(schema.sysTask)
    .where(where)
    .orderBy(desc(schema.sysTask.createdAt), desc(schema.sysTask.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return success(c, {
    items,
    total: Number(totalRow?.n || 0),
    page,
    pageSize,
    counts: Object.fromEntries(countRows.map(r => [r.status, Number(r.n)])),
  })
})

// DELETE /tasks/:id — 进行中的任务不可直接删（先取消），终态记录可删
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask)
    .where(eq(schema.sysTask.id, id))
  if (row?.status === 'processing') return badRequest(c, '任务进行中，请先取消再删除')
  await db.delete(schema.sysTask).where(eq(schema.sysTask.id, id))
  return success(c)
})

// POST /tasks/:id/cancel — 取消进行中的任务（上游无法撤回，结果将被丢弃）
app.post('/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效的任务 ID')
  const outcome = await cancelTask(id)
  if (outcome === 'not-found') return badRequest(c, '任务不存在')
  if (outcome === 'not-cancellable') return badRequest(c, '仅进行中的任务可取消')
  return success(c)
})

// POST /tasks/:id/retry — 重试失败/已取消的任务：先查上游进度，能续则续跑原任务；
// 上游已失败/提交期失败时原地重新提交（复用同一条记录，保留任务历史与进度）
app.post('/:id/retry', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效的任务 ID')
  try {
    const newId = await retryTask(id)
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, newId))
    logTaskSuccess('TaskAPI', 'retry', { originId: id, taskId: newId })
    return created(c, record)
  } catch (err: any) {
    logTaskError('TaskAPI', 'retry', { originId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /tasks/:id/refresh — 用户主动查询上游进度：单次 pollTick 推进状态并返回最新行
app.post('/:id/refresh', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效的任务 ID')
  try {
    const { record, outcome } = await refreshTask(id)
    return success(c, { task: record, outcome })
  } catch (err: any) {
    logTaskError('TaskAPI', 'refresh', { id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /tasks/batch-delete — 批量删除（进行中的任务自动跳过）
app.post('/batch-delete', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : []
  if (!ids.length) return badRequest(c, 'ids 必须为非空数字数组')
  const rows = await db.select({ id: schema.sysTask.id })
    .from(schema.sysTask)
    .where(and(inArray(schema.sysTask.id, ids), ne(schema.sysTask.status, 'processing')))
  if (rows.length) {
    await db.delete(schema.sysTask).where(inArray(schema.sysTask.id, rows.map(r => r.id)))
  }
  return success(c, { deleted: rows.length, skipped: ids.length - rows.length })
})

// POST /tasks/clear — 按 scope 清理已结束的任务记录（processing 永不清理，媒体文件保留）
app.post('/clear', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const scope = String(body.scope || 'finished')
  const STATUSES = ['completed', 'failed', 'cancelled']
  const statuses = STATUSES.includes(scope) ? [scope] : STATUSES
  const rows = await db.select({ id: schema.sysTask.id })
    .from(schema.sysTask)
    .where(inArray(schema.sysTask.status, statuses))
  if (rows.length) {
    await db.delete(schema.sysTask).where(inArray(schema.sysTask.id, rows.map(r => r.id)))
  }
  return success(c, { deleted: rows.length })
})

// POST /tasks/sweep + GET /tasks/sweep — serverless 任务续跑
// GET 供 Vercel Cron 调用（cron 仅发 GET，自带 Authorization: Bearer ${CRON_SECRET}）；POST 供外部监控/手动触发
function sweepHandler() {
  return async (c: any) => {
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = c.req.header('authorization') || ''
      if (auth !== `Bearer ${secret}`) {
        return c.json({ code: 401, message: 'unauthorized' }, 401)
      }
    }
    const result = await sweepProcessingTasks()
    return success(c, result)
  }
}
app.post('/sweep', sweepHandler())
app.get('/sweep', sweepHandler())

export default app
