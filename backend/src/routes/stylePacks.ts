import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateStylePack } from '../services/style-pack-generate.js'

const app = new Hono()

const VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// POST /style-packs/generate — 大模型按描述生成四段指导（只返回不落库，前端回填表单人工确认）
// 注意：必须在 /:id 之前注册
app.post('/generate', async (c) => {
  const body = await c.req.json()
  const description = String(body.description ?? '').trim()
  if (!description) return badRequest(c, '风格描述必填')
  const textConfigId = Number(body.text_config_id) || undefined
  try {
    const generated = await generateStylePack(description, textConfigId)
    return success(c, generated)
  } catch (err) {
    return badRequest(c, (err as Error).message || '生成失败')
  }
})

// GET /style-packs — 默认只返回启用项，?all=1 返回全部
app.get('/', async (c) => {
  const all = c.req.query('all') === '1'
  const rows = await db.select().from(schema.stylePacks)
  const filtered = all ? rows : rows.filter(r => r.isActive)
  filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id)
  return success(c, filtered.map(r => toSnakeCase(r)))
})

// POST /style-packs — 新增叙事风格包
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.name?.trim()) return badRequest(c, '风格包名称必填')
  if (!body.value?.trim()) return badRequest(c, '风格包 key 必填')
  if (!VALUE_PATTERN.test(body.value.trim())) return badRequest(c, '风格包 key 仅支持小写字母、数字、中划线')
  if (!body.episode_split_guide?.trim() && !body.script_guide?.trim() && !body.extractor_guide?.trim() && !body.storyboard_guide?.trim() && !body.prompt_guide?.trim()) {
    return badRequest(c, '五段指导至少填一项')
  }

  const value = body.value.trim()
  const [dup] = await db.select().from(schema.stylePacks)
    .where(eq(schema.stylePacks.value, value))
  if (dup) return badRequest(c, '风格包 key 已存在')

  const ts = now()
  const res = await db.insert(schema.stylePacks).values({
    name: body.name.trim(),
    value,
    scriptGuide: body.script_guide?.trim() || null,
    episodeSplitGuide: body.episode_split_guide?.trim() || null,
    extractorGuide: body.extractor_guide?.trim() || null,
    storyboardGuide: body.storyboard_guide?.trim() || null,
    promptGuide: body.prompt_guide?.trim() || null,
    description: body.description || null,
    sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
    isActive: body.is_active === false || body.is_active === 0 ? false : true,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.stylePacks)
    .where(eq(schema.stylePacks.id, getInsertId(res)))
  return created(c, toSnakeCase(row))
})

// PUT /style-packs/:id — 更新（value 创建后不可修改）
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = await db.select().from(schema.stylePacks)
    .where(eq(schema.stylePacks.id, id))
  if (!row) return notFound(c, '风格包不存在')

  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.script_guide !== undefined) updates.scriptGuide = String(body.script_guide).trim() || null
  if (body.episode_split_guide !== undefined) updates.episodeSplitGuide = String(body.episode_split_guide).trim() || null
  if (body.extractor_guide !== undefined) updates.extractorGuide = String(body.extractor_guide).trim() || null
  if (body.storyboard_guide !== undefined) updates.storyboardGuide = String(body.storyboard_guide).trim() || null
  if (body.prompt_guide !== undefined) updates.promptGuide = String(body.prompt_guide).trim() || null
  if (body.description !== undefined) updates.description = body.description || null
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    updates.sortOrder = Number(body.sort_order ?? body.sortOrder)
  }
  if (body.is_active !== undefined || body.isActive !== undefined) {
    const v = body.is_active ?? body.isActive
    updates.isActive = !(v === false || v === 0)
  }
  await db.update(schema.stylePacks).set(updates)
    .where(eq(schema.stylePacks.id, id))
  return success(c)
})

// DELETE /style-packs/:id — 硬删除（已绑定此包的项目保留 key，解析不到时静默不注入）
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.delete(schema.stylePacks).where(eq(schema.stylePacks.id, id))
  return success(c)
})

export default app
