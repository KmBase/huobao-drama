/**
 * AI 服务厂商预设目录 — 设置页「模板 / 厂商」下拉的唯一数据源（经 /ai-providers 下发）。
 *
 * 与 ai.ts 的 protocolRegistry 分工：
 * - protocolRegistry：协议白名单（能对接哪些协议族）
 * - vendorPresets：厂商入口（默认协议 + 推荐 Base URL + 推荐模型），厂商 id 自由填写、可自定义
 */
import type { ServiceType } from './ai.js'

export const CUSTOM_VENDOR = 'custom'

export interface VendorPreset {
  /** 写入 ai_service_configs.provider 的厂商标识（展示/图标/日志用） */
  id: string
  /** 界面显示名（与既有预设一致使用中文名） */
  label: string
  /** 各服务类型的默认 Base URL（含 {WorkspaceId} 等占位符时需用户替换） */
  baseUrls: Partial<Record<ServiceType, string>>
  /** 各服务类型使用的协议（缺省时由用户自选） */
  protocols: Partial<Record<ServiceType, string>>
  /** 各服务类型的推荐模型，首位为默认模型 */
  models: Partial<Record<ServiceType, string[]>>
}

export const vendorPresets: VendorPreset[] = [
  {
    id: 'agnes',
    label: 'Agnes',
    baseUrls: { text: 'https://api.agnes-ai.cn', image: 'https://api.agnes-ai.cn', video: 'https://api.agnes-ai.cn' },
    protocols: { text: 'openai', image: 'agnes', video: 'agnes' },
    models: {
      text: ['agnes-3.0-flash', 'agnes-2.5-flash'],
      image: ['agnes-image-2.5-flash'],
      video: ['agnes-video-2.5-flash'],
    },
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    baseUrls: { text: 'https://api.openai.com', image: 'https://api.openai.com' },
    protocols: { text: 'openai', image: 'openai' },
    models: { text: ['gpt-5.6-terra'], image: ['gpt-image-2'] },
  },
  {
    id: 'gemini',
    label: 'Gemini 官方',
    baseUrls: { text: 'https://generativelanguage.googleapis.com', image: 'https://generativelanguage.googleapis.com' },
    protocols: { text: 'gemini', image: 'gemini' },
    models: {
      text: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
      image: ['gemini-3-pro-image', 'gemini-3.1-flash-image'],
    },
  },
  {
    id: 'volcengine',
    label: '火山方舟',
    baseUrls: { text: 'https://ark.cn-beijing.volces.com', image: 'https://ark.cn-beijing.volces.com', video: 'https://ark.cn-beijing.volces.com' },
    protocols: { text: 'volcengine', image: 'volcengine', video: 'volcengine' },
    models: {
      text: [],
      image: ['doubao-seedream-5-0-260128'],
      video: ['doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-260128'],
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrls: { text: 'https://api.deepseek.com' },
    protocols: { text: 'openai' },
    models: { text: ['deepseek-chat', 'deepseek-reasoner'] },
  },
  {
    id: 'aliyun',
    label: '阿里云百炼',
    baseUrls: { text: 'https://dashscope.aliyuncs.com/compatible-mode/v1', video: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com' },
    protocols: { text: 'openai', video: 'aliyun' },
    models: { text: ['qwen-max', 'qwen-plus'], video: ['wan3.0-video', 'wan3.0-video-prime'] },
  },
  {
    id: 'minimax',
    label: 'MiniMax 官方',
    baseUrls: { video: 'https://api.minimaxi.com' },
    protocols: { video: 'minimax' },
    models: { video: ['MiniMax-H3'] },
  },
  {
    id: CUSTOM_VENDOR,
    label: '自定义',
    baseUrls: {},
    protocols: {},
    models: {},
  },
]

/** 自定义厂商条目（永远置于目录末尾，用于任意 OpenAI 兼容 / 私有网关） */
export const customVendorPreset = vendorPresets.find(v => v.id === CUSTOM_VENDOR) as VendorPreset

/** 某服务类型可选厂商：目录中声明了该协议/端点的厂商 + 自定义（顺序即展示顺序） */
export function vendorsFor(serviceType: ServiceType): VendorPreset[] {
  return vendorPresets.filter(v => v.id === CUSTOM_VENDOR || v.protocols[serviceType])
}

/** 厂商在某服务类型下的预设模型列表（无则空数组，需用户填写或在线获取） */
export function presetModels(vendorId: string, serviceType: ServiceType): string[] {
  return vendorPresets.find(v => v.id === vendorId)?.models[serviceType] ?? []
}

/** 一键配置预设（设置页顶部快捷配置区，替换旧的火宝中转配置） */
export interface QuickConfigPreset {
  serviceType: ServiceType
  provider: string
  protocol: string
  name: string
  baseUrl: string
  model: string[]
  priority: number
}

export const quickConfigs: QuickConfigPreset[] = [
  { serviceType: 'text', provider: 'agnes', protocol: 'openai', name: 'Agnes 文本服务', baseUrl: 'https://api.agnes-ai.cn', model: ['agnes-3.0-flash', 'agnes-2.5-flash'], priority: 101 },
  { serviceType: 'image', provider: 'agnes', protocol: 'agnes', name: 'Agnes 图片服务', baseUrl: 'https://api.agnes-ai.cn', model: ['agnes-image-2.5-flash'], priority: 100 },
  { serviceType: 'video', provider: 'agnes', protocol: 'agnes', name: 'Agnes 视频服务', baseUrl: 'https://api.agnes-ai.cn', model: ['agnes-video-2.5-flash'], priority: 99 },
]
