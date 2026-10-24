export function joinProviderUrl(baseUrl: string, requiredPrefix: string, path: string) {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '')
  const normalizedPrefix = normalizeSegment(requiredPrefix)
  const normalizedPath = normalizeSegment(path)

  if (!normalizedBase) {
    return `${normalizedPrefix}${normalizedPath}`
  }

  try {
    const url = new URL(normalizedBase)
    const currentPath = url.pathname.replace(/\/+$/, '')
    const mergedPrefix = currentPath.endsWith(normalizedPrefix)
      ? currentPath
      : `${currentPath}${normalizedPrefix}`

    url.pathname = `${mergedPrefix}${normalizedPath}`.replace(/\/{2,}/g, '/')
    return url.toString()
  } catch {
    const basePath = normalizedBase.endsWith(normalizedPrefix)
      ? normalizedBase
      : `${normalizedBase}${normalizedPrefix}`
    return `${basePath}${normalizedPath}`
  }
}

function normalizeSegment(segment: string) {
  if (!segment) return ''
  return segment.startsWith('/') ? segment : `/${segment}`
}

/**
 * URL-only 协议的媒体参数校验：只接受 http(s) 绝对地址。
 *
 * 背景：Agnes 全系（图片参考、视频首尾帧、参考图、参考音频）都只收"可由其服务公开访问"
 * 的 URL，官方文档明确不接受 Base64 Data URI。提前拦下可以避免白跑一次计费调用。
 *
 * @param value 待校验值（空值跳过）
 * @param label 报错用的中文参数名，如「首帧图片」「参考图片」
 */
export function assertPublicHttpUrl(value: string | null | undefined, label: string): void {
  const raw = String(value || '').trim()
  if (!raw) return
  if (/^https?:\/\//i.test(raw)) return
  const hint = raw.startsWith('data:')
    ? '当前是 Base64 内联数据，该接口不接受'
    : raw.startsWith('static/') || raw.startsWith('/static/')
      ? '当前是本地文件路径，上游无法回源'
      : '当前不是公网地址'
  throw new Error(
    `${label}必须是公网可访问的 http(s) URL（${hint}）。` +
    '请在「设置 → 公网访问」开启内网穿透或填写公网媒体地址后重试。',
  )
}

/** 批量校验（数组参数） */
export function assertPublicHttpUrls(values: string[] | null | undefined, label: string): void {
  for (const value of values || []) assertPublicHttpUrl(value, label)
}
