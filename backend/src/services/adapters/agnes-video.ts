/**
 * Agnes Video 2.5 Flash 视频生成 Adapter（协议: agnes）
 * 提交端点: POST /v1/videos （异步，返回 video_id）
 * 查询端点: GET  /agnesapi?video_id=<ID>&model_name=<model>
 * 模型 ID:  agnes-video-2.5-flash
 *
 * 支持模式（mode 互斥）:
 * - text      纯文本生成
 * - keyframe  首尾帧控制（first_frame / last_frame，至少一个，公网 URL）
 * - reference 参考素材（images ≤5、audios ≤3；prompt 内用 <Picture N> / <Audio N> 指代）
 *
 * 媒体参数只接受**公网可访问的 URL**（Agnes 官方要求，不支持 Base64 Data URI）。
 * 本地生成的首尾帧 / 参考图需经内网穿透 / 反代暴露，见 generation.ts 的
 * referenceImageTransport 分流。
 *
 * Flash 限制（提交前强制校验，避免产生费用）:
 * - size 固定 "720P"
 * - 时长 4~12 秒
 * - 画幅比例仅 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16
 * - 不支持视频参考素材
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { assertPublicHttpUrl, assertPublicHttpUrls, joinProviderUrl } from './url'

const MODEL_PREFIX = 'agnes-video-'
const DEFAULT_MODEL = 'agnes-video-2.5-flash'

/** 参考素材上限：图片 5、音频 3（Flash 校验硬限制） */
const REF_LIMITS = { images: 5, audios: 3 } as const
/** 时长上限（秒，字符串形式提交） */
const SECONDS_MIN = 4
const SECONDS_MAX = 12
/** 固定输出分辨率 */
const SIZE = '720P'
/** 支持的画幅比例 */
const SUPPORTED_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

type GenMode = 'text' | 'keyframe' | 'reference'

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

function toUrl(v: string | null | undefined): string | undefined {
  const s = String(v || '').trim()
  return s || undefined
}

export class AgnesVideoAdapter implements VideoProviderAdapter {
  provider = 'agnes'
  /** Agnes 只接受公网 URL，本地首尾帧 / 参考图必须先解析成公网地址 */
  referenceImageTransport = 'public-url' as const

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    if (!model.startsWith(MODEL_PREFIX)) {
      throw new Error(`仅支持 Agnes 视频模型（${MODEL_PREFIX}-*），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('提示词不能为空')

    const firstFrame = toUrl(record.firstFrameUrl)
    const lastFrame = toUrl(record.lastFrameUrl)
    const refVideos = parseUrlArray(record.referenceVideoUrls)
    if (refVideos.length) {
      throw new Error('Agnes 视频 2.5 Flash 不支持视频参考素材，请改用图片参考')
    }

    let refImages = parseUrlArray(record.referenceImageUrls)
    if (!refImages.length) {
      // 兼容单张参考图/文件链接字段（generation.ts 已按 referenceImageTransport 归一化为公网 URL）
      refImages = [toUrl(record.referenceFileUrl), toUrl(record.referenceLinkUrl)]
        .filter((u): u is string => !!u)
    }
    const refAudios = parseUrlArray(record.referenceAudioUrls)

    const mode: GenMode = firstFrame || lastFrame
      ? 'keyframe'
      : refImages.length || refAudios.length
        ? 'reference'
        : 'text'

    if (mode === 'keyframe' && refAudios.length) {
      throw new Error('Agnes 首尾帧模式不支持音频参考，请改用图片参考模式')
    }
    if (refImages.length > REF_LIMITS.images) {
      throw new Error(`参考图片超限：Agnes 最多 ${REF_LIMITS.images} 张，当前 ${refImages.length} 张`)
    }
    if (refAudios.length > REF_LIMITS.audios) {
      throw new Error(`参考音频超限：Agnes 最多 ${REF_LIMITS.audios} 段，当前 ${refAudios.length} 段`)
    }

    // 媒体参数全部必须是公网 URL（Agnes 明确要求），提前拦下避免白跑一次计费调用
    assertPublicHttpUrl(firstFrame, 'Agnes 首帧图片')
    assertPublicHttpUrl(lastFrame, 'Agnes 尾帧图片')
    assertPublicHttpUrls(refImages, 'Agnes 参考图片')
    assertPublicHttpUrls(refAudios, 'Agnes 参考音频')

    const body: any = {
      model,
      prompt,
      seconds: this.normalizeSeconds(record.duration),
      mode,
      size: SIZE,
      aspect_ratio: this.normalizeAspect(record.aspectRatio),
      n: 1,
    }
    if (record.seed != null && record.seed !== undefined) body.seed = record.seed

    if (mode === 'keyframe') {
      if (firstFrame) body.first_frame = firstFrame
      if (lastFrame) body.last_frame = lastFrame
    } else if (mode === 'reference') {
      if (refImages.length) body.images = refImages
      if (refAudios.length) body.audios = refAudios
    }

    return {
      url: joinProviderUrl(config.baseUrl, '', '/v1/videos'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const videoId = result.video_id || result.id || result.task_id
    if (videoId) {
      // 提交与轮询的 model_name 必须一致，config.model 可能已被 record.model 覆盖，
      // 这里把实际模型名随 taskId 一起带出去（poll 端解码）
      const model = result.model || result.video_model_name || DEFAULT_MODEL
      return { isAsync: true, taskId: `${videoId}::${model}` }
    }
    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No video_id or video url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const [videoId, modelName] = taskId.split('::')
    const url = new URL(joinProviderUrl(config.baseUrl, '', '/agnesapi'))
    url.searchParams.set('video_id', videoId)
    url.searchParams.set('model_name', modelName || config.model || DEFAULT_MODEL)
    return {
      url: url.toString(),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result.status || '').toLowerCase()
    const progress = Number(result.progress ?? 0)
    const videoUrl = this.extractVideoUrl(result)

    if (status === 'completed' || progress >= 100 || videoUrl) {
      return { status: 'completed', videoUrl: videoUrl || undefined }
    }
    if (status === 'failed' || status === 'cancelled') {
      // 上游 error 可能是对象 { code, message }，规范成字符串
      const err = result.error
      const msg = typeof err === 'string'
        ? err
        : (err?.message || JSON.stringify(err) || 'Video generation failed')
      const code = err && typeof err === 'object' && err.code ? `[${err.code}] ` : ''
      return { status: 'failed', error: `${code}${msg}` }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.url || result.metadata?.url || result.data?.url || null
  }

  private normalizeSeconds(duration?: number | null): string {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return String(5)
    return String(Math.min(SECONDS_MAX, Math.max(SECONDS_MIN, parsed)))
  }

  private normalizeAspect(aspectRatio?: string | null): string {
    const value = String(aspectRatio || '').trim()
    if ((SUPPORTED_RATIOS as readonly string[]).includes(value)) return value
    // 就近收敛：3:2→4:3、2:3→3:4，其余回退 16:9
    const near: Record<string, string> = { '3:2': '4:3', '2:3': '3:4', adaptive: '16:9' }
    return near[value] || '16:9'
  }
}
