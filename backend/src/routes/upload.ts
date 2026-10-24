import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'
import { IS_SERVERLESS } from '../utils/runtime-mode.js'

const app = new Hono()

// POST /upload/direct — Vercel Blob 客户端直传握手端点（仅 serverless 形态）
// 前端用 @vercel/blob/client 的 upload(pathname, file, { handleUploadUrl: '/api/v1/upload/direct' })
// 直传大文件（视频 50MB 超过 Vercel 函数 4.5MB 请求体限制，必须绕过函数体）。
// pathname 沿用规范布局 static/uploads/<uuid>.<ext>，与 multipart 上传产物路径一致。
app.post('/direct', async (c) => {
  if (!IS_SERVERLESS) {
    return badRequest(c, '直传端点仅 serverless 形态可用，请使用 /upload/video 或 /upload/audio')
  }
  const { handleUpload } = await import('@vercel/blob/client')
  const body = await c.req.json().catch(() => ({}))
  const result = await handleUpload({
    request: c.req.raw,
    body,
    onBeforeGenerateToken: async () => ({
      // uuid 命名由前端生成，禁随机后缀以保持相对路径规范形态
      addRandomSuffix: false,
      // 与本地形态的视频/音频限额对齐（参考视频 50MB）
      maximumSizeInBytes: 50 * 1024 * 1024,
    }),
    // 回调仅用于对账，业务以客户端 upload() 的返回值为准
    onUploadCompleted: async () => {},
  })
  return c.json(result as Record<string, unknown>)
})

// POST /upload/image
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  // 同步生成列表页缩略图，上传图与生图走同一套展示链路（失败不影响上传结果）
  await generateImageThumb(path)
  return success(c, { url: `/${path}`, path })
})

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
const VIDEO_MAX = 50 * 1024 * 1024 // 50MB

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac'])
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'])
const AUDIO_MAX = 20 * 1024 * 1024 // 20MB

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

async function saveMediaUpload(
  c: any,
  kind: 'video' | 'audio',
  allowedExt: Set<string>,
  allowedMime: Set<string>,
  maxBytes: number,
) {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return badRequest(c, '文件必填')
  }
  const label = kind === 'video' ? '视频' : '音频'
  const ext = extOf(file.name)
  // MIME 可伪造，扩展名兜底；空 / octet-stream 视为未知类型，仅按扩展名校验
  const mimeKnown = file.type && file.type !== 'application/octet-stream'
  if (!allowedExt.has(ext) || (mimeKnown && !allowedMime.has(file.type))) {
    return badRequest(c, `仅支持 ${Array.from(allowedExt).join('/')} 格式的${label}文件`)
  }
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return badRequest(c, `${label}文件大小不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  }
  const path = await saveUploadedFile(buffer, 'uploads', file.name)
  return success(c, { url: `/${path}`, path })
}

// POST /upload/video — 参考视频上传（Seedance 多模态参考用）
app.post('/video', async (c) => saveMediaUpload(c, 'video', VIDEO_EXT, VIDEO_MIME, VIDEO_MAX))

// POST /upload/audio — 参考音频上传（Seedance 多模态参考用）
app.post('/audio', async (c) => saveMediaUpload(c, 'audio', AUDIO_EXT, AUDIO_MIME, AUDIO_MAX))

export default app
