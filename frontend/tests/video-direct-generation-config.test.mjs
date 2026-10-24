import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('../../backend/src/services/provider-catalog.ts', import.meta.url), 'utf8')
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../../backend/src/services/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  assert.doesNotMatch(`${catalog}\n${volcengineAdapter}`, /doubao-seedance-1-5/)
  assert.match(catalog, /doubao-seedance-2-0-260128/)
  assert.match(catalog, /doubao-seedance-2-0-fast-260128/)
  assert.match(catalog, /doubao-seedance-2-0-mini-260615/)
  // 阿里云百炼视频走 Wan 3.0 官方端点
  assert.match(catalog, /wan3\.0-video/)
  assert.match(catalog, /wan3\.0-video-prime/)
})

test('video presets use official provider endpoints', () => {
  assert.doesNotMatch(catalog, /firemux/i)
  assert.match(catalog, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(catalog, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)
  assert.doesNotMatch(catalog, /https:\/\/api\.vidu\.com/)
})

test('the Agnes quick config replaces the Huobao relay preset', () => {
  assert.match(catalog, /serviceType: 'text', provider: 'agnes', protocol: 'openai'/)
  assert.match(catalog, /serviceType: 'image', provider: 'agnes', protocol: 'agnes'/)
  assert.match(catalog, /serviceType: 'video', provider: 'agnes', protocol: 'agnes'/)

  // 一键配置区只有 Agnes 三条，旧的火宝/阿里云网关中转配置必须消失
  const quickConfigs = catalog.slice(catalog.indexOf('export const quickConfigs'))
  assert.doesNotMatch(quickConfigs, /firemux/i)
  assert.doesNotMatch(quickConfigs, /aliyun/i)
  assert.match(quickConfigs, /priority: 101/)
  assert.match(quickConfigs, /priority: 100/)
  assert.match(quickConfigs, /priority: 99/)

  // 快捷配置区的入口链接指向 Agnes 平台，不再指向中转站
  assert.match(settingsPage, /platform\.agnes-ai\.cn/)
  assert.doesNotMatch(settingsPage, /firemux/i)
})

test('the settings page no longer hardcodes any vendor or model list', () => {
  assert.doesNotMatch(settingsPage, /providerPresets\s*=\s*\{/)
  assert.doesNotMatch(settingsPage, /huobaoQuickConfigs/)
  assert.doesNotMatch(settingsPage, /doubao-seedance/i)
  assert.doesNotMatch(settingsPage, /wan3\.0-video/)
  // 厂商/模型/协议数据统一由后端目录下发
  assert.match(settingsPage, /aiProvidersAPI\.catalog/)
  assert.match(aiConfigRoute, /quick_configs: quickConfigs/)
})
