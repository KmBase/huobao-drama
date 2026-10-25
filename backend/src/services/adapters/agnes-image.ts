/**
 * Agnes Image 2.5 Flash 图片生成 Adapter（协议: agnes）
 * 请求：  POST /v1/images/generations  （同步返回）
 * 模型：  agnes-image-2.5-flash
 * 参数：  model / prompt / size("1K"|"2K"|"3K"|"4K") / ratio / return_base64
 *         extra_body: { response_format: "url"|"b64_json", image: [参考图 URL / Data URI 列表] }
 * 响应：  { data: [{ url }] } 或 { data: [{ b64_json }] }
 *
 * 参考图接受公网 http(s) URL 或 Data URI Base64（2026-10 实测）。走 data-url 传输形态：
 * generation.ts 把本地/远程参考图统一压成 Base64 Data URI，桌面版不依赖内网穿透即可用参考图，
 * 也避免上游回源下载被访问密码 / 隧道状态卡住。
 *
 * 本项目的生图记录以 "宽x高"（默认 1920x1080）描述画幅，Agnes 只接受
 * "清晰度档位 + 画幅比例"，因此适配器内置换算：最大边定档位、宽高比就近取比例。
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

const MODEL_PREFIX = 'agnes-image-'
const DEFAULT_MODEL = 'agnes-image-2.5-flash'
/** 参考图上限（Agnes 硬限制） */
const MAX_REFERENCE_IMAGES = 6
/** 支持的画幅比例 */
const SUPPORTED_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'] as const

/** 记录里的 size（"WxH"）→ 清晰度档位 */
function sizeTier(size?: string | null): string {
  const [rawW, rawH] = String(size || '1920x1080').toLowerCase().split('x').map(Number)
  const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1920
  const h = Number.isFinite(rawH) && rawH > 0 ? rawH : 1080
  const maxSide = Math.max(w, h)
  if (maxSide >= 3840) return '4K'
  if (maxSide >= 2560) return '3K'
  if (maxSide >= 1280) return '2K'
  return '1K'
}

/** 记录里的 size（"WxH"）→ 最接近的支持比例 */
function sizeRatio(size?: string | null): string {
  const [rawW, rawH] = String(size || '1920x1080').toLowerCase().split('x').map(Number)
  const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1920
  const h = Number.isFinite(rawH) && rawH > 0 ? rawH : 1080
  const target = Math.log(w / h)
  let best: string = '16:9'
  let bestDiff = Number.POSITIVE_INFINITY
  for (const ratio of SUPPORTED_RATIOS) {
    const [rw, rh] = ratio.split(':').map(Number)
    const diff = Math.abs(target - Math.log(rw / rh))
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratio
    }
  }
  return best
}

function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.filter((u): u is string => typeof u === 'string' && !!u.trim())
      : []
  } catch {
    return []
  }
}

export class AgnesImageAdapter implements ImageProviderAdapter {
  provider = 'agnes'
  /** Agnes 图片端接受 Data URI Base64：参考图走 data-url 传输，无需公网出口 */
  referenceImageTransport = 'data-url' as const

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_MODEL
    if (!model.startsWith(MODEL_PREFIX)) {
      throw new Error(`仅支持 Agnes 图片模型（${MODEL_PREFIX}-*），当前: ${model}`)
    }

    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('提示词不能为空')

    // generation.ts 已按 data-url 传输形态把参考图统一压成 Base64 Data URI（或直通 http(s) URL）
    const referenceImages = parseUrlArray(record.referenceImages)
    if (referenceImages.length > MAX_REFERENCE_IMAGES) {
      throw new Error(`参考图超限：Agnes 最多 ${MAX_REFERENCE_IMAGES} 张，当前 ${referenceImages.length} 张`)
    }
    const invalid = referenceImages.find((u) => !/^data:image\//i.test(u) && !/^https?:\/\//i.test(u))
    if (invalid) throw new Error('Agnes 参考图片必须是公网 http(s) URL 或 Data URI Base64')

    const extraBody: Record<string, any> = { response_format: 'url' }
    if (referenceImages.length) extraBody.image = referenceImages

    const body = {
      model,
      prompt,
      size: sizeTier(record.size),
      ratio: sizeRatio(record.size),
      extra_body: extraBody,
    }

    return {
      url: joinProviderUrl(config.baseUrl, '', '/v1/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const item = Array.isArray(result?.data) ? result.data[0] : null
    if (item?.url) return { isAsync: false, imageUrl: item.url }
    if (item?.b64_json) return { isAsync: false }
    // 图片接口为同步返回；若上游改为异步任务，按轮询约定收发（与视频同网关）
    const taskId = result?.image_id || result?.id || result?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    throw new Error('No image url or base64 in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const url = new URL(joinProviderUrl(config.baseUrl, '', '/agnesapi'))
    url.searchParams.set('video_id', taskId)
    url.searchParams.set('model_name', config.model || DEFAULT_MODEL)
    return {
      url: url.toString(),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = String(result?.status || '').toLowerCase()
    const imageUrl = this.extractImageUrl(result)
    const progress = Number(result?.progress ?? 0)
    // Agnes 进度只有两档：生成中恒 10，完成 100；缺省/异常值不透出
    const percent = Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : undefined
    if (status === 'completed' || progress >= 100 || imageUrl) {
      return { status: 'completed', imageUrl: imageUrl || undefined, percent: 100 }
    }
    if (status === 'failed' || status === 'cancelled') {
      const err = result?.error
      const msg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err) || 'Image generation failed')
      return { status: 'failed', error: msg }
    }
    return { status: 'processing', percent }
  }

  extractImageUrl(result: any): string | null {
    const item = Array.isArray(result?.data) ? result.data[0] : null
    return item?.url || result?.url || result?.metadata?.url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const item = Array.isArray(result?.data) ? result.data[0] : null
    const raw = item?.b64_json
    if (!raw || typeof raw !== 'string') return null
    const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
    if (match) return { mimeType: match[1], data: match[2] }
    return { mimeType: 'image/png', data: raw }
  }
}
