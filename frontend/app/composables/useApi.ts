const BASE = '/api/v1'

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)

  const start = performance.now()
  console.log(`%c[API] %c${method} %c${path}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', body || '')

  try {
    const resp = await fetch(`${BASE}${path}`, opts)
    const json = await resp.json()
    const ms = Math.round(performance.now() - start)

    if (!resp.ok || (json.code && json.code >= 400)) {
      console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', json.message || '')
      // 访问密码拦截：通知全局锁屏弹层（AccessLock 监听）
      if (resp.status === 401 && json.message === 'UNAUTHORIZED') {
        window.dispatchEvent(new CustomEvent('huobao:unauthorized'))
      }
      throw new Error(json.message || `${resp.status}`)
    }

    console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#66bb6a', 'color:#66bb6a;font-weight:bold', 'color:#888')
    return json.data ?? json
  } catch (err: any) {
    if (!err.message?.match(/^\d{3}$/)) {
      const ms = Math.round(performance.now() - start)
      console.log(`%c[API] %c${method} ${path} %cERROR %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', err.message)
    }
    throw err
  }
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: any) => req<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => req<T>('PUT', p, b),
  del: <T = any>(p: string) => req<T>('DELETE', p),
}

export const dramaAPI = {
  list: () => api.get<{ items: any[] }>('/dramas'),
  get: (id: number) => api.get(`/dramas/${id}`),
  create: (data: any) => api.post('/dramas', data),
  update: (id: number, data: any) => api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
}

export const episodeAPI = {
  create: (data: any) => api.post('/episodes', data),
  update: (id: number, data: any) => api.put(`/episodes/${id}`, data),
  del: (id: number) => api.del(`/episodes/${id}`),
  characters: (id: number) => api.get(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get(`/episodes/${id}/scenes`),
  props: (id: number) => api.get(`/episodes/${id}/props`),
  storyboards: (id: number) => api.get(`/episodes/${id}/storyboards`),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
  extract: (id: number, target: string, model?: string, configId?: number) => api.post(`/episodes/${id}/extract`, { target, model: model || undefined, config_id: configId || undefined }),
  extractStatus: (id: number) => api.get(`/episodes/${id}/extract-status`),
  generateVideoPrompts: (id: number, model?: string, configId?: number, storyboardIds?: number[]) => api.post(`/episodes/${id}/generate-video-prompts`, { model: model || undefined, config_id: configId || undefined, storyboard_ids: storyboardIds?.length ? storyboardIds : undefined }),
  videoPromptsStatus: (id: number) => api.get(`/episodes/${id}/video-prompts-status`),
}

export const storyboardAPI = {
  create: (data: any) => api.post('/storyboards', data),
  update: (id: number, data: any) => api.put(`/storyboards/${id}`, data),
  del: (id: number) => api.del(`/storyboards/${id}`),
}

export const characterAPI = {
  create: (data: any) => api.post('/characters', data),
  update: (id: number, data: any) => api.put(`/characters/${id}`, data),
  del: (id: number) => api.del(`/characters/${id}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/characters/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/characters/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  batchImages: (ids: number[], episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post('/characters/batch-generate-images', { character_ids: ids, episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

export const sceneAPI = {
  create: (data: any) => api.post('/scenes', data),
  update: (id: number, data: any) => api.put(`/scenes/${id}`, data),
  del: (id: number) => api.del(`/scenes/${id}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/scenes/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/scenes/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

export const propAPI = {
  create: (data: any) => api.post('/props', data),
  update: (id: number, data: any) => api.put(`/props/${id}`, data),
  del: (id: number) => api.del(`/props/${id}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/props/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/props/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

// 统一生成任务（图片/视频）：POST 带 type 字段，列表支持筛选/搜索/分页/状态统计
export const taskAPI = {
  generate: (d: any) => api.post('/tasks', d),
  get: (id: number) => api.get(`/tasks/${id}`),
  del: (id: number) => api.del(`/tasks/${id}`),
  cancel: (id: number) => api.post(`/tasks/${id}/cancel`),
  retry: (id: number) => api.post(`/tasks/${id}/retry`),
  refresh: (id: number) => api.post<{ task: any; outcome: string }>(`/tasks/${id}/refresh`),
  batchDelete: (ids: number[]) => api.post<{ deleted: number; skipped: number }>('/tasks/batch-delete', { ids }),
  clear: (scope: 'completed' | 'failed' | 'cancelled' | 'finished' = 'finished') =>
    api.post<{ deleted: number }>('/tasks/clear', { scope }),
  list: (params?: { type?: 'image' | 'video'; status?: string; drama_id?: number; storyboard_id?: number; keyword?: string; page?: number; page_size?: number }) => {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    if (params?.status) query.set('status', params.status)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    if (params?.keyword) query.set('keyword', params.keyword)
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    return api.get(`/tasks${query.size ? `?${query.toString()}` : ''}`)
  },
  // 按集聚合生成任务（sys_task + video_merges）
  listByEpisode: (episodeId: number) => api.get<{ tasks: any[]; merges: any[] }>(`/episodes/${episodeId}/generation-tasks`),
}

async function uploadReq<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  console.log(`%c[API] %cPOST %c${path} %c${file.name}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', 'color:#888')
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', body: fd })
  const json = await resp.json()
  if (!resp.ok || (json.code && json.code >= 400)) {
    console.log(`%c[API] %cPOST ${path} %c${resp.status}`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold')
    throw new Error(json.message || `${resp.status}`)
  }
  return json.data ?? json
}

export const uploadAPI = {
  image: (f: File) => uploadReq<{ url: string; path: string }>('/upload/image', f),
  video: (f: File) => uploadLargeMedia(f, 'video'),
  audio: (f: File) => uploadLargeMedia(f, 'audio'),
}

// ─── 部署形态能力协商（GET /capabilities，单例缓存） ────────────────
export interface Capabilities {
  mode: 'server' | 'serverless'
  /** server → 服务端 FFmpeg 拼接；none → serverless 不可用（引导桌面/服务器版） */
  merge: 'server' | 'none'
  /** serverless 无 ffmpeg 海报帧 */
  poster: boolean
  /** blob → 视频/音频走 Blob 直传（Vercel 函数 4.5MB 请求体限制） */
  storage: 'local' | 'blob'
  taskDriver: string
  serverUpdate: boolean
}

let _capsPromise: Promise<Capabilities> | null = null

export function loadCapabilities(): Promise<Capabilities> {
  if (!_capsPromise) {
    _capsPromise = api.get<Capabilities>('/capabilities').catch(() => ({
      // 后端不可达/旧版本：按完整能力兜底（本地形态默认值）
      mode: 'server', merge: 'server', poster: true, storage: 'local', taskDriver: 'inline', serverUpdate: true,
    }))
  }
  return _capsPromise
}

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac'])

/**
 * 视频/音频上传：blob 形态走 Vercel Blob 客户端直传（大文件超函数请求体限制），
 * 本地形态维持 multipart 走服务端。返回形态与 multipart 端点一致（规范相对路径）。
 */
async function uploadLargeMedia(file: File, kind: 'video' | 'audio'): Promise<{ url: string; path: string }> {
  const caps = await loadCapabilities()
  const ext = (() => {
    const i = file.name.lastIndexOf('.')
    return i >= 0 ? file.name.slice(i).toLowerCase() : ''
  })()
  const allowed = kind === 'video' ? VIDEO_EXT : AUDIO_EXT
  if (!allowed.has(ext)) {
    throw new Error(`仅支持 ${Array.from(allowed).join('/')} 格式的${kind === 'video' ? '视频' : '音频'}文件`)
  }
  if (caps.storage !== 'blob') return uploadReq(`/upload/${kind}`, file)

  const pathname = `static/uploads/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`
  const { upload } = await import('@vercel/blob/client')
  const blob = await upload(pathname, file, {
    handleUploadUrl: '/api/v1/upload/direct',
    access: 'public',
  })
  return { url: `/${blob.pathname}`, path: blob.pathname }
}
export const mergeAPI = {
  merge: (epId: number, storyboardIds?: number[]) => api.post(`/merge/episodes/${epId}/merge`, storyboardIds?.length ? { storyboard_ids: storyboardIds } : {}),
  status: (epId: number) => api.get(`/merge/episodes/${epId}/merge`),
  list: (epId: number) => api.get<any[]>(`/merge/episodes/${epId}/merges`),
}
export const aiConfigAPI = {
  list: (t?: string) => api.get(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: any) => api.post('/ai-configs', d),
  update: (id: number, d: any) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: any) => api.post('/ai-configs/test', d),
  // 拉取远端模型列表（openai/gemini/volcengine 协议支持）
  models: (d: any) => api.post('/ai-configs/models', d),
}

// 厂商/协议目录（后端统一下发，模板与协议下拉的唯一数据源）
export const aiProvidersAPI = {
  catalog: () => api.get<{ protocols: Record<string, { value: string; label: string }[]>; vendors: any[] }>('/ai-providers'),
}

// lang 缺省/为 zh 时读写基础版（不带 query，保持原请求形态）
const langQ = (lang?: string) => (lang && lang !== 'zh' ? `?lang=${lang}` : '')

export const promptAPI = {
  list: () => api.get('/prompts'),
  get: (type: string, lang?: string) => api.get(`/prompts/${type}${langQ(lang)}`),
  update: (type: string, d: any, lang?: string) => api.put(`/prompts/${type}${langQ(lang)}`, d),
  reset: (type: string, lang?: string) => api.post(`/prompts/${type}/reset${langQ(lang)}`),
}

export const skillsAPI = {
  list: (lang?: string) => api.get(`/skills${langQ(lang)}`),
  get: (id: string, lang?: string) => api.get(`/skills/${id}${langQ(lang)}`),
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string, lang?: string) => api.put(`/skills/${id}${langQ(lang)}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const stylePresetAPI = {
  list: (all = false) => api.get(`/style-presets${all ? '?all=1' : ''}`),
  create: (d: any) => api.post('/style-presets', d),
  update: (id: number, d: any) => api.put(`/style-presets/${id}`, d),
  del: (id: number) => api.del(`/style-presets/${id}`),
}

export const storageAPI = {
  info: () => api.get('/storage'),
}

// 访问密码（远程访问口令）：登录种 httpOnly cookie，之后同源请求自动携带
export const accessAPI = {
  status: () => api.get<{ required: boolean; authed: boolean }>('/access/status'),
  login: (password: string) => api.post<{ token: string | null }>('/access/login', { password }),
  logout: () => api.post('/access/logout'),
  setPassword: (password: string) => api.put<{ token: string | null }>('/access/password', { password }),
}

export const settingsAPI = {
  contentLanguage: () => api.get<{ language: string }>('/settings/content-language'),
  setContentLanguage: (language: string) => api.put('/settings/content-language', { language }),
  /** 公网媒体地址（内网穿透 / 反代出口），URL-only 协议（Agnes）用它回源本地媒体 */
  publicMediaBaseUrl: () => api.get<{ url: string | null, fromEnv: boolean }>('/settings/public-media-base-url'),
  setPublicMediaBaseUrl: (url: string) => api.put<{ url: string | null }>('/settings/public-media-base-url', { url }),
}

// 服务器/Docker 部署的版本检查与更新（桌面版走 useDesktopBridge，不用此 API）
export const serverUpdateAPI = {
  state: () => api.get('/server-update/state'),
  check: () => api.post('/server-update/check'),
  apply: () => api.post('/server-update/apply'),
}
