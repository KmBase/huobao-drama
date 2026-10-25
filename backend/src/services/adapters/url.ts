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
 * 背景：本协议簇按 public-url 传输形态工作——本地素材先经隧道 / 反代解析为公网地址再提交。
 * 实测 Agnes 视频 / 图片提交端也能接受 Base64 Data URI（2026-10 验证），但为保持单一传输
 * 形态、避免多图叠加出超大请求体，这里仍拦下 data: 形态并提示走公网地址。
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
