import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { PROTOCOL_LABELS, isKnownProtocol, parseConfigTemperature, protocolsFor, protocolRegistry, resolveProtocol } from '../services/ai.js'
import { vendorsFor, quickConfigs } from '../services/provider-catalog.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

const SERVICE_TYPES = ['text', 'image', 'video'] as const

/** 协议族标签（随 /ai-providers 下发，设置页协议下拉直接渲染） */
const PROTOCOLS_BY_TYPE = Object.fromEntries(
  SERVICE_TYPES.map((st) => [
    st,
    protocolsFor(st).map((p) => ({ value: p, label: PROTOCOL_LABELS[p] || p })),
  ]),
)

/** 支持在线拉取模型列表的协议（openai 兼容网关 / Gemini 原生 / 火山方舟 OpenAI 兼容层） */
const MODEL_LIST_PROTOCOLS = ['openai', 'gemini', 'volcengine']

/** 归一化 temperature 入参：null=未设置；合法值 0~2；非法抛错 */
function normalizeTemperature(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('invalid temperature')
  return n
}

/** 把 settings JSON 中的 temperature 透出为顶层字段，便于前端直接读写 */
function withParsedFields(r: any) {
  return {
    ...toSnakeCase(r),
    model: r.model ? JSON.parse(r.model) : [],
    // 协议始终给出可用值（旧数据按 provider 反推），前端回写时原样带回
    protocol: resolveProtocol(r.protocol, r.provider),
    temperature: parseConfigTemperature(r.settings),
  }
}

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

/** 按协议拼接请求根路径（含各协议的固定前缀） */
function protocolPrefix(protocol: string): string {
  if (protocol === 'openai') return '/v1'
  if (protocol === 'gemini') return '/v1beta'
  if (protocol === 'volcengine') return '/api/v3'
  return ''
}

function buildProbe(serviceType: string, protocol: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = protocol.toLowerCase()

  if (p === 'gemini') {
    // 探针统一走 generateContent:文本运行时(AI SDK)走的就是它,官方与中转站都支持;
    // interactions 端点很多中转站未配置,探它会误报 500。
    // 用最小合法请求体而非空体——空体在部分中转站会触发上游认证失败的误报
    const modelName = model || 'gemini-3.1-pro-preview'
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${modelName}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return {
      method: 'POST',
      url: url.toString(),
      headers: geminiHeaders(apiKey, true),
      body: { contents: [{ parts: [{ text: 'hi' }] }] },
    }
  }

  if (p === 'openai') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : serviceType === 'text'
        ? '/chat/completions'
        : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    // MiniMax 仅提供视频服务，空请求体探测鉴权/端点连通性
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v2', '/video_generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'aliyun') {
    // Wan 3.0 仅支持异步提交；空请求体不会创建计费任务，仅用于验证地域端点与鉴权是否可达。
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      headers: {
        ...bearerHeaders(apiKey, true),
        'X-DashScope-Async': 'enable',
      },
      body: {},
    }
  }

  if (p === 'agnes') {
    // Agnes 参数校验发生在任务创建/计费之前，空体只会返回校验错误，不会产生费用
    const path = serviceType === 'video'
      ? '/v1/videos'
      : serviceType === 'image'
        ? '/v1/images/generations'
        : '/v1/chat/completions'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', model ? `/${model}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  let rows = await db.select().from(schema.aiServiceConfigs)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const parsed = rows.map(withParsedFields)
  // 统一按优先级降序返回：设置页上下移排序与默认模型判定都依赖这个顺序
  parsed.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0) || a.id - b.id)
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段：厂商自由填写，协议必须在服务类型白名单内
  if (!body.service_type || !body.protocol) {
    return badRequest(c, '需要 service_type 与 protocol')
  }
  if (!isKnownProtocol(body.service_type, body.protocol)) {
    return badRequest(c, `不支持的 protocol：${body.service_type} 仅支持 ${protocolsFor(body.service_type).join(' / ')}`)
  }

  let temperature: number | null = null
  if ('temperature' in body) {
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
  }

  const res = await db.insert(schema.aiServiceConfigs).values({
    serviceType: body.service_type,
    provider: body.provider || String(body.protocol),
    protocol: String(body.protocol).toLowerCase(),
    name: body.name || `${body.provider || body.protocol}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    settings: temperature !== null ? JSON.stringify({ temperature }) : null,
    createdAt: ts,
    updatedAt: ts,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

// POST /ai-configs/test — 连通性探针（文本/图片/视频通用）
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (!body.service_type || !body.protocol || !body.base_url) {
    return badRequest(c, '需要 service_type、protocol 与 base_url')
  }
  if (!isKnownProtocol(body.service_type, body.protocol)) {
    return badRequest(c, `不支持的 protocol：${body.service_type} 仅支持 ${protocolsFor(body.service_type).join(' / ')}`)
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probe = buildProbe(body.service_type, String(body.protocol).toLowerCase(), body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    protocol: body.protocol,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    const payload = {
      ok: resp.ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        protocol: body.protocol,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        protocol: body.protocol,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      protocol: body.protocol,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// POST /ai-configs/models — 在线拉取远端模型列表（仅 openai 兼容 / gemini / volcengine 协议）
app.post('/models', async (c) => {
  const body = await c.req.json()
  const serviceType = String(body.service_type || '')
  const protocol = String(body.protocol || '').toLowerCase()
  const baseUrl = String(body.base_url || '').trim()

  if (!isKnownProtocol(serviceType, protocol)) {
    return badRequest(c, `不支持的 protocol：${serviceType} 仅支持 ${protocolsFor(serviceType).join(' / ')}`)
  }
  if (!MODEL_LIST_PROTOCOLS.includes(protocol)) {
    return badRequest(c, '该协议不支持在线获取模型列表，请手动填写模型名')
  }
  if (!baseUrl) {
    return badRequest(c, '需要 base_url')
  }

  const url = joinProviderUrl(baseUrl, protocolPrefix(protocol), '/models')
  const logUrl = redactUrl(url)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: protocol === 'gemini' ? geminiHeaders(body.api_key) : bearerHeaders(body.api_key),
      signal: AbortSignal.timeout(20000),
    })
    const text = await resp.text()
    if (!resp.ok) {
      return success(c, {
        ok: false,
        models: [],
        status: resp.status,
        url: logUrl,
        message: `请求失败 (HTTP ${resp.status})：${text.slice(0, 160)}`,
      })
    }
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return success(c, { ok: false, models: [], url: logUrl, message: '远端返回非 JSON 响应' })
    }
    const rawModels: string[] = protocol === 'gemini'
      ? (Array.isArray(data.models) ? data.models : []).map((m: any) => String(m?.name || ''))
      : (Array.isArray(data.data) ? data.data : []).map((m: any) => String(m?.id || ''))
    const models = [...new Set(rawModels.filter(Boolean).map((m: string) => m.replace(/^models\//, '')))]
      .sort((a: string, b: string) => a.localeCompare(b))
    return success(c, { ok: true, models, count: models.length, url: logUrl })
  } catch (error: any) {
    return success(c, {
      ok: false,
      models: [],
      url: logUrl,
      message: error.message || '请求失败',
    })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!existing) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const protocol = ('protocol' in body && body.protocol)
    ? String(body.protocol).toLowerCase()
    : resolveProtocol(existing.protocol, existing.provider)
  if (!isKnownProtocol(serviceType, protocol)) {
    return badRequest(c, `不支持的 protocol：${serviceType} 仅支持 ${protocolsFor(serviceType).join(' / ')}`)
  }

  const updates: Record<string, any> = { updatedAt: now() }

  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  updates.protocol = protocol
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if ('api_key' in body) updates.apiKey = body.api_key
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active
  if ('temperature' in body) {
    let temperature: number | null
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
    // 与已有 settings 合并，清空的 temperature 从 JSON 中移除
    let settings: Record<string, any> = {}
    try { settings = existing.settings ? JSON.parse(existing.settings) : {} } catch { settings = {} }
    if (temperature === null) delete settings.temperature
    else settings.temperature = temperature
    updates.settings = Object.keys(settings).length ? JSON.stringify(settings) : null
  }

  await db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers — 厂商/协议目录（设置页模板与协议下拉的唯一数据源）
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const vendors = vendorsFor('text').concat(vendorsFor('image'), vendorsFor('video'))
  const seen = new Set<string>()
  const vendorList = vendors
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .map((v) => {
      const services: Record<string, any> = {}
      for (const st of SERVICE_TYPES) {
        // 自定义厂商不绑定固定协议/地址，由用户按服务类型自行选择
        const isCustom = v.id === 'custom'
        services[st] = isCustom
          ? { protocol: '', base_url: '', models: [], supports_models: true, protocols: PROTOCOLS_BY_TYPE[st].map((p) => p.value) }
          : v.protocols[st]
            ? {
              protocol: v.protocols[st],
              base_url: v.baseUrls[st] || '',
              models: v.models[st] || [],
              supports_models: MODEL_LIST_PROTOCOLS.includes(v.protocols[st] || ''),
            }
            : null
      }
      return { id: v.id, label: v.label, services }
    })

  return success(c, {
    protocols: PROTOCOLS_BY_TYPE,
    model_list_protocols: MODEL_LIST_PROTOCOLS,
    vendors: vendorList,
    // 一键配置预设（设置页快捷配置区直接渲染，避免前端硬编码厂商/模型）
    quick_configs: quickConfigs.map((q: any) => ({
      service_type: q.serviceType,
      provider: q.provider,
      protocol: q.protocol,
      name: q.name,
      base_url: q.baseUrl,
      model: q.model,
      priority: q.priority,
    })),
  })
})

export default app
