/**
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 下载落盘 → 回写业务表
 */
import { db, getInsertId, schema } from '../db/index.js'
import { eq, and, lt } from 'drizzle-orm'
import { waitUntil } from '@vercel/functions'
import { getActiveConfig, getConfigById } from './ai.js'
import { getPublicMediaBaseUrl } from './app-settings.js'
import { now } from '../utils/response.js'
import { downloadFile, fetchImageAsCompressedDataUrl, generateImageThumb, readImageAsCompressedDataUrl, readImageAsDataUrl, saveBase64Image } from '../utils/storage.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { IS_SERVERLESS } from '../utils/runtime-mode.js'

type TaskType = 'image' | 'video'

const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s×300
const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: 300, intervalMs: 10_000, maxDurationMs: null },
}

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  referenceFileUrl?: string
  referenceLinkUrl?: string
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  configId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置，避免生成被旧引用卡死
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('image')
    : await getActiveConfig('image')
  if (!config) throw new Error('未配置图片模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages: params.referenceImages,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, protocol: config.protocol, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('video')
    : await getActiveConfig('video')
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    referenceMode: params.referenceMode || 'reference',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    referenceFileUrl: params.referenceFileUrl,
    referenceLinkUrl: params.referenceLinkUrl,
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    // 统一存为项目内部格式，各适配器再转换为官方大小写与枚举。
    resolution: normalizeStoredVideoResolution(params.resolution),
    seed: params.seed,
    promptExtend: params.promptExtend,
    watermark: params.watermark,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'reference',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, protocol: config.protocol, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
  },
  params: Record<string, unknown>,
): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type,
    ...fields,
    provider: config.provider,
    // __configId 供 sweep 续跑时还原 AI 配置（行内无 config 列，借 params 携带）
    params: JSON.stringify({ ...params, __configId: config.id }),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })

  const id = getInsertId(res)
  // serverless：waitUntil 在响应后继续提交（函数被回收由 sweep 兜底重提交/续跑轮询）；
  // 本地：维持进程内 fire-and-forget 全流程
  waitUntil(processTask(id, config).catch(err => {
    logTaskError(taskLabel(type), 'process', { id, error: err.message })
    console.error(`${taskLabel(type)} ${id} failed:`, err)
  }))
  return id
}

function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

async function processTask(id: number, config: AIConfig) {
  try {
    // 提交期心跳：sweep 以 updatedAt > 90s 视为僵死，提交耗时长时避免被误判重提交
    await touchTask(id)
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    const type = record.type as TaskType
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)
    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown

    if (type === 'image') {
      const adapter = getImageAdapter(config.protocol)
      // 传输形态由协议决定：public-url（Agnes）只接受公网地址；其余协议内联 Base64
      const usePublicUrl = adapter.referenceImageTransport === 'public-url'
      const resolvedReferenceImages = await (usePublicUrl
        ? resolveReferenceImages(params.referenceImages)
        : normalizeReferenceImages(params.referenceImages))
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
      }))
    } else {
      const adapter = getVideoAdapter(config.protocol)
      // 传输形态由协议决定：public-url（Agnes）只接受公网地址；其余协议内联 Base64
      const usePublicUrl = adapter.referenceImageTransport === 'public-url'
      const resolveImage = usePublicUrl ? resolveVideoReferenceUrl : normalizeVideoReferenceUrl
      const resolveImageList = usePublicUrl ? resolveVideoReferenceUrls : normalizeVideoReferenceUrls
      const resolvedImageUrl = await resolveImage(params.imageUrl)
      const resolvedFirstFrameUrl = await resolveImage(params.firstFrameUrl)
      const resolvedLastFrameUrl = await resolveImage(params.lastFrameUrl)
      const resolvedReferenceImageUrls = await resolveImageList(params.referenceImageUrls)
      // 参考视频/音频文件较大，不适合 dataURL 内联，需解析为公网可访问 URL
      const resolvedReferenceVideoUrls = await resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
      const resolvedReferenceAudioUrls = await resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
      const resolvedReferenceFileUrl = await resolvePublicMediaUrl(params.referenceFileUrl, 'file')
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        referenceMode: params.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls.length ? JSON.stringify(resolvedReferenceImageUrls) : null,
        referenceVideoUrls: resolvedReferenceVideoUrls.length ? JSON.stringify(resolvedReferenceVideoUrls) : null,
        referenceAudioUrls: resolvedReferenceAudioUrls.length ? JSON.stringify(resolvedReferenceAudioUrls) : null,
        referenceFileUrl: resolvedReferenceFileUrl,
        referenceLinkUrl: params.referenceLinkUrl,
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        seed: params.seed,
        promptExtend: params.promptExtend,
        watermark: params.watermark,
      }))
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })

    const isMultipart = body instanceof FormData
    logTaskPayload(label, 'request payload', {
      id, method, url, headers,
      // multipart 表单（如 OpenAI /v1/images/edits）无法 JSON 化，记录字段摘要
      body: isMultipart ? `[multipart/form-data: ${[...(body as FormData).keys()].join(', ')}]` : body,
    })

    const resp = await fetch(url, {
      method,
      headers,
      body: isMultipart ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    })

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    const result = await resp.json() as any
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const adapter = getImageAdapter(config.protocol)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      await markPolling(id, taskId)
      // serverless：轮询交给 sweep tick 驱动（cron 函数随时被回收，不能长跑循环）
      if (!IS_SERVERLESS) pollTask(record, config, taskId!)
      return
    }

    const adapter = getVideoAdapter(config.protocol)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    await markPolling(id, taskId)
    if (!IS_SERVERLESS) pollTask(record, config, taskId!)
  } catch (err: any) {
    await failTask(id, err.message)
  }
}

async function markPolling(id: number, taskId: string | undefined) {
  await db.update(schema.sysTask)
    .set({ taskId, status: 'processing', updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

/** 心跳：刷新 updatedAt，向 sweep 表明任务有活着的执行者（本地轮询线程 / waitUntil / sweep tick） */
async function touchTask(id: number) {
  await db.update(schema.sysTask).set({ updatedAt: now() }).where(eq(schema.sysTask.id, id))
}

/** 终态集合：终态互不覆盖（取消后上游超时/报错不得改写为 failed） */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

async function failTask(id: number, message: string) {
  const [cur] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (cur && cur.status && TERMINAL_STATUSES.has(cur.status)) return
  logTaskError('SysTask', 'failed', { id, error: message })
  await db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: message, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
}

type SysTaskRecord = typeof schema.sysTask.$inferSelect

async function pollTask(record: SysTaskRecord, config: AIConfig, taskId: string) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const profile = POLL_PROFILES[type]
  const adapter = type === 'image' ? getImageAdapter(config.protocol) : getVideoAdapter(config.protocol)
  const startedAt = Date.now()
  // 连续 404 计数：轮询端点明确说"没有这个任务"时（如 taskId 无效 / 网关不支持该模型），
  // 尽快给出可读的失败，而不是默默重试到超时让任务假死在"生成中"
  let notFoundStreak = 0

  for (let i = 0; i < profile.attempts; i++) {
    if (profile.maxDurationMs && Date.now() - startedAt >= profile.maxDurationMs) {
      await failTask(record.id, 'Timeout: Polling exceeded 10 minutes')
      return
    }
    await new Promise(r => setTimeout(r, profile.intervalMs))
    // 用户取消：每轮重读状态，非 processing 即静默终止（终态已由取消接口落库）
    const [cur] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, record.id))
    if (cur && cur.status !== 'processing') {
      logTaskProgress(label, 'poll-stop', { id: record.id, status: cur.status })
      return
    }
    // 轮询期心跳：serverless sweep 与本地进程内线程都靠它互斥，避免双写完成态
    await touchTask(record.id)
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress(label, 'poll-request', {
        id: record.id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const remainingMs = profile.maxDurationMs
        ? Math.max(1_000, profile.maxDurationMs - (Date.now() - startedAt))
        : 600_000
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(remainingMs),
      })
      if (!resp.ok) {
        if (resp.status === 404) {
          notFoundStreak++
          if (notFoundStreak >= 12) {
            const detail = await resp.text().catch(() => '')
            await failTask(record.id, `轮询端点 404，上游任务无法查询（可能不支持该 taskId 或模型）: ${redactUrl(url)} ${detail.slice(0, 200)}`)
            return
          }
        } else {
          notFoundStreak = 0
        }
        continue
      }
      notFoundStreak = 0
      const result = await resp.json() as any

      // 图片/视频 PollResponse 结构不同，这里统一按 any 取值后按 type 分支
      const pollResp: any = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed') {
        if (type === 'image') {
          if (pollResp.imageUrl) {
            logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, imageUrl: pollResp.imageUrl })
            await handleImageComplete(record, pollResp.imageUrl)
            return
          }
          if (adapter.provider === 'gemini') {
            // Gemini 可能返回 base64
            const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
            if (b64) {
              logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
              await handleImageCompleteBase64(record, b64.data, b64.mimeType)
              return
            }
          }
        } else if (pollResp.videoUrl) {
          logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, videoUrl: pollResp.videoUrl })
          await handleVideoComplete(record, pollResp.videoUrl, pollResp.duration)
          return
        }
      }
      if (pollResp.status === 'failed') {
        // 上游明确失败（如内容审核拦截）属终态：立即落库，不重试不等待超时
        await failTask(record.id, pollResp.error || 'Generation failed')
        return
      }
    } catch (err: any) {
      const exhausted = i === profile.attempts - 1
        || (profile.maxDurationMs != null && Date.now() - startedAt >= profile.maxDurationMs)
      if (exhausted) {
        await failTask(record.id, `Timeout: ${err.message}`)
        return
      }
      logTaskWarn(label, 'poll-retry', { id: record.id, taskId, attempt: i + 1, error: err.message })
    }
  }
  await failTask(record.id, 'Timeout: polling attempts exhausted')
}

/** 完成回写守卫：任务已取消/已终态时丢弃结果，不写库不回写资产 */
async function isStillProcessing(id: number): Promise<boolean> {
  const [cur] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, id))
  return !!cur && cur.status === 'processing'
}

async function handleImageComplete(record: SysTaskRecord, imageUrl: string) {
  if (!(await isStillProcessing(record.id))) return
  const localPath = await downloadFile(imageUrl, 'images')
  // 列表页缩略图（前端按命名约定推导地址，失败不影响主流程）
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ resultUrl: imageUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(and(eq(schema.sysTask.id, record.id), eq(schema.sysTask.status, 'processing')))
  // 条件更新未命中（已被取消）时跳过资产回写
  const [after] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, record.id))
  if (after?.status !== 'completed') {
    logTaskProgress('ImageTask', 'complete-skipped', { id: record.id, reason: after?.status || 'missing' })
    return
  }

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })

  await writeBackImageAssets(record, localPath)
}

async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  if (!(await isStillProcessing(record.id))) return
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(and(eq(schema.sysTask.id, record.id), eq(schema.sysTask.status, 'processing')))
  // 条件更新未命中（已被取消）时跳过资产回写
  const [after] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, record.id))
  if (after?.status !== 'completed') {
    logTaskProgress('ImageTask', 'complete-skipped', { id: record.id, reason: after?.status || 'missing' })
    return
  }

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })

  await writeBackImageAssets(record, localPath)
}

// 图片完成后回写业务表：分镜(按 frameType)、角色、场景、道具
async function writeBackImageAssets(record: SysTaskRecord, localPath: string) {
  const params = parseTaskParams(record.params)
  if (record.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (params.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (params.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    await db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId))
  }
  if (record.characterId) {
    await db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId))
  }
  if (record.sceneId) {
    await db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId))
  }
  if (record.propId) {
    await db.update(schema.props).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.props.id, record.propId))
  }
}

async function handleVideoComplete(record: SysTaskRecord, videoUrl: string, duration: number | null | undefined) {
  if (!(await isStillProcessing(record.id))) return
  const localPath = await downloadFile(videoUrl, 'videos')
  // 海报帧供列表/封面展示，避免前端为显示首帧缓冲整个视频
  await extractVideoPoster(localPath)
  await db.update(schema.sysTask)
    .set({ resultUrl: videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(and(eq(schema.sysTask.id, record.id), eq(schema.sysTask.status, 'processing')))
  // 条件更新未命中（已被取消）时跳过分镜回写
  const [after] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, record.id))
  if (after?.status !== 'completed') {
    logTaskProgress('VideoTask', 'complete-skipped', { id: record.id, reason: after?.status || 'missing' })
    return
  }

  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, localPath, storyboardId: record.storyboardId, duration })

  if (record.storyboardId) {
    await db.update(schema.storyboards)
      .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, record.storyboardId))
  }
}

/** 本地上传统径：static/... 或 /static/... */
function isLocalStaticPath(value: string): boolean {
  return value.startsWith('static/') || value.startsWith('/static/')
}

/**
 * 取公网媒体地址（内网穿透 / 反代出口）。
 * 优先设置页配置（app_settings.public_media_base_url，桌面版由隧道管理器写入），
 * 回退 PUBLIC_BASE_URL 环境变量（服务器部署沿用）。
 */
async function publicMediaBase(): Promise<string | null> {
  const dbValue = await getPublicMediaBaseUrl()
  if (dbValue) return dbValue
  const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  return env || null
}

/** 本地 static 路径 → 公网 URL；未配置出口时抛出可操作的中文错误 */
async function toPublicMediaUrl(raw: string, kind: 'image' | 'video' | 'audio' | 'file'): Promise<string> {
  const base = await publicMediaBase()
  if (!base) {
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
    throw new Error(
      `参考${label}为本地路径 ${raw}，而该协议的上游只接受公网可访问的 URL（内网地址无法被回源）。` +
      `请在「设置 → 公网访问」开启内网穿透或填写公网媒体地址后重试（服务器部署可配置 PUBLIC_BASE_URL 环境变量），也可直接填写公网 URL。`,
    )
  }
  const p = raw.startsWith('/') ? raw : `/${raw}`
  return `${base}${p}`
}

/**
 * 将参考素材解析为上游可访问的 URL（URL-only 协议通用）。
 * http(s) / data: 直通；本地 static 路径拼公网出口，未配置出口时抛出可操作的中文错误。
 */
async function resolvePublicMediaUrl(value: string | null | undefined, kind: 'image' | 'video' | 'audio' | 'file'): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
  if (isLocalStaticPath(raw)) return await toPublicMediaUrl(raw, kind)
  return raw
}

async function resolvePublicMediaUrls(refs: string[] | null | undefined, kind: 'image' | 'video' | 'audio'): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  const resolved = await Promise.all(items.map((item) => resolvePublicMediaUrl(item, kind)))
  return resolved.filter((item): item is string => !!item)
}

// ─── 参考素材归一化 ───────────────────────────────────────────────

/**
 * 参考图 → Base64 Data URI（data-url 协议，如 OpenAI / Gemini / 火山 / Wan）。
 * 本地 static 路径读盘压缩；远程 URL 下载压缩；两种形态都保证 multipart 上传与 inline_data 可用。
 */
async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (isLocalStaticPath(value)) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    // 远程 URL：下载压缩为 data URL，保证 multipart 上传（OpenAI edits）/ inline_data（Gemini）都可用
    if (/^https?:\/\//.test(value)) {
      try {
        return await fetchImageAsCompressedDataUrl(value, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-fetch-failed', { url: value, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

/**
 * 参考图 → 公网 URL（public-url 协议，如 Agnes）。
 * 与 normalizeReferenceImages 对偶：不下载不编码，只把本地路径换成上游可访问的地址。
 */
async function resolveReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  return resolvePublicMediaUrls(refs, 'image')
}

/**
 * 视频首尾帧 / 参考图 → Base64 Data URI（data-url 协议）。
 * 直接编码原文件，保留原始尺寸、格式、透明通道和画质。
 */
async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (isLocalStaticPath(raw)) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      return await readImageAsDataUrl(localPath)
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

/** 视频首尾帧 / 参考图 → 公网 URL（public-url 协议） */
async function resolveVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  return resolvePublicMediaUrl(value, 'image')
}

async function resolveVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  return resolvePublicMediaUrls(refs, 'image')
}

function normalizeStoredVideoResolution(resolution: string | null | undefined): string | undefined {
  const value = String(resolution || '').trim().toLowerCase()
  if (value === '480p' || value === '720p' || value === '1080p') return value
  if (value === '2k') return '2K'
  return undefined
}

// ─── Sweep：serverless 任务续跑（Vercel Cron 每分钟驱动） ───────────
// 本地形态进程内轮询线程常驻，不需要 sweep；两条形态靠 updatedAt 心跳互斥：
// 活着的执行者（本地线程 / waitUntil / 上一次 tick）持续刷新心跳，
// 只认 updatedAt 超过 SWEEP_STALE_MS 的任务为「无主」，避免双写完成态。

const SWEEP_STALE_MS = 180_000
const SWEEP_MAX_AGE_MS = 2 * 60 * 60 * 1000

type SweepPollOutcome = 'processing' | 'completed' | 'failed'

/** 单次轮询 tick（sweep 用）：一次上游查询并推进状态，不循环不睡眠（cron 函数随时被回收） */
async function pollTick(record: SysTaskRecord, config: AIConfig, taskId: string): Promise<SweepPollOutcome> {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const adapter = type === 'image' ? getImageAdapter(config.protocol) : getVideoAdapter(config.protocol)
  const { url, method, headers } = adapter.buildPollRequest(config, taskId)
  logTaskProgress(label, 'sweep-poll', { id: record.id, taskId, url: redactUrl(url) })
  const resp = await fetch(url, { method, headers, signal: AbortSignal.timeout(60_000) })
  if (!resp.ok) {
    logTaskWarn(label, 'sweep-poll-http-error', { id: record.id, taskId, status: resp.status })
    return 'processing'
  }
  const result = await resp.json() as any
  const pollResp: any = adapter.parsePollResponse(result)

  if (pollResp.status === 'completed') {
    if (type === 'image') {
      if (pollResp.imageUrl) {
        await handleImageComplete(record, pollResp.imageUrl)
        return 'completed'
      }
      if (adapter.provider === 'gemini') {
        const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
        if (b64) {
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return 'completed'
        }
      }
    } else if (pollResp.videoUrl) {
      await handleVideoComplete(record, pollResp.videoUrl, pollResp.duration)
      return 'completed'
    }
    return 'processing'
  }
  if (pollResp.status === 'failed') {
    await failTask(record.id, pollResp.error || 'Generation failed')
    return 'failed'
  }
  return 'processing'
}

/**
 * 扫描滞留的 processing 任务并推进一档：
 * 无 taskId → 提交阶段被回收，重新提交；有 taskId → 单次轮询 tick。
 * 单任务异常不阻断整批；Vercel Cron 每分钟触发一次。
 */
export async function sweepProcessingTasks(): Promise<{ stale: number; resumed: number; failed: number }> {
  const staleCutoff = new Date(Date.now() - SWEEP_STALE_MS).toISOString()
  const stale = await db.select().from(schema.sysTask)
    .where(and(eq(schema.sysTask.status, 'processing'), lt(schema.sysTask.updatedAt, staleCutoff)))

  let resumed = 0
  let failed = 0
  for (const record of stale) {
    if (Date.now() - new Date(record.createdAt).getTime() > SWEEP_MAX_AGE_MS) {
      await failTask(record.id, 'Timeout: 任务超过 2 小时未完成，已由 sweep 兜底标记失败')
      failed++
      continue
    }
    const params = parseTaskParams(record.params)
    const config = (params.__configId ? await getConfigById(params.__configId) : null)
      ?? await getActiveConfig(record.type as TaskType)
    if (!config) {
      await failTask(record.id, 'AI 服务配置已删除或未启用，任务无法继续（请重新配置后重试）')
      failed++
      continue
    }
    try {
      if (!record.taskId) {
        // 提交阶段中断：重新提交（waitUntil 被回收时的兜底；极端情况下上游可能残留孤儿任务）
        await processTask(record.id, config)
      } else {
        const outcome = await pollTick(record, config, record.taskId)
        if (outcome === 'processing') await touchTask(record.id)
      }
      resumed++
    } catch (err: any) {
      logTaskWarn(taskLabel(record.type as TaskType), 'sweep-error', { id: record.id, error: err.message })
    }
  }
  if (stale.length) console.log(`🔁 sweep: ${stale.length} 个滞留任务，续跑 ${resumed}，失败 ${failed}`)
  return { stale: stale.length, resumed, failed }
}

export type CancelOutcome = 'cancelled' | 'not-found' | 'not-cancellable'

/**
 * 取消进行中的任务：落库终态 cancelled。
 * 进程内轮询循环每轮重读状态会自行退出；轮询完成回写有 processing 守卫不会覆盖取消态。
 * 上游已提交的任务无法撤回（边缘仍可能出图/出片），但结果会被丢弃、资产不回写。
 */
export async function cancelTask(id: number): Promise<CancelOutcome> {
  const [row] = await db.select({ status: schema.sysTask.status }).from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return 'not-found'
  if (row.status !== 'processing') return 'not-cancellable'
  await db.update(schema.sysTask)
    .set({ status: 'cancelled', errorMsg: '用户取消', completedAt: now(), updatedAt: now() })
    .where(and(eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
  logTaskProgress('SysTask', 'cancelled', { id })
  return 'cancelled'
}

/**
 * 重试失败/已取消的任务：按 sys_task.params 还原原始入参，新建一条任务（保留历史）。
 * 配置优先用原任务锁定的 __configId，已删除/停用时由 generate* 回退当前启用配置。
 * 提交期的公网地址解析在 processTask 内按当前设置重跑，本地路径无需改写。
 */
export async function retryTask(id: number): Promise<number> {
  const [r] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!r) throw new Error('任务不存在')
  if (r.status === 'processing') throw new Error('任务进行中，无需重试')
  if (r.status === 'completed') throw new Error('任务已完成，无需重试')
  const p = parseTaskParams(r.params)
  const configId = typeof p.__configId === 'number' ? p.__configId : undefined
  if (r.type === 'image') {
    if (!String(r.prompt || '').trim() && !(Array.isArray(p.referenceImages) && p.referenceImages.length)) {
      throw new Error('原任务既无提示词也无参考图，无法重试')
    }
    return generateImage({
      storyboardId: r.storyboardId ?? undefined,
      dramaId: r.dramaId ?? undefined,
      sceneId: r.sceneId ?? undefined,
      characterId: r.characterId ?? undefined,
      propId: r.propId ?? undefined,
      prompt: r.prompt || '',
      model: r.model || undefined,
      size: p.size,
      referenceImages: p.referenceImages,
      frameType: p.frameType,
      configId,
    })
  }
  return generateVideo({
    storyboardId: r.storyboardId ?? undefined,
    dramaId: r.dramaId ?? undefined,
    prompt: r.prompt || '',
    model: r.model || undefined,
    referenceMode: p.referenceMode,
    imageUrl: p.imageUrl,
    firstFrameUrl: p.firstFrameUrl,
    lastFrameUrl: p.lastFrameUrl,
    referenceImageUrls: p.referenceImageUrls,
    referenceVideoUrls: p.referenceVideoUrls,
    referenceAudioUrls: p.referenceAudioUrls,
    referenceFileUrl: p.referenceFileUrl,
    referenceLinkUrl: p.referenceLinkUrl,
    generateAudio: p.generateAudio === 1 ? true : p.generateAudio === 0 ? false : undefined,
    duration: p.duration,
    aspectRatio: p.aspectRatio,
    resolution: p.resolution,
    seed: p.seed,
    promptExtend: p.promptExtend,
    watermark: p.watermark,
    configId,
  })
}
