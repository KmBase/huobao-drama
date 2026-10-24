import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const routeBlock = (source, route) => {
  const start = source.indexOf(route)
  assert.notEqual(start, -1, `Missing route: ${route}`)
  const next = source.indexOf('\n// ', start + route.length)
  return source.slice(start, next === -1 ? source.length : next)
}

test('backend provider registry does not expose ChatFire as a model provider', () => {
  const registry = read('src/services/adapters/registry.ts')
  const ai = read('src/services/ai.ts')
  const aiConfigRoute = read('src/routes/aiConfigs.ts')
  const catalog = read('src/services/provider-catalog.ts')
  const useApi = read('../frontend/app/composables/useApi.ts')

  assert.doesNotMatch(registry, /chatfire/i)
  assert.doesNotMatch(ai, /chatfire/i)
  assert.doesNotMatch(ai, /openrouter/i)
  assert.doesNotMatch(catalog, /chatfire/i)
  assert.doesNotMatch(catalog, /api\.firemux\.com/i)
  assert.doesNotMatch(aiConfigRoute, /api\.firemux\.com/i)
  assert.doesNotMatch(aiConfigRoute, /provider:\s*'chatfire'/i)
  assert.doesNotMatch(aiConfigRoute, /openrouter/i)
  assert.doesNotMatch(aiConfigRoute, /\/huobao-preset/)
  assert.doesNotMatch(useApi, /huobaoPreset/)
})

test('text agents use the official Gemini SDK based on protocol, not vendor id', () => {
  const agents = read('src/agents/index.ts')

  assert.match(agents, /createGoogleGenerativeAI/)
  assert.match(agents, /const protocolName = \(textConfig\.protocol \|\| textConfig\.provider\)\.toLowerCase\(\)/)
  assert.match(agents, /if \(protocolName === 'gemini'\)/)
  assert.match(agents, /googleProvider\(\s*modelName\s*\)/)
  assert.doesNotMatch(agents, /providerName === 'gemini'\)\s*\{\s*\n\s*const googleProvider/)
})

test('text agents keep OpenAI-compatible routing for non-Gemini protocols', () => {
  const agents = read('src/agents/index.ts')

  assert.match(agents, /createOpenAI/)
  assert.match(agents, /const provider = createOpenAI\(/)
  assert.match(agents, /return provider\.chat\(modelName\)/)
})

test('text provider base URL handling is driven by protocol', () => {
  const ai = read('src/services/ai.ts')

  assert.match(ai, /const protocol = \(config\.protocol \|\| config\.provider\)\.toLowerCase\(\)/)
  assert.match(ai, /protocol === 'openai'/)
  assert.match(ai, /protocol === 'gemini'/)
  assert.match(ai, /return joinProviderUrl\(config\.baseUrl,\s*'\/v1beta',\s*''\)/)
  assert.match(ai, /return joinProviderUrl\(config\.baseUrl,\s*'\/api\/v3',\s*''\)/)
})

test('backend enforces the protocol registry at DB and route boundaries', () => {
  const ai = read('src/services/ai.ts')
  const route = read('src/routes/aiConfigs.ts')

  assert.match(ai, /protocolRegistry/)
  assert.match(ai, /text:\s*\[\s*'openai',\s*'gemini',\s*'volcengine'\s*\]/)
  assert.match(ai, /image:\s*\[\s*'openai',\s*'gemini',\s*'volcengine',\s*'agnes'\s*\]/)
  assert.match(ai, /video:\s*\[\s*'volcengine',\s*'minimax',\s*'aliyun',\s*'agnes'\s*\]/)
  // 厂商 id 已解绑，协议白名单内不再出现具体中转站/厂商品牌
  assert.doesNotMatch(ai, /'deepseek'/)
  assert.doesNotMatch(ai, /'openrouter'/)
  assert.doesNotMatch(ai, /audio:\s*\[/)
  assert.match(ai, /export function isKnownProtocol/)
  assert.match(ai, /export function resolveProtocol/)
  assert.match(ai, /isKnownProtocol\(serviceType, resolveProtocol\(r\.protocol, r\.provider\)\)/)
  assert.match(ai, /isKnownProtocol\(row\.serviceType, protocol\)/)

  assert.match(route, /isKnownProtocol/)
  assert.match(route, /isKnownProtocol\(body\.service_type, body\.protocol\)/)
  assert.match(route, /isKnownProtocol\(serviceType, protocol\)/)
})

test('AI config routes reject unsupported service/protocol pairs in create, test, and update paths', () => {
  const route = read('src/routes/aiConfigs.ts')
  const createRoute = routeBlock(route, "app.post('/',")
  const testRoute = routeBlock(route, "app.post('/test',")
  const updateRoute = routeBlock(route, "app.put('/:id',")

  assert.match(createRoute, /if \(!body\.service_type \|\| !body\.protocol\)/)
  assert.match(createRoute, /isKnownProtocol\(body\.service_type, body\.protocol\)/)
  assert.match(createRoute, /不支持的 protocol/)

  assert.match(testRoute, /if \(!body\.service_type \|\| !body\.protocol \|\| !body\.base_url\)/)
  assert.match(testRoute, /isKnownProtocol\(body\.service_type, body\.protocol\)/)
  assert.match(testRoute, /不支持的 protocol/)

  assert.match(updateRoute, /const serviceType = 'service_type' in body \? body\.service_type : existing\.serviceType/)
  assert.match(updateRoute, /resolveProtocol\(existing\.protocol, existing\.provider\)/)
  assert.doesNotMatch(updateRoute, /body\.service_type \|\| existing\.serviceType/)
  assert.match(updateRoute, /isKnownProtocol\(serviceType, protocol\)/)
  assert.match(updateRoute, /不支持的 protocol/)
})

test('AI config update route persists protocol and service type changes after validation', () => {
  const route = read('src/routes/aiConfigs.ts')
  const updateRoute = routeBlock(route, "app.put('/:id',")

  assert.match(updateRoute, /const updates: Record<string, any> = \{ updatedAt: now\(\) \}/)
  assert.match(updateRoute, /if \('service_type' in body\) updates\.serviceType = body\.service_type/)
  assert.match(updateRoute, /if \('provider' in body\) updates\.provider = body\.provider/)
  assert.match(updateRoute, /updates\.protocol = protocol/)
})

test('AI config probe uses protocol-specific auth schemes', () => {
  const route = read('src/routes/aiConfigs.ts')
  const geminiHeadersStart = route.indexOf('function geminiHeaders')
  const buildProbeStart = route.indexOf('function buildProbe')
  const geminiHeaders = route.slice(geminiHeadersStart, buildProbeStart)

  assert.match(geminiHeaders, /x-goog-api-key/)
  assert.doesNotMatch(geminiHeaders, /Authorization\s*=\s*`Bearer/)
  assert.match(route, /\/models\/\$\{modelName\}:generateContent/)
  assert.match(route, /url\.searchParams\.set\('key', apiKey\)/)
  assert.match(route, /function bearerHeaders/)
  assert.match(route, /p === 'openai'/)
  assert.match(route, /p === 'volcengine'/)
  assert.match(route, /p === 'minimax'/)
  assert.match(route, /p === 'aliyun'/)
  assert.match(route, /p === 'agnes'/)
  assert.match(route, /X-DashScope-Async': 'enable'/)
  assert.match(route, /\/services\/aigc\/video-generation\/video-synthesis/)
  assert.match(route, /'\/chat\/completions'/)
  assert.doesNotMatch(route, /viduHeaders/)
  assert.doesNotMatch(route, /p === 'deepseek'/)
  assert.doesNotMatch(route, /p === 'ali'/)
  assert.doesNotMatch(route, /p === 'vidu'/)
})

test('remote model listing is protocol-gated and never echoes the api key', () => {
  const route = read('src/routes/aiConfigs.ts')
  const modelsRoute = routeBlock(route, "app.post('/models',")

  assert.match(route, /const MODEL_LIST_PROTOCOLS = \['openai', 'gemini', 'volcengine'\]/)
  assert.match(modelsRoute, /MODEL_LIST_PROTOCOLS\.includes\(protocol\)/)
  assert.match(modelsRoute, /该协议不支持在线获取模型列表，请手动填写模型名/)
  assert.match(modelsRoute, /m\.replace\(\/\^models\\\/\/, ''\)/)
  assert.match(modelsRoute, /AbortSignal\.timeout\(20000\)/)
  assert.match(modelsRoute, /redactUrl\(url\)/)
})

test('provider catalog ships Agnes presets and no bundled gateway URLs', () => {
  const catalog = read('src/services/provider-catalog.ts')
  const route = read('src/routes/aiConfigs.ts')

  assert.match(catalog, /id: 'agnes'/)
  assert.match(catalog, /https:\/\/api\.agnes-ai\.cn/)
  assert.match(catalog, /'agnes-3\.0-flash'/)
  assert.match(catalog, /'agnes-image-2\.5-flash'/)
  assert.match(catalog, /'agnes-video-2\.5-flash'/)
  assert.match(catalog, /protocols: \{ text: 'openai', image: 'agnes', video: 'agnes' \}/)
  assert.match(catalog, /export const quickConfigs/)
  assert.match(route, /vendorsFor\('text'\)/)
  assert.match(route, /vendorList/)
})

test('removed providers no longer ship adapters or webhook routes', () => {
  const registry = read('src/services/adapters/registry.ts')
  const index = read('src/index.ts')

  assert.doesNotMatch(registry, /ali-image|ali-video|vidu-video/)
  assert.doesNotMatch(registry, /AliImageAdapter|AliVideoAdapter|ViduVideoAdapter/)
  assert.doesNotMatch(index, /webhooks/)
})

test('adapter registry fails closed for unsupported protocols', () => {
  const registry = read('src/services/adapters/registry.ts')

  assert.match(registry, /不支持的图片协议/)
  assert.match(registry, /不支持的视频协议/)
  assert.match(registry, /agnes: new AgnesImageAdapter\(\)/)
  assert.match(registry, /agnes: new AgnesVideoAdapter\(\)/)
  assert.doesNotMatch(registry, /\|\|\s*imageAdapters\['minimax'\]/)
  assert.doesNotMatch(registry, /\|\|\s*videoAdapters\['minimax'\]/)
  assert.doesNotMatch(registry, /ttsAdapters/)
})

test('media generation resolves adapters by protocol', () => {
  const generation = read('src/services/generation.ts')

  assert.match(generation, /getImageAdapter\(config\.protocol\)/)
  assert.match(generation, /getVideoAdapter\(config\.protocol\)/)
  assert.doesNotMatch(generation, /getImageAdapter\(config\.provider\)/)
  assert.doesNotMatch(generation, /getVideoAdapter\(config\.provider\)/)
})

test('OpenAI image adapter defaults to GPT Image instead of legacy DALL-E', () => {
  const adapter = read('src/services/adapters/openai-image.ts')

  assert.match(adapter, /record\.model\s*\|\|\s*config\.model\s*\|\|\s*'gpt-image-2'/)
  assert.doesNotMatch(adapter, /record\.model\s*\|\|\s*'dall-e-3'/)
})

test('OpenAI image adapter uses GPT Image request shape and keeps DALL-E response format', () => {
  const adapter = read('src/services/adapters/openai-image.ts')

  assert.match(adapter, /model\.startsWith\('gpt-image-'\)/)
  assert.match(adapter, /normalizeGptImageSize/)
  assert.match(adapter, /'1536x1024'/)
  assert.match(adapter, /'1024x1536'/)
  assert.match(adapter, /'1024x1024'/)
  assert.match(adapter, /'auto'/)
  assert.match(adapter, /if \(!isGptImage\)[\s\S]*response_format = 'url'/)
})

test('new image and video models use their current API shapes', () => {
  const openaiImage = read('src/services/adapters/openai-image.ts')
  const geminiImage = read('src/services/adapters/gemini-image.ts')
  const volcVideo = read('src/services/adapters/volcengine-video.ts')
  const wanVideo = read('src/services/adapters/aliyun-wan-video.ts')

  assert.match(openaiImage, /isGptImage2/)
  assert.match(openaiImage, /normalizeGptImage2Size/)
  assert.match(geminiImage, /isGemini3Image/)
  assert.match(geminiImage, /\/v1beta'[\s\S]*'\/interactions'/)
  assert.match(geminiImage, /response_format/)
  assert.doesNotMatch(geminiImage, /Authorization': `Bearer/)
  assert.match(volcVideo, /doubao-seedance-2-0-mini-260615/)
  // Seedance 2.0 多模态能力
  assert.match(volcVideo, /SEEDANCE2_MODEL_PREFIX/)
  assert.match(volcVideo, /startsWith\(SEEDANCE2_MODEL_PREFIX\)/)
  assert.match(volcVideo, /reference_video/)
  assert.match(volcVideo, /reference_audio/)
  assert.match(volcVideo, /generate_audio:\s*record\.generateAudio/)
  // Wan 3.0 使用阿里云百炼官方异步视频生成协议
  assert.match(wanVideo, /wan3\.0-video-prime/)
  assert.match(wanVideo, /wan3\.0-video/)
  assert.match(wanVideo, /\/services\/aigc\/video-generation\/video-synthesis/)
  assert.match(wanVideo, /X-DashScope-Async': 'enable'/)
  assert.match(wanVideo, /body:\s*\{ model, input, parameters \}/)
  assert.match(wanVideo, /\/tasks\/\$\{encodeURIComponent\(taskId\)\}/)
  assert.match(wanVideo, /output\.task_status/)
  assert.match(wanVideo, /output_video_duration/)
})

test('Agnes adapters follow the documented 2.5 Flash API', () => {
  const image = read('src/services/adapters/agnes-image.ts')
  const video = read('src/services/adapters/agnes-video.ts')

  // 图片：同步 /v1/images/generations，size 档位 + ratio，参考图走 extra_body.image
  assert.match(image, /'\/v1\/images\/generations'/)
  assert.match(image, /const MAX_REFERENCE_IMAGES = 6/)
  assert.match(image, /function sizeTier/)
  assert.match(image, /'4K'[\s\S]*'3K'[\s\S]*'2K'[\s\S]*'1K'/)
  assert.match(image, /extra_body: extraBody/)
  assert.match(image, /response_format: 'url'/)

  // 视频：异步提交 /v1/videos + /agnesapi 轮询，mode 三态与 720P 固定档位
  assert.match(video, /'\/v1\/videos'/)
  assert.match(video, /'\/agnesapi'/)
  assert.match(video, /url\.searchParams\.set\('video_id', videoId\)/)
  assert.match(video, /url\.searchParams\.set\('model_name', modelName \|\| config\.model \|\| DEFAULT_MODEL\)/)
  assert.match(video, /type GenMode = 'text' \| 'keyframe' \| 'reference'/)
  assert.match(video, /body\.first_frame = firstFrame/)
  assert.match(video, /body\.last_frame = lastFrame/)
  assert.match(video, /body\.images = refImages/)
  assert.match(video, /body\.audios = refAudios/)
  assert.match(video, /const SIZE = '720P'/)
  assert.match(video, /const SECONDS_MIN = 4/)
  assert.match(video, /const SECONDS_MAX = 12/)
  assert.match(video, /不支持视频参考素材/)
  assert.match(video, /result\.metadata\?\.url/)
})

test('OpenAI-compatible image adapters parse sync payload before async task id', () => {
  // 回归：Agnes 等兼容网关同步返回 { data: [{ url }], task_id }，task_id 只是响应标识。
  // 若先判 task_id，同步结果会被误判成异步任务，去轮询不存在的端点直到 10 分钟超时
  const openai = read('src/services/adapters/openai-image.ts')
  const volc = read('src/services/adapters/volcengine-image.ts')

  for (const src of [openai, volc]) {
    const urlIdx = src.indexOf('result.data?.[0]?.url')
    const taskIdx = src.indexOf('result.task_id || result.id')
    assert.notEqual(urlIdx, -1, 'missing sync payload read')
    assert.notEqual(taskIdx, -1, 'missing async task fallback')
    assert.ok(urlIdx < taskIdx, 'sync payload must be checked before task_id/id')
  }
})

test('generation polling fails fast on a dead task endpoint', () => {
  const gen = read('src/services/generation.ts')
  assert.match(gen, /notFoundStreak/)
  assert.match(gen, /notFoundStreak >= 12/)
  assert.match(gen, /轮询端点 404，上游任务无法查询/)
})
