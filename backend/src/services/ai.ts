/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 *
 * 厂商（provider）与协议（protocol）解耦：
 * - provider：厂商标识，自由填写（openai / gemini / agnes / deepseek / 自定义…），仅用于展示、图标与日志
 * - protocol：接口协议（URL 拼接、探针、适配器选择），按 service_type 白名单校验
 *   text:  openai | gemini | volcengine
 *   image: openai | gemini | volcengine | agnes
 *   video: volcengine | minimax | aliyun | agnes
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

export type ServiceType = 'text' | 'image' | 'video'

export interface AIConfig {
  /** 配置行 id（ai_service_configs），sweep 续跑时由 params.__configId 还原配置 */
  id: number
  /** 厂商标识（展示用，不参与协议判定） */
  provider: string
  /** 接口协议，决定 URL 拼接 / 探针 / 适配器 */
  protocol: string
  baseUrl: string
  apiKey: string
  model: string
  /** 采样温度，null 表示不设置（跟随服务商默认）。存于 ai_service_configs.settings JSON */
  temperature?: number | null
}

/** 每种服务类型可用的协议族 */
export const protocolRegistry: Record<ServiceType, readonly string[]> = {
  text: ['openai', 'gemini', 'volcengine'],
  image: ['openai', 'gemini', 'volcengine', 'agnes'],
  video: ['volcengine', 'minimax', 'aliyun', 'agnes'],
}

const ALL_PROTOCOLS = new Set(Object.values(protocolRegistry).flat())

/** 协议标签（设置页协议下拉与提示用，随 /ai-providers 下发） */
export const PROTOCOL_LABELS: Record<string, string> = {
  openai: 'OpenAI 兼容',
  gemini: 'Gemini 原生',
  volcengine: '火山方舟',
  minimax: 'MiniMax',
  aliyun: '阿里百炼',
  agnes: 'Agnes',
}

/** 从 settings JSON 解析 temperature；非法值一律视为未设置 */
export function parseConfigTemperature(settingsRaw: string | null | undefined): number | null {
  if (!settingsRaw) return null
  try {
    const t = JSON.parse(settingsRaw)?.temperature
    return typeof t === 'number' && Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}

/**
 * 解析配置的协议：优先用 protocol 列；旧数据（升级前创建）没有该列值时，
 * 按 provider 反推（历史上厂商 id 与协议 id 同名）。都推不出来时返回 provider，
 * 由 isKnownProtocol 判定为不支持并跳过（fail closed，不静默猜协议）。
 */
export function resolveProtocol(
  protocol?: string | null,
  provider?: string | null,
): string {
  const p = String(protocol || '').trim().toLowerCase()
  if (ALL_PROTOCOLS.has(p)) return p
  const v = String(provider || '').trim().toLowerCase()
  // 推不出来就原样返回 provider：由 isKnownProtocol 判定为未知协议并跳过（fail closed）
  return v
}

export function isKnownProtocol(serviceType: ServiceType | string, protocol?: string | null): boolean {
  const providers = protocolRegistry[serviceType as ServiceType]
  return !!providers && providers.includes((protocol || '').toLowerCase())
}

/** 某服务类型支持的协议列表（设置页协议下拉数据源） */
export function protocolsFor(serviceType: ServiceType | string): string[] {
  const providers = protocolRegistry[serviceType as ServiceType]
  return providers ? [...providers] : []
}

/** 文本协议对应的请求根路径拼接规则（各协议的服务端前缀差异） */
export function getTextProviderBaseUrl(config: AIConfig) {
  const protocol = (config.protocol || config.provider).toLowerCase()

  if (protocol === 'openai') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (protocol === 'gemini') {
    return joinProviderUrl(config.baseUrl, '/v1beta', '')
  }

  if (protocol === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  return config.baseUrl
}

// Agent 多步循环会逐步重复解析同一配置，相同配置只打一次日志避免刷屏
const lastLoggedActiveConfigKey = new Map<string, string>()
const lastLoggedConfigByIdKey = new Map<number, string>()

function configKey(serviceType: ServiceType | string, configId: number, provider: string | null | undefined, protocol: string, model: string) {
  return `${serviceType}:${configId}:${protocol || provider || ''}:${model}`
}

export async function getActiveConfig(serviceType: ServiceType): Promise<AIConfig | null> {
  const rows = (await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  )
    .filter(r => {
      if (!r.isActive) return false
      // 协议非法（如升级中途、协议族不匹配）的配置不参与兜底，避免生成任务指向跑不通的端点
      if (!isKnownProtocol(serviceType, resolveProtocol(r.protocol, r.provider))) {
        logTaskWarn('AIConfig', 'active-config-skipped', {
          configId: r.id,
          serviceType,
          protocol: r.protocol,
          provider: r.provider,
        })
        return false
      }
      return true
    })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)) // 高优先级优先

  const active = rows[0]
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  const protocol = resolveProtocol(active.protocol, active.provider)
  const logKey = configKey(serviceType, active.id, active.provider, protocol, models[0] || '')
  if (lastLoggedActiveConfigKey.get(serviceType) !== logKey) {
    lastLoggedActiveConfigKey.set(serviceType, logKey)
    logTaskProgress('AIConfig', 'active-config-selected', {
      serviceType,
      configId: active.id,
      provider: active.provider,
      protocol,
      model: models[0] || '',
      priority: active.priority,
    })
  }
  return {
    id: active.id,
    provider: active.provider || '',
    protocol,
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
    temperature: parseConfigTemperature(active.settings),
  }
}

export async function getTextConfig(): Promise<AIConfig> {
  const config = await getActiveConfig('text')
  if (!config) throw new Error('未配置文本模型，请先到「设置」页添加并启用 AI 服务')
  return config
}

/**
 * 取某服务类型当前启用且优先级最高的配置 ID（创建集时自动锁定用）
 */
export async function getActiveConfigId(serviceType: ServiceType): Promise<number | null> {
  const rows = (await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
  )
    .filter(r => r.isActive && isKnownProtocol(serviceType, resolveProtocol(r.protocol, r.provider)))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  return rows[0]?.id ?? null
}

export async function getConfigById(id: number): Promise<AIConfig | null> {
  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id))
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  const protocol = resolveProtocol(row.protocol, row.provider)
  if (!isKnownProtocol(row.serviceType, protocol)) {
    logTaskWarn('AIConfig', 'config-by-id-unsupported-protocol', {
      configId: id,
      serviceType: row.serviceType,
      protocol,
      provider: row.provider,
    })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  const logKey = configKey(row.serviceType, row.id, row.provider, protocol, models[0] || '')
  if (lastLoggedConfigByIdKey.get(id) !== logKey) {
    lastLoggedConfigByIdKey.set(id, logKey)
    logTaskProgress('AIConfig', 'config-by-id-selected', {
      configId: id,
      provider: row.provider,
      protocol,
      model: models[0] || '',
      serviceType: row.serviceType,
    })
  }
  return {
    id: row.id,
    provider: row.provider || '',
    protocol,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
    temperature: parseConfigTemperature(row.settings),
  }
}
