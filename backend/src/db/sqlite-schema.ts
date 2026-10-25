/**
 * SQLite 启动建表 DDL + 种子数据（自 mysql-schema.ts 翻译）
 * - AUTO_INCREMENT → AUTOINCREMENT；删除 ENGINE/CHARSET；TINYINT(1) → INTEGER
 * - MySQL 内联 INDEX 拆为独立 CREATE INDEX IF NOT EXISTS
 * - 种子语句去掉 FROM DUAL（SQLite 非法），幂等语义（WHERE NOT EXISTS）保留
 */
import type Database from 'better-sqlite3'
import type { Client } from '@libsql/client'

export const sqliteSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS dramas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style TEXT DEFAULT '3d',
    aspect_ratio TEXT DEFAULT '16:9',
    model_chat TEXT,
    model_image TEXT,
    model_video TEXT,
    language TEXT,
    resolution TEXT DEFAULT '720p',
    total_episodes INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    script_content TEXT,
    description TEXT,
    summary TEXT,
    hook TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INTEGER,
    video_config_id INTEGER,
    resolution TEXT DEFAULT '720p',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    styling TEXT,
    final_prompt TEXT,
    personality TEXT,
    image_url TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INTEGER,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_id INTEGER,
    location TEXT NOT NULL,
    time TEXT NOT NULL,
    prompt TEXT NOT NULL,
    lighting TEXT,
    final_prompt TEXT,
    storyboard_count INTEGER DEFAULT 1,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS storyboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER NOT NULL,
    title TEXT,
    location TEXT,
    time TEXT,
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    subtitle_url TEXT,
    composed_video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episode_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_episode_id ON episode_characters (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_character_id ON episode_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS episode_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id ON episode_scenes (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id ON episode_scenes (scene_id)`,

  `CREATE TABLE IF NOT EXISTS episode_props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_episode_id ON episode_props (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_prop_id ON episode_props (prop_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, character_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_characters_character_id ON storyboard_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_props (
    storyboard_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, prop_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_props_prop_id ON storyboard_props (prop_id)`,

  `CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT,
    protocol TEXT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    settings TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS style_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (value)
  )`,

  `CREATE TABLE IF NOT EXISTS style_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    script_guide TEXT,
    episode_split_guide TEXT,
    extractor_guide TEXT,
    storyboard_guide TEXT,
    prompt_guide TEXT,
    dialogue_guide TEXT,
    pacing_guide TEXT,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (value)
  )`,

  `CREATE TABLE IF NOT EXISTS sys_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    storyboard_id INTEGER,
    drama_id INTEGER,
    episode_id INTEGER,
    scene_id INTEGER,
    character_id INTEGER,
    prop_id INTEGER,
    provider TEXT,
    prompt TEXT,
    model TEXT,
    params TEXT,
    task_id TEXT,
    result_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'processing',
    error_msg TEXT,
    result TEXT,
    progress TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_type ON sys_task (type)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_drama_id ON sys_task (drama_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_storyboard_id ON sys_task (storyboard_id)`,

  `CREATE TABLE IF NOT EXISTS video_merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER,
    drama_id INTEGER,
    title TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INTEGER,
    task_id TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    final_prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_id INTEGER,
    storyboard_id INTEGER,
    storyboard_num INTEGER,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    format TEXT,
    image_gen_id INTEGER,
    video_gen_id INTEGER,
    is_favorite INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  // 应用级全局设置（key-value，如 AI 内容语言 content_language）
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // serverless 形态的 workspace 可写内容覆盖层（skills/prompts 在线编辑）：
  // key 形如 skill/<path>:<lang> 或 prompt/<agentType>:<lang>；本地形态不使用（直写文件）
  `CREATE TABLE IF NOT EXISTS workspace_overrides (
    key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

/**
 * 风格预设种子数据 — value 存入 dramas.style，prompt 注入生图提示词（作为前缀拼接）
 *
 * prompt 统一按多维结构书写，保证跨模型/跨镜头的风格控制力：
 *   核心媒介与渲染 → 线条/造型 → 上色/材质 → 光影 → 色彩调性 → 背景处理 → 画质锚点 → avoid 禁忌项
 */
export const stylePresetSeeds = [
  {
    name: '3D 漫剧', value: '3d', sortOrder: 1,
    prompt: 'high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, volumetric cinematic lighting with soft rim light, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, avoid flat lighting, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art',
    description: '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感',
  },
  {
    name: '日漫赛璐璐', value: 'anime', sortOrder: 2,
    prompt: 'Japanese TV anime style, clean cel shading with hard-edged shadow shapes, crisp uniform black line art, vivid saturated color palette, expressive large-eyed character design with on-model proportions, detailed hand-painted anime backgrounds, dramatic anime key lighting with screentone highlights, key-visual poster quality, consistent character design across shots, avoid 3D CGI look, avoid painterly soft blending, avoid watercolor texture, avoid photorealism, avoid thick western comic outlines',
    description: '日式赛璐璐动画风格',
  },
  {
    name: '吉卜力手绘', value: 'ghibli', sortOrder: 3,
    prompt: 'Studio Ghibli hand-drawn animation style, soft painterly brushwork with organic hand-crafted line quality, lush warm watercolor painted backgrounds, gentle natural daylight with nostalgic warm glow, muted earthy natural color palette, whimsical cozy storybook atmosphere, subtle film-grain softness, theatrical background art quality, consistent character design across shots, avoid hard cel shading, avoid 3D render look, avoid neon over-saturated colors, avoid sharp digital edges, avoid photorealism',
    description: '吉卜力手绘治愈风',
  },
  {
    name: '水彩绘本', value: 'watercolor', sortOrder: 4,
    prompt: 'delicate watercolor storybook illustration, soft translucent color washes, visible cold-press paper texture, fluid hand-painted brushstrokes with gentle pigment bleeds, light airy atmosphere, harmonious pastel palette, whimsical children book charm, loose expressive edges, consistent character design across shots, avoid bold black outlines, avoid digital airbrush look, avoid harsh contrast, avoid 3D rendering, avoid photorealism',
    description: '水彩插画质感',
  },
  {
    name: '美式漫画', value: 'comic', sortOrder: 5,
    prompt: 'Western graphic-novel comic book style, bold confident black ink outlines, halftone dot shading and screentone gradients, dynamic saturated colors with dramatic contrast, dramatic spotlight lighting, flat graphic print look, sharp inking details, dynamic cinematic composition, consistent character design across shots, avoid painterly soft blending, avoid watercolor washes, avoid photorealistic rendering, avoid 3D CGI look, avoid anime cel shading',
    description: '美式漫画粗线条风格',
  },
  {
    name: '国风 2.5D', value: 'guofeng', sortOrder: 7,
    prompt: 'Chinese guofeng 2.5D illustration style, semi-realistic donghua-quality character art, elegant flowing line work, rich traditional Chinese aesthetic elements, layered ink-wash inspired atmospheric backgrounds, refined silk and fabric textures, soft luminous lighting with gentle haze, sophisticated muted jewel-tone palette, xianxia drama poster quality, consistent character design across shots, avoid flat cel shading, avoid western comic ink style, avoid photorealism, avoid plastic 3D look, avoid modern clothing and props unless specified',
    description: '国风动画/仙侠剧质感，2.5D 半写实',
  },
  {
    name: '韩系网漫', value: 'webtoon', sortOrder: 8,
    prompt: 'Korean webtoon manhwa style, clean digital painting with soft gradient shading, slim elegant character proportions, large expressive eyes with detailed highlights, soft glowing skin rendering, romantic dreamy lighting, modern pastel-to-vivid color palette, detailed fashion and fabric rendering, webtoon key visual quality, consistent character design across shots, avoid heavy black ink outlines, avoid halftone dots, avoid 3D render look, avoid watercolor paper texture, avoid chibi proportions',
    description: '韩国条漫/网漫精致上色风',
  },
  {
    name: '黑白漫画', value: 'noir', sortOrder: 9,
    prompt: 'black and white manga illustration, high-contrast monochrome ink work, dynamic hatching and cross-hatching shading, bold solid blacks with dramatic negative space, screentone gray gradation, expressive confident ink linework, cinematic noir lighting, professional manga page quality, consistent character design across shots, strictly no color, avoid grayscale blur smudging, avoid painterly soft edges, avoid photorealism, avoid 3D render look',
    description: '黑白漫/ Noir 高对比墨水风',
  },
]

// 叙事风格包种子 — 按 agent 分段的工作流指导（中文，分别注入四个 agent 的 instructions）
export const stylePackSeeds = [
  {
    name: '快节奏爽剧',
    value: 'fast-paced',
    scriptGuide: '对白短促有力，单句尽量不超过 15 字；少铺垫、直给冲突；允许少量金句/打脸台词，但不要说教式长独白。每集开场 10 秒内进入冲突；单集至少 2 个情绪爆点（打脸/反转/身份揭露）；每场戏只服务一个目的，推进慢的过场戏直接删除或压缩成一句动作描写。',
    extractorGuide: '资产描述客观简洁，突出角色/道具的辨识度特征（供快速识别），不做气氛渲染。',
    storyboardGuide: '镜头密度高，平均每 3-5 秒一切；情绪爆点用特写或快速推镜；转场利落，不使用长空镜。',
    promptGuide: '视频提示词强调动势与快切节奏：主体动作明确、幅度大，镜头运动干脆（快速推拉/甩镜）；爆点画面给足冲击力。',
    description: '短平快节奏，强冲突强反转，适合战神/赘婿/逆袭类题材',
    sortOrder: 1,
  },
  {
    name: '悬疑烧脑',
    value: 'suspense',
    scriptGuide: '对白克制、信息不对称，角色话里有话；关键线索藏在台词细节中，不直接点破；避免角色替观众总结剧情。每集结尾必须留钩子（新谜团/身份暗示/危机）；先给结果再补动机的倒叙可用；解谜节奏层层递进，单集揭开一层谜底的同时抛出新谜团。',
    extractorGuide: '角色与道具描述保留可作线索的细节（伤疤/配饰/随身物），描述中性、不带情绪结论，给后续反转留解释空间。',
    storyboardGuide: '多用特写捕捉微表情和道具细节；气氛镜头（空镜、光影）可适当保留用于铺垫；关键转折前一拍留静默。',
    promptGuide: '视频提示词强调悬念氛围：低调布光、阴影与剪影、浅景深聚焦线索道具；镜头运动缓慢克制（缓推/缓摇），关键信息用停顿。',
    description: '线索埋设 + 层层反转，适合刑侦/复仇/身份谜团类题材',
    sortOrder: 2,
  },
  {
    name: '甜宠轻喜',
    value: 'sweet-romance',
    scriptGuide: '对白轻松有生活感，允许俏皮互怼和内心 OS；情感递进靠细节（小动作、眼神）而非直白表白；避免狗血误会拖节奏。每集至少一个心动瞬间（暧昧拉扯/意外接触/护短）；误会线索当集发起、两集内化解；整体节奏舒缓但不拖沓，单集保留一个轻笑点。',
    extractorGuide: '角色描述突出亲和力与时尚感细节（穿搭/发型/小配饰），场景描述保留生活气息元素，道具偏日常温馨。',
    storyboardGuide: '双人镜头与眼神特写为主；氛围光效和慢镜头用于心动瞬间；色调明快，转场柔和。',
    promptGuide: '视频提示词强调柔和氛围：暖调逆光、慢动作与浅景深、轻微镜头呼吸感；心动瞬间用慢镜环绕或定格。',
    description: '甜而不腻的情感拉扯，适合都市爱情/校园/婚恋类题材',
    sortOrder: 3,
  },
  {
    name: '译制剧',
    value: 'dubbed-drama',
    scriptGuide: '对白带自然可读的翻译腔：适度使用"哦，我的上帝""看在上帝的份上""我亲爱的朋友"等译制片表达，点到为止不堆砌；句式可带人称代词冗余、长定语"的"字结构、倒装语序和连接词（但是/而且/然而）；称谓偏西化（先生/女士/警官/医生），人名地名前后统一译名；情绪表达略外显，符合配音表演感。避免网络流行语、古风腔、方言梗和生硬机翻感。正剧节奏，单集 1-2 个小高潮，冲突集中在中后段；允许必要的背景交代戏，但用对白自然带出而非大段旁白；每集结尾留悬念。',
    extractorGuide: '人名地名采用统一译名并在描述中标注；角色描述保留原作地域特征（服饰/体貌），道具与场景体现异域感。',
    storyboardGuide: '中近景对话为主，正反打节奏平稳；场景转换可用叠化；服化道与布景体现原作地域感。',
    promptGuide: '视频提示词强调正剧质感：镜头平稳（横移/固定机位为主），画面庄重、光线自然；人物表演幅度适配配音节奏。',
    description: '译制腔对白 + 正剧节奏，适合海外翻拍/异域背景/配音短剧题材',
    sortOrder: 4,
  },
]

/**
 * 旧版种子 prompt（v1 一句话风格描述）— 用于内容寻址升级：
 * 仅当库中行的 prompt 仍等于旧种子值（未被用户在设置页编辑过）才覆盖为新 prompt
 */
const LEGACY_SEED_PROMPTS: Record<string, string> = {
  '3d': '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail',
  anime: 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds',
  ghibli: 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere',
  watercolor: 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel',
  comic: 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look',
}

/**
 * 已下架的种子预设 — 内容寻址删除：仅当库中行的 prompt 仍是种子原文
 * （未被用户编辑过）才删除；用户改过的同名行视为用户数据保留。
 * live（真人写实）：真人影像过不了平台真人内容审核，下架。
 */
const REMOVED_SEED_PROMPTS: Record<string, string> = {
  live: 'ultra-realistic cinematic live-action look, professional film photography, natural skin tones with detailed pores and realistic texture, true human anatomy and proportions, shallow depth of field with creamy bokeh, cinematic three-point lighting, subtle film grain, 35mm lens cinematic framing, true-to-life color grading, detailed real-world environments, consistent actor appearance across shots, avoid cartoon or anime features, avoid 3D render look, avoid illustration style, avoid plastic waxy skin, avoid over-smoothing beauty filter',
}

// INSERT ... SELECT WHERE NOT EXISTS → 幂等：只补缺失行，不覆盖用户编辑
// （SQLite 无 FROM DUAL，无 FROM 的 SELECT 合法）
// export：libSQL 初始化路径（db/index.ts 的 libsql 分支）复用同一组种子语句
export const SEED_SQL = 'INSERT INTO style_presets ("name", "value", "prompt", "description", "sort_order", "is_active", "created_at", "updated_at") SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM style_presets WHERE value = ?)'
// 内容寻址升级：命中旧种子原文才更新（用户在设置页改过的行不动）
export const UPGRADE_SQL = 'UPDATE style_presets SET "name" = ?, "prompt" = ?, "description" = ?, "sort_order" = ?, "updated_at" = ? WHERE "value" = ? AND "prompt" = ?'
// 内容寻址下架：命中下架种子原文才删除
export const REMOVE_SQL = 'DELETE FROM style_presets WHERE "value" = ? AND "prompt" = ?'

const LEGACY_PROTOCOL_BACKFILL_SQL =
  `UPDATE ai_service_configs SET protocol = lower(trim(provider)) ` +
  `WHERE protocol IS NULL AND lower(trim(coalesce(provider, ''))) ` +
  `IN ('openai', 'gemini', 'volcengine', 'minimax', 'aliyun')`

/**
 * 幂等补列迁移：缺列才 ALTER TABLE ADD COLUMN，随后执行可选回填语句。
 * CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，新增字段必须走这里。
 */
function ensureColumn(sqlite: Database.Database, table: string, column: string, definition: string, backfill?: string) {
  const has = sqlite.prepare('SELECT 1 AS x FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) as { x?: number } | undefined
  if (has?.x) return
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  if (backfill) {
    const res = sqlite.prepare(backfill).run()
    if (res.changes > 0) console.log(`🔧 ${table}.${column} 已补列并回填 ${res.changes} 行`)
  }
}

export function initSqliteSchema(sqlite: Database.Database) {
  for (const statement of sqliteSchemaStatements) {
    sqlite.exec(statement)
  }
  // 存量库升级：CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，新字段必须走幂等 ALTER
  ensureColumn(sqlite, 'ai_service_configs', 'protocol', 'TEXT', LEGACY_PROTOCOL_BACKFILL_SQL)
  ensureColumn(sqlite, 'sys_task', 'progress', 'TEXT')
  ensureColumn(sqlite, 'sys_task', 'result', 'TEXT')
  ensureColumn(sqlite, 'sys_task', 'episode_id', 'INTEGER')
  ensureColumn(sqlite, 'dramas', 'style_pack', 'TEXT')
  ensureColumn(sqlite, 'dramas', 'source_content', 'TEXT')
  // 项目级生成配置：模型覆盖（'provider/model' 复合键，空=跟随配置默认）与内容语言（空=跟随全局）
  ensureColumn(sqlite, 'dramas', 'model_chat', 'TEXT')
  ensureColumn(sqlite, 'dramas', 'model_image', 'TEXT')
  ensureColumn(sqlite, 'dramas', 'model_video', 'TEXT')
  ensureColumn(sqlite, 'dramas', 'language', 'TEXT')
  // 项目级视频分辨率（480p/720p/1080p，各集继承），旧的 episodes.resolution 只读废弃
  ensureColumn(sqlite, 'dramas', 'resolution', "TEXT DEFAULT '720p'")
  ensureColumn(sqlite, 'episodes', 'summary', 'TEXT')
  ensureColumn(sqlite, 'episodes', 'hook', 'TEXT')
  ensureColumn(sqlite, 'scenes', 'reference_images', 'TEXT')
  // style_packs 四列化（按 agent 分段）：旧三列内容回填（script=对白+节奏，prompt=分镜）
  ensureColumn(sqlite, 'style_packs', 'episode_split_guide', 'TEXT')
  ensureColumn(sqlite, 'style_packs', 'script_guide', 'TEXT',
    "UPDATE style_packs SET script_guide = TRIM(COALESCE(dialogue_guide,'') || CHAR(10) || COALESCE(pacing_guide,'')) WHERE script_guide IS NULL AND (dialogue_guide IS NOT NULL OR pacing_guide IS NOT NULL)")
  ensureColumn(sqlite, 'style_packs', 'extractor_guide', 'TEXT')
  ensureColumn(sqlite, 'style_packs', 'prompt_guide', 'TEXT',
    'UPDATE style_packs SET prompt_guide = storyboard_guide WHERE prompt_guide IS NULL AND storyboard_guide IS NOT NULL')

  const insertSeed = sqlite.prepare(SEED_SQL)
  const upgradeSeed = sqlite.prepare(UPGRADE_SQL)
  const removeSeed = sqlite.prepare(REMOVE_SQL)
  const insertPackSeed = sqlite.prepare('INSERT INTO style_packs ("name", "value", "script_guide", "extractor_guide", "storyboard_guide", "prompt_guide", "description", "sort_order", "created_at", "updated_at") SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM style_packs WHERE value = ?)')
  for (const s of stylePackSeeds) {
    const ts = new Date().toISOString()
    insertPackSeed.run(s.name, s.value, s.scriptGuide, s.extractorGuide, s.storyboardGuide, s.promptGuide, s.description, s.sortOrder, ts, ts, s.value)
  }
  for (const s of stylePresetSeeds) {
    const ts = new Date().toISOString()
    insertSeed.run(s.name, s.value, s.prompt, s.description, s.sortOrder, ts, ts, s.value)
    const legacyPrompt = LEGACY_SEED_PROMPTS[s.value]
    if (legacyPrompt) {
      const res = upgradeSeed.run(s.name, s.prompt, s.description, s.sortOrder, ts, s.value, legacyPrompt)
      if (res.changes > 0) console.log(`🎨 风格预设「${s.name}」已升级为结构化提示词`)
    }
  }
  for (const [value, prompt] of Object.entries(REMOVED_SEED_PROMPTS)) {
    const res = removeSeed.run(value, prompt)
    if (res.changes > 0) console.log(`🗑️ 风格预设「${value}」已下架`)
  }
}

// ─── libSQL（Turso）初始化路径 ────────────────────────────────────
// 与 better-sqlite3 路径共享同一组语句常量，仅驱动 API 不同（async）。
// 语句为标准 SQLite 方言（AUTOINCREMENT / pragma_table_info 均兼容，见 spike-libsql.ts 验证）。

async function ensureColumnLibsql(client: Client, table: string, column: string, definition: string, backfill?: string) {
  const has = await client.execute({
    sql: 'SELECT 1 AS x FROM pragma_table_info(?) WHERE name = ?',
    args: [table, column],
  })
  if (has.rows.length > 0) return
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  if (backfill) {
    const res = await client.execute(backfill)
    if (res.rowsAffected > 0) console.log(`🔧 ${table}.${column} 已补列并回填 ${res.rowsAffected} 行`)
  }
}

export async function initLibsqlSchema(client: Client) {
  for (const statement of sqliteSchemaStatements) {
    await client.executeMultiple(statement)
  }
  // 存量库升级：同 better-sqlite3 路径，幂等补列
  await ensureColumnLibsql(client, 'ai_service_configs', 'protocol', 'TEXT', LEGACY_PROTOCOL_BACKFILL_SQL)
  await ensureColumnLibsql(client, 'sys_task', 'progress', 'TEXT')
  await ensureColumnLibsql(client, 'sys_task', 'result', 'TEXT')
  await ensureColumnLibsql(client, 'sys_task', 'episode_id', 'INTEGER')
  await ensureColumnLibsql(client, 'dramas', 'style_pack', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'source_content', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'model_chat', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'model_image', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'model_video', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'language', 'TEXT')
  await ensureColumnLibsql(client, 'dramas', 'resolution', "TEXT DEFAULT '720p'")
  await ensureColumnLibsql(client, 'episodes', 'summary', 'TEXT')
  await ensureColumnLibsql(client, 'episodes', 'hook', 'TEXT')
  await ensureColumnLibsql(client, 'scenes', 'reference_images', 'TEXT')
  await ensureColumnLibsql(client, 'style_packs', 'episode_split_guide', 'TEXT')
  await ensureColumnLibsql(client, 'style_packs', 'script_guide', 'TEXT',
    "UPDATE style_packs SET script_guide = TRIM(COALESCE(dialogue_guide,'') || CHAR(10) || COALESCE(pacing_guide,'')) WHERE script_guide IS NULL AND (dialogue_guide IS NOT NULL OR pacing_guide IS NOT NULL)")
  await ensureColumnLibsql(client, 'style_packs', 'extractor_guide', 'TEXT')
  await ensureColumnLibsql(client, 'style_packs', 'prompt_guide', 'TEXT',
    'UPDATE style_packs SET prompt_guide = storyboard_guide WHERE prompt_guide IS NULL AND storyboard_guide IS NOT NULL')

  for (const s of stylePackSeeds) {
    const ts = new Date().toISOString()
    await client.execute({
      sql: 'INSERT INTO style_packs ("name", "value", "script_guide", "extractor_guide", "storyboard_guide", "prompt_guide", "description", "sort_order", "created_at", "updated_at") SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM style_packs WHERE value = ?)',
      args: [s.name, s.value, s.scriptGuide, s.extractorGuide, s.storyboardGuide, s.promptGuide, s.description, s.sortOrder, ts, ts, s.value],
    })
  }

  for (const s of stylePresetSeeds) {
    const ts = new Date().toISOString()
    await client.execute({
      sql: SEED_SQL,
      args: [s.name, s.value, s.prompt, s.description, s.sortOrder, ts, ts, s.value],
    })
    const legacyPrompt = LEGACY_SEED_PROMPTS[s.value]
    if (legacyPrompt) {
      const res = await client.execute({
        sql: UPGRADE_SQL,
        args: [s.name, s.prompt, s.description, s.sortOrder, ts, s.value, legacyPrompt],
      })
      if (res.rowsAffected > 0) console.log(`🎨 风格预设「${s.name}」已升级为结构化提示词`)
    }
  }
  for (const [value, prompt] of Object.entries(REMOVED_SEED_PROMPTS)) {
    const res = await client.execute({ sql: REMOVE_SQL, args: [value, prompt] })
    if (res.rowsAffected > 0) console.log(`🗑️ 风格预设「${value}」已下架`)
  }
}
