/**
 * 技能管理路由 — 全部经 Mastra Workspace API 读写
 * 文件操作 jail 在 backend/workspace/ 目录内
 */
import { Hono } from 'hono'
import { success, badRequest } from '../utils/response.js'
import { refreshSkillWorkspaces, skillsManagerWorkspace } from '../agents/skills.js'
import { IS_SERVERLESS } from '../utils/runtime-mode.js'
import { skillOverrideKey, getOverride, setOverride, deleteOverride, listOverridesByPrefix } from '../services/workspace-overrides.js'

const app = new Hono()
const fsm = () => skillsManagerWorkspace.filesystem!
const LANGS = ['zh', 'en', 'ja', 'ko']
const normalizeLang = (v?: string) => (v && LANGS.includes(v) ? v : 'zh')
/** 技能文件路径；lang 非 zh 时为语言变体 SKILL.<lang>.md */
const skillFile = (id: string, lang?: string) => `skills/${id}/SKILL${lang && lang !== 'zh' ? `.${lang}` : ''}.md`
const SKILL_ID_SEGMENT = /^[a-z0-9-]+$/

// GET /skills?lang= — List all skills (经 workspace.skills 原生发现)
// lang 非 zh 且变体存在时，名称/描述取自语言变体 frontmatter（缺失则回退基础版）
// serverless：覆盖层技能（DB-only，无文件）一并列出
app.get('/', async (c) => {
  const lang = normalizeLang(c.req.query('lang'))
  const metas = await skillsManagerWorkspace.skills?.list() || []
  const out = []
  const seen = new Set<string>()
  for (const meta of metas) {
    const id = meta.path.replace(/^skills\//, '')
    seen.add(id)
    let name = meta.name
    let description = meta.description || ''
    if (lang !== 'zh' && await fsm().exists(skillFile(id, lang))) {
      const raw = String(await fsm().readFile(skillFile(id, lang), { encoding: 'utf-8' }))
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] || ''
      const n = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim()
      const d = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim()
      if (n) name = n
      if (d) description = d
    }
    out.push({ id, name, description })
  }
  if (IS_SERVERLESS) {
    const overrides = await listOverridesByPrefix('skill/')
    for (const [key, raw] of overrides) {
      const m = /^skill\/(.+):zh$/.exec(key)
      if (!m) continue
      const id = m[1]!
      if (seen.has(id)) continue
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] || ''
      const n = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim() || id
      const d = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim() || ''
      out.push({ id, name: n, description: d })
    }
  }
  return success(c, out)
})

// GET /skills/:id?lang= — Get skill content (raw, 含 frontmatter 供编辑)
// 覆盖层（serverless 编辑）优先于文件；lang 非 zh 时读语言变体；变体缺失回退基础版内容并标记 is_default=true
// DB-only 技能（serverless 新建）无语言变体文件，回退 zh 覆盖层
app.get('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  const lang = normalizeLang(c.req.query('lang'))
  const override = await getOverride(skillOverrideKey(id, lang))
  if (override) return success(c, { id, lang, content: override, is_default: false })
  if (!await fsm().exists(skillFile(id))) {
    // 无文件：zh 覆盖层存在即为 DB-only 技能，回退基础版内容
    const zhOverride = await getOverride(skillOverrideKey(id, 'zh'))
    if (zhOverride) return success(c, { id, lang, content: zhOverride, is_default: lang !== 'zh' })
    return badRequest(c, '技能不存在')
  }
  const variantExists = lang !== 'zh' && await fsm().exists(skillFile(id, lang))
  const content = await fsm().readFile(skillFile(id, variantExists ? lang : undefined), { encoding: 'utf-8' })
  return success(c, { id, lang, content, is_default: lang !== 'zh' && !variantExists })
})

// PUT /skills/:id?lang= — Update skill content（lang 非 zh 写语言变体；基础版变更需刷新技能缓存）
// serverless：写 workspace_overrides 覆盖层（文件系统只读）
app.put('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  const body = await c.req.json()
  const lang = normalizeLang(c.req.query('lang') ?? body.lang)
  if (IS_SERVERLESS) {
    await setOverride(skillOverrideKey(id, lang), String(body.content ?? ''))
    return success(c)
  }
  if (lang !== 'zh' && !await fsm().exists(skillFile(id))) return badRequest(c, '技能不存在')
  await fsm().writeFile(skillFile(id, lang), body.content, { recursive: true })
  // 目录 mtime 不会因文件内容编辑而更新（APFS），显式刷新技能缓存；语言变体直读无需刷新
  if (lang === 'zh') await refreshSkillWorkspaces()
  return success(c)
})

// POST /skills — Create new skill directory
app.post('/', async (c) => {
  const body = await c.req.json()
  const { id, description } = body
  if (!id) return badRequest(c, 'Skill id 必填')
  // Mastra 技能规范：frontmatter name 必须与目录名一致，且只允许小写字母/数字/连字符
  const segments = String(id).split('/')
  if (!segments.every((seg: string) => SKILL_ID_SEGMENT.test(seg))) {
    return badRequest(c, 'Skill id 每段只能包含小写字母、数字和连字符')
  }
  if (await fsm().exists(skillFile(id))) return badRequest(c, '技能已存在')
  if (IS_SERVERLESS && await getOverride(skillOverrideKey(id, 'zh'))) return badRequest(c, '技能已存在')

  const name = segments[segments.length - 1]
  const content = `---
name: ${name}
description: ${description || ''}
---

# ${name}

Write your skill content here.
`
  if (IS_SERVERLESS) {
    await setOverride(skillOverrideKey(id, 'zh'), content)
    return success(c, { id, name, description: description || '' })
  }
  await fsm().writeFile(skillFile(id), content, { recursive: true, overwrite: false })
  await refreshSkillWorkspaces()
  return success(c, { id, name, description: description || '' })
})

// DELETE /skills/:id — Delete skill directory
app.delete('/*', async (c) => {
  const id = c.req.path.slice('/api/v1/skills/'.length)
  if (IS_SERVERLESS) {
    // serverless 只能删「覆盖层技能」；内置技能随部署物只读分发，不可删
    const overrides = await listOverridesByPrefix(`skill/${id}:`)
    if (!overrides.size) return badRequest(c, 'Serverless 形态不支持删除内置技能')
    for (const key of overrides.keys()) await deleteOverride(key)
    return success(c)
  }
  if (!await fsm().exists(`skills/${id}`)) return badRequest(c, '技能不存在')
  await fsm().rmdir(`skills/${id}`, { recursive: true })
  await refreshSkillWorkspaces()
  return success(c)
})

export default app
