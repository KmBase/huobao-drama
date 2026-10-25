<template>
  <Teleport to="body">
    <div v-if="locked" class="lock-scrim">
      <div class="lock-card">
        <div class="lock-icon"><Lock :size="26" /></div>
        <h2 class="lock-title">{{ t('access.title') }}</h2>
        <p class="lock-desc">{{ t('access.desc') }}</p>
        <form class="lock-form" @submit.prevent="submit">
          <input
            v-model="password"
            class="input"
            type="password"
            autofocus
            :placeholder="t('access.placeholder')"
            :disabled="busy"
          />
          <button class="btn btn-primary" type="submit" :disabled="busy || !password">
            <LogIn :size="14" /> {{ busy ? t('access.unlocking') : t('access.unlock') }}
          </button>
        </form>
        <p v-if="error" class="lock-error">{{ error }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 访问密码锁屏：后端启用密码后，任何 API 401 都会触发显示；
 * 登录成功后整页刷新，让所有已挂载数据源重新拉取。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Lock, LogIn } from 'lucide-vue-next'
import { accessAPI } from '~/composables/useApi'

const { t } = useI18n()
const locked = ref(false)
const password = ref('')
const busy = ref(false)
const error = ref('')

async function probe() {
  try {
    const s = await accessAPI.status()
    locked.value = s.required && !s.authed
  } catch { /* 后端不可达时不弹锁屏 */ }
}

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await accessAPI.login(password.value)
    locked.value = false
    password.value = ''
    location.reload()
  } catch (err: any) {
    error.value = err.message || t('access.wrongPassword')
  } finally {
    busy.value = false
  }
}

const onUnauthorized = () => { locked.value = true }

onMounted(() => {
  window.addEventListener('huobao:unauthorized', onUnauthorized)
  probe()
})
onUnmounted(() => window.removeEventListener('huobao:unauthorized', onUnauthorized))
</script>

<style scoped>
.lock-scrim {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--scrim, rgba(0, 0, 0, 0.55));
  backdrop-filter: blur(6px);
}
.lock-card {
  width: 320px;
  padding: 28px 24px;
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-elevated);
  text-align: center;
}
.lock-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
}
.lock-title {
  margin: 0 0 6px;
  font: 700 16px/1.3 var(--font-body);
  color: var(--text-0);
}
.lock-desc {
  margin: 0 0 16px;
  font: 400 12.5px/1.6 var(--font-body);
  color: var(--text-2);
}
.lock-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lock-form .btn {
  justify-content: center;
}
.lock-error {
  margin: 12px 0 0;
  font: 400 12px/1.5 var(--font-body);
  color: var(--danger, #e5484d);
}
</style>
