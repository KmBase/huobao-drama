/**
 * 风格包 AI 生成服务 — 根据一句描述为全部 agent 生成各自的风格指导
 * 用临时 Mastra Agent 实例（不进注册表），复用 getModel 链路（fetch 补丁/温度/max_tokens 全生效）
 * 只生成不落库：返回 JSON 给前端回填表单，人工确认后走常规保存
 */
import { Agent } from '@mastra/core/agent'
import { getModel } from '../agents/index.js'

export interface GeneratedStylePack {
  name: string
  episode_split_guide: string
  script_guide: string
  extractor_guide: string
  storyboard_guide: string
  prompt_guide: string
}

const AGENT_ROLES = `流水线上有五个 AI Agent，风格指导将分别注入它们的提示词：
1. episode_split_guide → 原著分集（episode_splitter）：把小说原著改编切分为多集短剧并产出改编正文
2. script_guide → 剧本改写（script_rewriter）：小说改写为格式化剧本（场景头/动作描写/对白），是叙事风格影响最大的环节
3. extractor_guide → 资产提取（extractor）：从剧本提取角色/场景/道具并去重，需要客观描述
4. storyboard_guide → 分镜拆解（storyboard_breaker）：把剧本切成 8-12 秒分镜段落并产出画面描述与视频提示词
5. prompt_guide → 提示词生成（prompt_generator）：为角色/场景/道具产出三视图、固定视角图与视频提示词`

const SYSTEM_PROMPT = `你是短剧制作的叙事风格设计师。用户给你一段风格描述，你要为一条 AI 短剧生产流水线设计完整的叙事风格包。
${AGENT_ROLES}

要求：
- 每段指导必须可执行、可度量：写"单集至少 2 个情绪爆点""单句不超过 15 字"这类硬规则，不写"节奏要快"这类空话
- 五段风格必须同源一致（同一个世界观语感），但各段只写该环节职责内的事
- episode_split_guide 写分集粒度与改编取舍倾向（什么样的情节独立成集、哪些内容可压缩/删除、钩子类型偏好）；script_guide 覆盖对白口味与剧本节奏；extractor_guide 写资产描述的取舍倾向（哪些细节要保留/避免），保持客观；storyboard_guide 写镜头密度、景别倾向、转场方式；prompt_guide 写视频画面的运动、光线、氛围倾向
- 输出严格 JSON，不要 markdown 代码块，不要多余说明文字：
{"name":"风格包名称（10 字内）","episode_split_guide":"...","script_guide":"...","extractor_guide":"...","storyboard_guide":"...","prompt_guide":"..."}`

function extractJson(raw: string): GeneratedStylePack {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON，请重试或换用更强的文本模型')
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const result: GeneratedStylePack = {
    name: str(parsed.name),
    episode_split_guide: str(parsed.episode_split_guide),
    script_guide: str(parsed.script_guide),
    extractor_guide: str(parsed.extractor_guide),
    storyboard_guide: str(parsed.storyboard_guide),
    prompt_guide: str(parsed.prompt_guide),
  }
  if (!result.name || !result.script_guide) throw new Error('生成结果缺少名称或剧本改写指导，请重试')
  return result
}

/** 生成风格包五段指导；textConfigId 缺省用当前启用的文本配置 */
export async function generateStylePack(description: string, textConfigId?: number): Promise<GeneratedStylePack> {
  const model = await getModel(undefined, undefined, textConfigId)
  const agent = new Agent({
    id: 'style-pack-generator',
    name: 'style-pack-generator',
    instructions: SYSTEM_PROMPT,
    model,
  })
  const result = await agent.generate([
    { role: 'user', content: `风格描述：${description}` },
  ] as any)
  return extractJson(result.text)
}
