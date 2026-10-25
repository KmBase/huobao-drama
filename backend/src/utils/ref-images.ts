/**
 * 资产生图参考图列表归一化（characters / scenes / props 共用）
 * - normalizeRefImages：去空、去重、截断到 10 张（各协议适配器再做各自上限校验，如 Agnes 5 张）
 * - storedRefImages：解析资产表 reference_images 列（JSON 数组字符串），损坏时按空处理
 */

export function normalizeRefImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const s = String(item ?? '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out.slice(0, 10)
}

export function storedRefImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeRefImages(parsed) : []
  } catch {
    return []
  }
}

/** PUT 更新时把 body 里的参考图转为可入库值（数组=覆盖，空数组=清空；兼容已序列化 JSON 字符串） */
export function refImagesForUpdate(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const list = normalizeRefImages(raw)
    return list.length ? JSON.stringify(list) : null
  }
  return typeof raw === 'string' && raw ? raw : null
}
