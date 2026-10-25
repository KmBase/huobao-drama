import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('POST /episodes no longer locks per-episode configs', () => {
  const route = read('src/routes/episodes.ts')
  const tasks = read('src/routes/tasks.ts')

  // 建集不再读取/写入 image_config_id / video_config_id
  assert.doesNotMatch(route, /imageConfigId|videoConfigId/)
  // 任务发起回退链：请求 config_id → 全局默认，不再回退集锁定配置
  assert.doesNotMatch(tasks, /imageConfigId|videoConfigId/)
  assert.match(tasks, /body\.config_id/)
})

test('split-apply no longer locks per-episode configs', () => {
  const route = read('src/routes/dramas.ts')
  const apply = route.slice(route.indexOf('split-episodes/apply'))

  assert.doesNotMatch(apply, /imageConfigId|videoConfigId/)
  assert.doesNotMatch(apply, /getActiveConfigId/)
})
