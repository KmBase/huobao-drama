/**
 * AI 服务配置 → 可选模型下拉项（项目配置弹窗与剧集工作台共用）
 * 选中值使用 'provider/model' 复合键：同名模型可能来自不同厂商（如中转站与官方），必须区分
 */

export function configModels(cfg) {
  const raw = cfg?.model
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try { const m = JSON.parse(raw); return Array.isArray(m) ? m.filter(Boolean) : [m].filter(Boolean) } catch { return [raw].filter(Boolean) }
}

/** 汇总该类型全部启用配置的模型（按 厂商+模型 去重，按优先级排序），选中模型时连同所属配置一起调用 */
export function collectModelOptions(cfgs) {
  const seen = new Set()
  const out = []
  const sorted = [...cfgs].filter(c => c.is_active).sort((a, b) => (b.priority || 0) - (a.priority || 0))
  for (const c of sorted) {
    for (const m of configModels(c)) {
      const key = `${c.provider}/${m}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, model: m, provider: c.provider, configId: c.id, configName: c.name || c.provider })
    }
  }
  return out
}

/** 复合键 → 裸模型名（后端适配器按厂商校验模型名，不能带 provider 前缀） */
export function bareModelName(key) {
  if (!key) return ''
  const i = key.indexOf('/')
  return i >= 0 ? key.slice(i + 1) : key
}

/** 复合键 → 所属配置 id（生成请求与模型一起提交） */
export function ownerConfigId(options, key) {
  return key ? (options.find(o => o.key === key)?.configId || undefined) : undefined
}

/** 该类型的启用配置是否来自多个配置（决定下拉项要不要带配置名前缀） */
export function hasMultiConfigs(options) {
  return new Set(options.map(o => o.configId)).size > 1
}

/** 下拉项展示文案：多配置时带配置名前缀，单配置只显示模型名 */
export function modelOptionLabel(option, multi) {
  return multi ? `${option.configName} · ${option.model}` : option.model
}
