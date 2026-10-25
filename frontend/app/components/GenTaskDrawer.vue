<template>
  <div v-if="open" class="task-drawer-overlay" @click.self="emit('close')">
    <aside class="task-drawer" role="dialog" aria-modal="true" :aria-label="t('episode.tasks.title')">
      <header class="task-drawer-head">
        <div>
          <div class="video-task-title">{{ t('episode.tasks.title') }}</div>
          <div class="video-task-meta">{{ t('episode.tasks.meta', { n: rows.length }) }}</div>
        </div>
        <div class="task-drawer-head-actions">
          <button v-if="finishedCount > 0" class="btn btn-sm" @click="clearTasks">
            <Trash2 :size="11" /> {{ t('episode.tasks.clear') }}
          </button>
          <button class="btn btn-sm" @click="reload">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            {{ t('common.refresh') }}
          </button>
          <button class="btn btn-ghost btn-icon" @click="emit('close')"><X :size="14" /></button>
        </div>
      </header>
      <div class="video-task-metrics task-drawer-metrics">
        <span class="video-task-metric is-pending">{{ t('episode.vid.metricPending', { n: activeCount }) }}</span>
        <span class="video-task-metric is-done">{{ t('episode.vid.metricDone', { n: doneCount }) }}</span>
        <span class="video-task-metric is-failed">{{ t('episode.vid.metricFailed', { n: failedCount }) }}</span>
      </div>
      <div v-if="!rows.length" class="step-empty task-drawer-empty">
        <div class="empty-visual">
          <ListTodo :size="32" />
        </div>
        <div class="empty-title">{{ t('episode.tasks.emptyTitle') }}</div>
        <div class="empty-desc">{{ t('episode.tasks.emptyDesc') }}</div>
      </div>
      <div v-else class="video-task-table task-drawer-body">
        <div
          v-for="row in rows"
          :key="row.key"
          :class="['video-task-row', 'gen-task-row', 'is-' + stateClass(row.status)]"
        >
          <div class="video-task-preview">
            <video
              v-if="row.previewUrl && (row.kind === 'video' || row.kind === 'merge')"
              :src="previewSrc(row.previewUrl)"
              :poster="posterOf(previewSrc(row.previewUrl)) || undefined"
              controls
              preload="none"
              playsinline
            />
            <img
              v-else-if="row.previewUrl"
              :src="thumbOf(previewSrc(row.previewUrl))"
              :alt="row.targetLabel"
              loading="lazy"
              @error="thumbFallback($event, previewSrc(row.previewUrl))"
              @click="viewer = { open: true, src: previewSrc(row.previewUrl), title: row.targetLabel }"
            />
            <div v-else class="video-task-empty">
              <Loader2 v-if="stateClass(row.status) === 'pending'" :size="18" class="animate-spin" />
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <span class="video-task-index">{{ kindLabel(row.kind) }}</span>
          </div>
          <div class="video-task-main">
            <div class="video-task-line">
              <strong class="video-task-name truncate task-name-clickable" :title="t('episode.tasks.expandHint')" @click.stop="expanded = expanded === row.key ? '' : row.key">{{ row.targetLabel }}</strong>
            </div>
            <div class="video-task-meta-line">
              <span class="video-task-loc truncate">{{ row.provider }}{{ row.model ? ' · ' + row.model : '' }}</span>
              <template v-if="rowDuration(row)">
                <span class="video-task-sep">·</span>
                <span>{{ t('episode.tasks.duration', { dur: rowDuration(row) }) }}</span>
              </template>
              <template v-if="progressLine(row)">
                <span class="video-task-sep">·</span>
                <span class="task-progress-hint">{{ progressLine(row) }}</span>
              </template>
              <span class="video-task-sep">·</span>
              <span>#{{ row.id }}</span>
            </div>
            <div
              v-if="row.status === 'processing'"
              class="task-progress-track"
              :class="{ indeterminate: !(row.progress?.percent > 0) }"
              :style="row.progress?.percent > 0 ? { '--p': row.progress.percent + '%' } : null"
            >
              <div class="task-progress-fill" />
            </div>
            <div v-if="row.errorMsg" class="video-task-error" :title="row.errorMsg">
              {{ mapError(row.errorMsg) }}
              <div v-if="row.kind === 'video' && moderationHint(row.errorMsg)" class="video-task-error-hint">{{ moderationHint(row.errorMsg) }}</div>
            </div>
            <div v-if="expanded === row.key" class="video-task-detail">
              <div v-if="row.prompt" class="task-detail-line">
                <span class="task-detail-label">{{ t('episode.tasks.detailPrompt') }}</span>
                <span class="task-detail-value">{{ row.prompt }}</span>
              </div>
              <div v-if="row.refSummary" class="task-detail-line">
                <span class="task-detail-label">{{ t('episode.tasks.detailSpecs') }}</span>
                <span class="task-detail-value">{{ row.refSummary }}</span>
              </div>
              <div v-if="row.upstreamId" class="task-detail-line">
                <span class="task-detail-label">{{ t('episode.tasks.detailUpstream') }}</span>
                <span class="task-detail-value mono">{{ row.upstreamId }}</span>
              </div>
              <div class="task-detail-line">
                <span class="task-detail-label">{{ t('episode.tasks.detailCreated') }}</span>
                <span class="task-detail-value">{{ fmtTime(row.createdAt) }}</span>
              </div>
              <div v-if="row.completedAt" class="task-detail-line">
                <span class="task-detail-label">{{ t('episode.tasks.detailCompleted') }}</span>
                <span class="task-detail-value">{{ fmtTime(row.completedAt) }}</span>
              </div>
            </div>
            <div v-if="row.kind !== 'merge' && rowActions(row).length" class="video-task-actions">
              <button
                v-for="action in rowActions(row)"
                :key="action.key"
                class="btn btn-sm"
                @click="action.run(row)"
              >{{ action.label }}</button>
            </div>
          </div>
          <span :class="['video-task-status', 'is-' + stateClass(row.status)]">
            <span :class="['dot', stateClass(row.status) === 'done' && 'ok', stateClass(row.status) === 'pending' && 'pending']" />
            {{ statusLabel(row.status) }}
          </span>
        </div>
      </div>
    </aside>
    <ConfirmDialog
      :open="confirm.open"
      :title="confirm.title"
      :message="confirm.message"
      :z-index="121"
      @confirm="runConfirm"
      @cancel="confirm.open = false"
    />
    <div v-if="viewer.open" class="gen-task-viewer-overlay" @click.self="viewer.open = false">
      <figure class="gen-task-viewer">
        <img :src="viewer.src" :alt="viewer.title" />
        <figcaption>{{ viewer.title }}</figcaption>
        <button class="btn btn-icon btn-sm btn-ghost gen-task-viewer-close" @click="viewer.open = false"><X :size="16" /></button>
      </figure>
    </div>
  </div>
</template>

<script setup>
/**
 * 任务抽屉（剧集页 / 项目页共用）：右侧抽屉聚合 sys_task + video_merges，
 * 数据由调用方通过 fetch() 提供（按集 / 按项目两种口径），
 * 拿到数据后 emit('loaded') 让调用方做自己的状态恢复（如分镜视频状态回填）。
 */
import { ListTodo, Trash2, X, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { taskAPI } from '~/composables/useApi'
import { thumbOf, posterOf, thumbFallback } from '~/composables/useMedia'
import { toastError, mapError, MODERATION_RE } from '~/composables/useToast'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** async () => ({ tasks: [], merges: [] })，按集/按项目由调用方决定 */
  fetch: { type: Function, required: true },
  /** targetLabel 解析所需的上下文列表：{ sbs, chars, scenes, props } */
  context: { type: Object, default: () => ({}) },
  /** 额外行内动作（如分集结果"查看结果"）：row => ({ label, run }) | null */
  extraAction: { type: Function, default: null },
})

const emit = defineEmits(['close', 'loaded'])

const { t } = useI18n()

const tasks = ref([])
const merges = ref([])
const expanded = ref('')
const viewer = ref({ open: false, src: '', title: '' })
let timer = null

// 目标名解析所需的关联实体，缺省为空数组（项目页可不传分镜列表，回退 #id）
const ctxSbs = computed(() => props.context?.sbs || [])
const ctxChars = computed(() => props.context?.chars || [])
const ctxScenes = computed(() => props.context?.scenes || [])
const ctxProps = computed(() => props.context?.props || [])

function stopPolling() {
  if (timer) { clearInterval(timer); timer = null }
}

/** 拉取任务并向上抛给调用方（恢复本地状态 / 更新顶栏角标） */
async function reload() {
  try {
    const data = (await props.fetch()) || {}
    tasks.value = data.tasks || []
    merges.value = data.merges || []
    emit('loaded', { tasks: tasks.value, merges: merges.value })
  } catch { /* 静默失败,不打断其他刷新 */ }
}

defineExpose({ reload })

const activeCount = computed(() =>
  tasks.value.filter(x => x.status === 'processing').length +
  merges.value.filter(m => m.status === 'processing' || m.status === 'pending').length
)
const doneCount = computed(() =>
  tasks.value.filter(x => x.status === 'completed').length +
  merges.value.filter(m => m.status === 'completed').length
)
const failedCount = computed(() =>
  tasks.value.filter(x => x.status === 'failed' || x.status === 'cancelled').length +
  merges.value.filter(m => m.status === 'failed').length
)
// 已结束（可清理）的任务数：仅统计 sys_task 行，merges 不在清理范围
const finishedCount = computed(() =>
  tasks.value.filter(x => x.status !== 'processing').length
)

function parseProgress(raw) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function targetLabel(task) {
  if (task.type === 'text') {
    const agentType = (parseProgress(task.params) || {}).agentType
    const names = {
      script_rewriter: t('settings.agents.scriptRewriter'),
      extractor: t('settings.agents.extractor'),
      storyboard_breaker: t('settings.agents.storyboardBreaker'),
      prompt_generator: t('settings.agents.promptGenerator'),
      episode_splitter: t('settings.agents.episodeSplitter'),
    }
    return names[agentType] || t('common.serviceType.text')
  }
  if (task.storyboard_id) {
    const sb = ctxSbs.value.find(x => x.id === task.storyboard_id)
    return t('episode.tasks.sbN', { n: sb?.storyboard_number ?? sb?.storyboardNumber ?? task.storyboard_id })
  }
  if (task.character_id) {
    const c = ctxChars.value.find(x => x.id === task.character_id)
    return `${t('common.role')} · ${c?.name || task.character_id}`
  }
  if (task.scene_id) {
    const s = ctxScenes.value.find(x => x.id === task.scene_id)
    return `${t('common.scene')} · ${s?.location || task.scene_id}`
  }
  if (task.prop_id) {
    const p = ctxProps.value.find(x => x.id === task.prop_id)
    return `${t('common.prop')} · ${p?.name || task.prop_id}`
  }
  return t('episode.tasks.generic')
}

function refSummary(task) {
  const p = parseProgress(task.params) || {}
  const refs = []
  const nImg = (p.referenceImages || []).length
  const nVid = (p.referenceVideoUrls || []).length
  const nAud = (p.referenceAudioUrls || []).length
  const frames = [p.firstFrameUrl, p.lastFrameUrl].filter(Boolean).length
  if (nImg) refs.push(t('episode.tasks.refImages', { n: nImg }))
  if (nVid) refs.push(t('episode.tasks.refVideos', { n: nVid }))
  if (nAud) refs.push(t('episode.tasks.refAudios', { n: nAud }))
  if (frames) refs.push(t('episode.tasks.refFrames', { n: frames }))
  const specs = []
  if (task.type === 'video') {
    if (p.duration) specs.push(t('episode.tasks.specDuration', { n: p.duration }))
    if (p.aspectRatio) specs.push(p.aspectRatio)
    if (p.resolution) specs.push(p.resolution)
  }
  if (task.type === 'image' && p.size) specs.push(p.size)
  return [...refs, ...specs].join(' · ')
}

// 统一行结构：image / video / text / merge 多类合并按时间倒序
const rows = computed(() => {
  const taskRows = tasks.value.map(x => ({
    key: `task-${x.id}`,
    kind: x.type, // image | video | text | episode_split
    id: x.id,
    targetLabel: targetLabel(x),
    provider: x.provider || '',
    model: x.model || '',
    status: x.status || 'processing',
    errorMsg: x.error_msg || '',
    previewUrl: x.local_path || x.result_url || '',
    prompt: x.prompt || '',
    result: x.result || '',
    createdAt: x.created_at || '',
    completedAt: x.completed_at || '',
    progress: parseProgress(x.progress),
    upstreamId: x.task_id || '',
    refSummary: refSummary(x),
  }))
  const mergeRows = merges.value.map(m => ({
    key: `merge-${m.id}`,
    kind: 'merge',
    id: m.id,
    targetLabel: t('episode.tasks.fullMerge'),
    provider: m.provider || 'ffmpeg',
    model: m.model || '',
    status: m.status || 'pending',
    errorMsg: m.error_msg || '',
    previewUrl: m.merged_url || '',
    prompt: '',
    createdAt: m.created_at || '',
    completedAt: m.completed_at || '',
  }))
  return [...taskRows, ...mergeRows].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
})

// 任务行操作：查询进度/取消（进行中）/ 重试（失败、已取消）/ 删除（非进行中）
// 文本任务为同步 Agent 请求，无上游可查/可取消/可重试，结束后仅可删除
function rowActions(row) {
  const extra = props.extraAction ? props.extraAction(row) : null
  if (row.kind === 'merge') return []
  const actions = []
  if (extra) actions.push({ key: 'extra', label: extra.label, run: extra.run })
  if (row.kind === 'text') {
    if (row.status !== 'processing') actions.push({ key: 'delete', label: t('episode.tasks.actionDelete'), run: deleteTask })
    return actions
  }
  if (row.status === 'processing') {
    actions.push({ key: 'probe', label: t('episode.tasks.actionProbe'), run: refreshTask })
    actions.push({ key: 'cancel', label: t('episode.tasks.actionCancel'), run: cancelTask })
  } else {
    if (row.status === 'failed' || row.status === 'cancelled') {
      actions.push({ key: 'retry', label: t('episode.tasks.actionRetry'), run: retryTask })
    }
    actions.push({ key: 'delete', label: t('episode.tasks.actionDelete'), run: deleteTask })
  }
  return actions
}

/** 进行中任务的一行进度摘要：排队中(含等待时长) / 上游百分比 / 已轮询次数 */
function progressLine(row) {
  if (row.status !== 'processing') return ''
  if (row.kind === 'text') return t('episode.tasks.textRunning')
  const p = row.progress
  if (!p) return t('episode.tasks.stageSubmit')
  if (p.stage === 'submit') return t('episode.tasks.stageSubmit')
  if (p.upstream === 'pending' || p.upstream === 'queued') {
    const started = new Date(row.createdAt).getTime()
    const mins = Number.isFinite(started) ? Math.max(1, Math.round((Date.now() - started) / 60000)) : 0
    if (mins) return t('episode.tasks.stageQueued', { m: mins })
  }
  if (p.percent > 0) return t('episode.tasks.progressPercent', { p: p.percent })
  if (p.attempts) return t('episode.tasks.progressLine', { n: p.attempts })
  return t('episode.tasks.stagePoll')
}

const confirm = reactive({ open: false, title: '', message: '', run: null })

function askConfirm(title, message, run) {
  confirm.title = title
  confirm.message = message
  confirm.run = run
  confirm.open = true
}

async function runConfirm() {
  const run = confirm.run
  confirm.open = false
  confirm.run = null
  if (!run) return
  try { await run() } catch (e) { toastError(e) }
}

async function refreshTask(row) {
  try {
    const r = await taskAPI.refresh(row.id)
    const outcome = r?.outcome
    if (outcome === 'completed') toast.success(t('episode.tasks.probeCompleted'))
    else if (outcome === 'failed') toast.error(t('episode.tasks.probeFailed'))
    else if (outcome === 'not-eligible') toast.info(t('episode.tasks.probeSubmitted'))
    else toast.info(t('episode.tasks.probeProcessing'))
    await reload()
  } catch (e) { toastError(e) }
}

async function cancelTask(row) {
  try {
    await taskAPI.cancel(row.id)
    await reload()
  } catch (e) { toastError(e) }
}

async function retryTask(row) {
  try {
    await taskAPI.retry(row.id)
    toast.success(t('episode.tasks.retried'))
    await reload()
  } catch (e) { toastError(e) }
}

function deleteTask(row) {
  askConfirm(
    t('episode.tasks.actionDelete'),
    t('episode.tasks.deleteConfirm', { n: row.id }),
    async () => {
      await taskAPI.del(row.id)
      await reload()
    },
  )
}

function clearTasks() {
  const n = finishedCount.value
  if (!n) return
  askConfirm(
    t('episode.tasks.clear'),
    t('episode.tasks.clearConfirm', { n }),
    async () => {
      const r = await taskAPI.clear('finished')
      toast.success(t('episode.tasks.cleared', { n: r?.deleted ?? 0 }))
      await reload()
    },
  )
}

function kindLabel(kind) {
  return kind === 'image' ? t('common.serviceType.image') : kind === 'video' ? t('common.serviceType.video') : kind === 'text' ? t('common.serviceType.text') : t('episode.tasks.mergeKind')
}

function statusLabel(status) {
  if (status === 'completed') return t('episode.status.done')
  if (status === 'failed') return t('episode.status.failed')
  if (status === 'cancelled') return t('episode.status.cancelled')
  return t('episode.status.generating')
}

// 映射到现有 video-task-status 的样式类:is-done / is-pending / is-failed
function stateClass(status) {
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'pending'
}

function moderationHint(msg) {
  return MODERATION_RE.test(String(msg || '')) ? t('episode.vid.moderationHint') : ''
}

// local_path 为站内相对路径补 '/',远端 result_url 原样使用
function previewSrc(url) {
  if (!url) return ''
  return /^https?:\/\//.test(url) ? url : '/' + url
}

function fmtTime(ts) {
  return ts ? String(ts).replace('T', ' ').slice(0, 19) : ''
}

function rowDuration(row) {
  if (!row.createdAt || !row.completedAt) return ''
  const ms = new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`
}

// 打开时拉一次；抽屉打开且有进行中任务时 4s 轮询,关闭或全部结束时停止
watch(() => props.open, (v) => {
  if (v) reload()
})
watch([() => props.open, activeCount], ([v, active]) => {
  stopPolling()
  if (v && active > 0) {
    timer = setInterval(reload, 4000)
  }
})

onBeforeUnmount(stopPolling)
</script>

<style>
/* 本组件样式非 scoped：行结构类（video-task-*）与剧集页工作台共用同一套视觉， */
/* 剧集页保留自己的同名定义，两处规则一致不冲突 */
/* ===== 任务行 ===== */
.gen-task-row {
  grid-template-columns: 84px minmax(0, 1fr) auto;
  cursor: default;
}
.gen-task-row .video-task-preview img {
  cursor: zoom-in;
}
.gen-task-row .video-task-row,
.video-task-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-top: 1px solid var(--surface-outline);
  transition: background 0.16s var(--ease-out), border-color 0.16s var(--ease-out);
}
.gen-task-row.video-task-row { cursor: default; }
.video-task-row:first-child {
  border-top: 0;
}
.video-task-row:hover,
.video-task-row.is-pending {
  background: var(--bg-hover);
}
.video-task-row.is-failed {
  background: var(--error-bg);
}
.video-task-preview {
  position: relative;
  width: 56px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--surface-outline);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
}
.video-task-preview video,
.video-task-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.video-task-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.video-task-index {
  position: absolute;
  left: 3px;
  top: 3px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(0,0,0,0.56);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 800;
}
.video-task-main {
  min-width: 0;
}
.video-task-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.video-task-name {
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.video-task-meta-line {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--text-3);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}
.video-task-loc {
  color: var(--text-2);
}
.video-task-sep { color: var(--text-3); opacity: 0.5; }
.video-task-error {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--error);
}
.video-task-error-hint {
  margin-top: 3px;
  color: var(--accent-text, var(--accent));
  font-weight: 600;
}
.video-task-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid var(--surface-outline);
  border-radius: 999px;
  background: var(--overlay-track);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
  justify-self: end;
  align-self: center;
}
.video-task-status.is-done {
  color: var(--success);
  border-color: var(--success-bg);
  background: var(--success-bg);
}
.video-task-status.is-pending,
.video-task-status.is-ready {
  color: var(--accent-text);
  border-color: var(--accent-glow);
  background: var(--accent-bg);
}
.video-task-status.is-failed,
.video-task-status.is-blocked {
  color: var(--warning);
  border-color: var(--warning-bg);
  background: var(--warning-bg);
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bg-3); flex-shrink: 0; }
.dot.ok { background: var(--success); }
.dot.pending { background: var(--accent); }
/* 任务行操作（取消/重试/删除）：紧凑按钮行 */
.video-task-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.video-task-actions .btn {
  padding: 3px 10px;
  font-size: 11px;
  line-height: 1.4;
}
/* 行名可点击展开详情 */
.task-name-clickable {
  cursor: pointer;
}
.task-name-clickable:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.task-progress-hint {
  color: var(--text-muted, #8a8f98);
}
/* 进行中任务的进度条：有上游百分比按宽度填充，无则不确定滑动动画 */
.task-progress-track {
  margin-top: 6px;
  height: 3px;
  border-radius: 99px;
  background: var(--surface-outline);
  overflow: hidden;
}
.task-progress-fill {
  height: 100%;
  width: var(--p, 0%);
  border-radius: 99px;
  background: var(--accent);
  transition: width 0.6s ease;
}
.task-progress-track.indeterminate .task-progress-fill {
  width: 35%;
  animation: task-progress-slide 1.4s ease-in-out infinite;
}
@keyframes task-progress-slide {
  0% { margin-left: -35%; }
  100% { margin-left: 100%; }
}
/* 展开的任务详情块 */
.video-task-detail {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--surface-outline);
  border-radius: 8px;
  background: var(--surface-bg, rgba(0, 0, 0, 0.03));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-detail-line {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.task-detail-label {
  color: var(--text-muted, #8a8f98);
}
.task-detail-value {
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}
/* 抽屉头部 */
.task-drawer-head .video-task-title {
  font-size: 13px;
  line-height: 1.2;
  font-weight: 850;
  color: var(--text-0);
}
.task-drawer-head .video-task-meta {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-3);
}
.video-task-metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
.video-task-metric {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid var(--surface-outline);
  border-radius: 999px;
  background: var(--overlay-track);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
}
.video-task-metric.is-done {
  color: var(--success);
  border-color: var(--success-bg);
  background: var(--success-bg);
}
.video-task-metric.is-pending {
  color: var(--accent-text);
  border-color: var(--accent-glow);
  background: var(--accent-bg);
}
.video-task-metric.is-failed {
  color: var(--warning);
  border-color: var(--warning-bg);
  background: var(--warning-bg);
}
/* ===== 抽屉 ===== */
.task-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  display: flex;
  justify-content: flex-end;
  background: var(--scrim);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: fadeIn 0.18s var(--ease-out);
}
.task-drawer {
  width: min(560px, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border-left: 1px solid var(--panel-border);
  box-shadow: var(--shadow-xl);
  animation: taskDrawerIn 0.22s var(--ease-out);
}
@keyframes taskDrawerIn {
  from { transform: translateX(24px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.task-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--surface-outline);
}
.task-drawer-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.task-drawer-metrics {
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface-outline);
}
.task-drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.task-drawer-empty {
  flex: 1;
  justify-content: center;
  min-height: 300px;
}
/* 空态 */
.step-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; min-height: 300px; gap: 10px; padding: 46px;
  animation: fadeIn 0.3s var(--ease-out);
}
.empty-visual {
  width: 72px; height: 72px; border-radius: 22px;
  background: var(--bg-1); color: var(--accent);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 8px;
}
.empty-title { font-size: 22px; font-weight: 700; font-family: var(--font-display); color: var(--text-0); }
.empty-desc { font-size: 13px; color: var(--text-2); max-width: 420px; text-align: center; line-height: 1.8; }
/* 任务行图片放大预览 */
.gen-task-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--scrim);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.gen-task-viewer {
  position: relative;
  max-width: min(880px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-task-viewer img {
  max-width: 100%;
  max-height: 80vh;
  border-radius: 10px;
  box-shadow: var(--shadow-xl);
}
.gen-task-viewer figcaption {
  text-align: center;
  font-size: 12px;
  color: var(--text-2);
}
.gen-task-viewer-close {
  position: absolute;
  top: -6px;
  right: -6px;
  background: var(--panel-bg);
  border: 1px solid var(--surface-outline);
}
@media (max-width: 860px) {
  .task-drawer-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .task-drawer-head-actions {
    align-self: flex-end;
  }
  .video-task-row {
    grid-template-columns: 56px minmax(0, 1fr);
  }
}
</style>
