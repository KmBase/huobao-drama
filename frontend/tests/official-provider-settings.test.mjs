import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const useApi = readFileSync(new URL('../app/composables/useApi.ts', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('../../backend/src/services/provider-catalog.ts', import.meta.url), 'utf8')
const aiService = readFileSync(new URL('../../backend/src/services/ai.ts', import.meta.url), 'utf8')
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')

test('vendor names are free-form and the protocol drives the wire format', () => {
  // 设置页不再内置厂商白名单，模板数据全部来自后端目录
  assert.doesNotMatch(settingsPage, /const providers\s*=\s*\[/)
  assert.doesNotMatch(settingsPage, /const providerPresets\s*=\s*\{/)
  assert.doesNotMatch(settingsPage, /firemux/i)
  assert.doesNotMatch(settingsPage, /openrouter/i)
  assert.doesNotMatch(useApi, /api\.firemux\.com/i)
  assert.doesNotMatch(useApi, /firemux/i)

  // 协议白名单在 ai.ts 里，按服务类型区分
  assert.match(aiService, /text:\s*\['openai', 'gemini', 'volcengine'\]/)
  assert.match(aiService, /image:\s*\['openai', 'gemini', 'volcengine', 'agnes'\]/)
  assert.match(aiService, /video:\s*\['volcengine', 'minimax', 'aliyun', 'agnes'\]/)

  // 协议标签随目录下发，旧代码里基于 provider 名做协议判定的分支必须消失
  assert.match(aiService, /PROTOCOL_LABELS/)
  assert.doesNotMatch(aiService, /providerName\s*===\s*'gemini'/)
})

test('the backend catalog is the single source of vendor presets', () => {
  assert.match(catalog, /export const vendorPresets/)
  assert.match(catalog, /export const quickConfigs/)
  assert.match(catalog, /export function vendorsFor/)
  assert.match(catalog, /CUSTOM_VENDOR\s*=\s*'custom'/)

  // Agnes 取代旧的中转站快捷配置：文本走 OpenAI 兼容，图片/视频走 agnes 协议
  assert.match(catalog, /https:\/\/api\.agnes-ai\.cn/)
  assert.match(catalog, /id: 'agnes'/)
  assert.match(catalog, /agnes-3\.0-flash/)
  assert.match(catalog, /agnes-image-2\.5-flash/)
  assert.match(catalog, /agnes-video-2\.5-flash/)

  // 官方厂商端点保留
  assert.match(catalog, /https:\/\/api\.openai\.com/)
  assert.match(catalog, /https:\/\/generativelanguage\.googleapis\.com/)
  assert.match(catalog, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(catalog, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)

  // 已下线的厂商不再出现
  assert.doesNotMatch(catalog, /firemux/i)
  assert.doesNotMatch(catalog, /vidu/i)
})

test('the settings page consumes the provider catalog instead of hardcoded presets', () => {
  assert.match(useApi, /aiProvidersAPI/)
  assert.match(useApi, /ai-configs\/models/)
  assert.match(settingsPage, /aiProvidersAPI\.catalog/)
  assert.match(settingsPage, /catalog\.protocols/)
  assert.match(settingsPage, /catalog\.vendors/)
  assert.match(settingsPage, /vendorChips\(/)
  assert.match(settingsPage, /applyVendorPreset\(/)
  assert.match(settingsPage, /protocolOptions/)
  assert.match(settingsPage, /protocolLabel\(/)
  assert.match(settingsPage, /startAddCfg\(/)
  assert.match(settingsPage, /moveCfg\(/)
  assert.match(settingsPage, /fetchRemoteModels\(/)
  assert.match(settingsPage, /canListModels/)
})

test('every service type exposes protocol selection, model fetching and priority ordering', () => {
  // 协议下拉按服务类型取可选协议
  assert.match(settingsPage, /:options="protocolOptions"/)
  // 在线获取模型只在支持列表拉取的协议上可用
  assert.match(settingsPage, /catalog\.modelListProtocols/)
  assert.match(aiConfigRoute, /MODEL_LIST_PROTOCOLS\s*=\s*\['openai', 'gemini', 'volcengine'\]/)
  // 测试按钮对所有服务类型可用（不再只限文本）
  assert.match(settingsPage, /@click="testExistingCfg\(c\)"/)
  assert.doesNotMatch(settingsPage, /v-if="st\.type === 'text'" class="btn btn-ghost btn-sm" @click="testExistingCfg/)
  // 列表内上下移动优先级
  assert.match(settingsPage, /@click="moveCfg\(st\.type, c, -1\)"/)
  assert.match(settingsPage, /@click="moveCfg\(st\.type, c, 1\)"/)
})

test('legacy rows without a protocol column fall back to the provider name', () => {
  assert.match(aiService, /export function resolveProtocol/)
  assert.match(aiService, /export function isKnownProtocol/)
  assert.match(aiService, /export function protocolsFor/)
  assert.match(aiConfigRoute, /protocol: resolveProtocol\(r\.protocol, r\.provider\)/)
  assert.match(aiConfigRoute, /protocol: String\(body\.protocol\)\.toLowerCase\(\)/)
})
