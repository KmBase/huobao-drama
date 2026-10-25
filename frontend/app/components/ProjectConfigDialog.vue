<template>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog ep-dialog">
      <div class="dialog-head">
        <div class="dialog-title">{{ isCreate ? t('index.createDialog.title') : t('detail.config.title') }}</div>
        <button class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="field">
          <span class="field-label">{{ t('detail.config.cover') }}</span>
          <div class="cover-edit">
            <img v-if="form.thumbnail" :src="form.thumbnail" class="cover-edit-img" :alt="t('detail.config.cover')" @click="previewSrc = form.thumbnail" />
            <div v-else class="cover-edit-empty">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
              <span>{{ t('detail.config.coverEmpty') }}</span>
            </div>
            <div class="cover-edit-actions">
              <label class="btn btn-sm" :class="{ disabled: uploadingCover }">
                <svg v-if="uploadingCover" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {{ uploadingCover ? t('detail.config.coverUploading') : t('detail.config.coverUpload') }}
                <input type="file" accept="image/*" class="visually-hidden" :disabled="uploadingCover" @change="onCoverFile" />
              </label>
              <button v-if="form.thumbnail" class="btn btn-sm btn-danger" @click="form.thumbnail = ''">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                {{ t('detail.config.coverRemove') }}
              </button>
            </div>
          </div>
          <span class="field-hint">{{ t('detail.config.coverHint') }}</span>
        </div>
        <label class="field">
          <span class="field-label">{{ t('detail.config.name') }} <span v-if="isCreate" class="required">*</span></span>
          <input v-model="form.title" class="input" :placeholder="isCreate ? t('index.createDialog.namePlaceholder') : t('detail.config.namePlaceholder')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('detail.config.language') }}</span>
          <BaseSelect v-model="form.language" :options="languageOptions" :placeholder="t('detail.config.languagePlaceholder')" />
          <span class="field-hint">{{ t('detail.config.languageHint') }}</span>
        </label>
        <label class="field">
          <span class="field-label">{{ t('detail.config.visualStyle') }}</span>
          <BaseSelect v-model="form.style" :options="styleOptions" :placeholder="t('detail.config.stylePlaceholder')" searchable />
        </label>
        <label class="field">
          <span class="field-label">{{ t('detail.config.scriptStyle') }}</span>
          <BaseSelect v-model="form.style_pack" :options="packOptions" :placeholder="t('detail.config.packPlaceholder')" searchable />
          <span class="field-hint">{{ t('detail.config.packHint') }}</span>
        </label>
        <label v-if="isCreate" class="field">
          <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
          <BaseSelect v-model="form.aspect_ratio" :options="aspectRatioOptions" :placeholder="t('index.createDialog.aspectRatioPlaceholder')" />
          <span class="field-hint">{{ t('index.createDialog.aspectRatioHint') }}</span>
        </label>
        <label class="field">
          <span class="field-label">{{ t('detail.config.status') }}</span>
          <BaseSelect v-model="form.status" :options="statusOptions" />
        </label>

        <!-- 生成模型：项目级覆盖，空 = 跟随 AI 配置默认 -->
        <div class="field model-section">
          <span class="field-label">{{ t('detail.config.modelSection') }}</span>
          <label class="field model-field">
            <span class="model-field-label">{{ t('common.serviceType.text') }}</span>
            <BaseSelect v-model="form.model_chat" :options="chatOptions" :placeholder="t('detail.config.modelPlaceholder')" searchable />
          </label>
          <label class="field model-field">
            <span class="model-field-label">{{ t('common.serviceType.image') }}</span>
            <BaseSelect v-model="form.model_image" :options="imageOptions" :placeholder="t('detail.config.modelPlaceholder')" searchable />
          </label>
          <label class="field model-field">
            <span class="model-field-label">{{ t('common.serviceType.video') }}</span>
            <BaseSelect v-model="form.model_video" :options="videoOptions" :placeholder="t('detail.config.modelPlaceholder')" searchable />
          </label>
          <span class="field-hint">{{ t('detail.config.modelHint') }}</span>
        </div>
        <label class="field">
          <span class="field-label">{{ t('detail.config.resolution') }}</span>
          <BaseSelect v-model="form.resolution" :options="resolutionOptions" :searchable="false" />
          <span class="field-hint">{{ t('detail.config.resolutionHint') }}</span>
        </label>
      </div>
      <div class="dialog-foot">
        <button class="btn" @click="close">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          <svg v-if="saving" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          {{ saving ? t('detail.config.saving') : (isCreate ? t('index.createDialog.submit') : t('common.save')) }}
        </button>
      </div>
    </div>
  </div>
  <!-- 封面预览 -->
  <div v-if="previewSrc" class="overlay viewer-overlay" @click.self="previewSrc = ''">
    <img :src="previewSrc" :alt="t('detail.config.cover')" class="viewer-img" />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { dramaAPI, stylePresetAPI, stylePackAPI, aiConfigAPI, uploadAPI } from '~/composables/useApi'
import { UI_LOCALES } from '~/composables/i18n'
import { collectModelOptions, hasMultiConfigs, modelOptionLabel } from '~/composables/useModelOptions'
import BaseSelect from '~/components/BaseSelect.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** 'edit'（默认）：更新现有项目；'create'：新建项目并 emit('created') */
  mode: { type: String, default: 'edit' },
  /** 已加载的项目记录（edit 模式页面侧负责获取，弹窗不重复请求） */
  drama: { type: Object, default: null },
  dramaId: { type: Number, default: 0 },
})
const emit = defineEmits(['update:open', 'saved', 'created'])

const { t } = useI18n()

const isCreate = computed(() => props.mode === 'create')
const saving = ref(false)
const uploadingCover = ref(false)
const previewSrc = ref('')
const blankForm = () => ({
  title: '', style: '', style_pack: '', status: 'draft', thumbnail: '', language: '',
  aspect_ratio: '16:9', resolution: '720p', model_chat: '', model_image: '', model_video: '',
})
const form = reactive(blankForm())

const stylePresets = ref([])
const stylePacks = ref([])
const textConfigs = ref([])
const imageConfigs = ref([])
const videoConfigs = ref([])

const styleOptions = computed(() => stylePresets.value.map(p => ({ label: p.name, value: p.value })))
const packOptions = computed(() => stylePacks.value.map(p => ({ label: p.name, value: p.value })))
const statusOptions = computed(() => ([
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
const languageOptions = UI_LOCALES.map(l => ({ label: l.label, value: l.value }))
const aspectRatioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))
const resolutionOptions = computed(() => ([
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
]))

function optionItems(cfgs) {
  const options = collectModelOptions(cfgs)
  const multi = hasMultiConfigs(options)
  return options.map(o => ({ label: modelOptionLabel(o, multi), value: o.key }))
}
const chatOptions = computed(() => optionItems(textConfigs.value))
const imageOptions = computed(() => optionItems(imageConfigs.value))
const videoOptions = computed(() => optionItems(videoConfigs.value))

// 打开时填表：create 用空白默认值；edit 从项目记录带出。AI 配置/风格数据懒加载一次后复用
watch(() => props.open, (open) => {
  if (!open) return
  if (isCreate.value) {
    Object.assign(form, blankForm())
  } else {
    const d = props.drama || {}
    form.title = d.title || ''
    form.style = d.style || ''
    form.style_pack = d.style_pack || ''
    form.status = d.status || 'draft'
    form.thumbnail = d.thumbnail || ''
    form.language = d.language || ''
    form.resolution = d.resolution || '720p'
    form.model_chat = d.model_chat || ''
    form.model_image = d.model_image || ''
    form.model_video = d.model_video || ''
  }
  if (!stylePresets.value.length) stylePresetAPI.list().then(rows => { stylePresets.value = rows || [] }).catch(() => {})
  if (!stylePacks.value.length) stylePackAPI.list().then(rows => { stylePacks.value = rows || [] }).catch(() => {})
  if (!textConfigs.value.length) {
    Promise.all([aiConfigAPI.list('text'), aiConfigAPI.list('image'), aiConfigAPI.list('video')])
      .then(([txt, img, vid]) => { textConfigs.value = txt || []; imageConfigs.value = img || []; videoConfigs.value = vid || [] })
      .catch(() => {})
  }
})

function close() {
  emit('update:open', false)
}

async function onCoverFile(e) {
  const input = e.target
  const file = input.files?.[0]
  if (!file) return
  try {
    uploadingCover.value = true
    const res = await uploadAPI.image(file)
    form.thumbnail = res.url
  } catch (err) {
    toastError(err)
  } finally {
    uploadingCover.value = false
    input.value = ''
  }
}

function configPayload() {
  return {
    title: form.title.trim(),
    style: form.style || null,
    style_pack: form.style_pack || null,
    status: form.status,
    thumbnail: form.thumbnail || null,
    language: form.language || null,
    resolution: form.resolution || '720p',
    model_chat: form.model_chat || null,
    model_image: form.model_image || null,
    model_video: form.model_video || null,
  }
}

async function save() {
  if (!form.title.trim()) {
    toast.warning(t('detail.config.nameRequired'))
    return
  }
  try {
    saving.value = true
    if (isCreate.value) {
      // 后端 create 固定 status='draft'，非草稿创建后补一次更新
      const d = await dramaAPI.create({ ...configPayload(), aspect_ratio: form.aspect_ratio || '16:9' })
      if (form.status && form.status !== 'draft') await dramaAPI.update(d.id, { status: form.status })
      toast.success(t('index.created'))
      close()
      emit('created', d)
    } else {
      await dramaAPI.update(props.dramaId, configPayload())
      toast.success(t('detail.config.saved'))
      close()
      emit('saved')
    }
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<!-- 弹窗骨架(.dialog/.overlay/.animate-spin)来自全局 studio.css；其余页面级类此处自带 -->
<style scoped>
.ep-dialog { width: min(480px, calc(100vw - 32px)); }

.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.cover-edit { display: flex; align-items: center; gap: 14px; }
.cover-edit-img {
  width: 120px; height: 68px; object-fit: cover;
  border-radius: var(--radius); border: 1px solid var(--border);
  cursor: zoom-in;
}
.cover-edit-empty {
  width: 120px; height: 68px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  border: 1px dashed var(--border-strong); border-radius: var(--radius);
  color: var(--text-3); font-size: 10.5px;
}
.cover-edit-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.cover-edit-actions .btn { position: relative; overflow: hidden; }
.cover-edit-actions .btn.disabled { opacity: 0.6; pointer-events: none; }
.cover-edit-actions .btn.btn-danger { color: var(--danger, #e05555); }

.model-section { gap: 10px; }
.model-field { gap: 4px; }
.model-field-label { font-size: 11px; color: var(--text-2); }

.viewer-overlay { align-items: center; justify-content: center; }
.viewer-img { width: 100%; max-height: 90vh; object-fit: contain; border-radius: var(--radius); }
</style>
