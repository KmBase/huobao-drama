<template>
  <!-- 页面级顶栏：剧集页与项目页共用，class 名保持 studio-topbar 系列（导览定位依赖 .studio-topbar-main） -->
  <header class="studio-topbar">
    <div class="studio-topbar-main">
      <button class="topbar-back" :title="backLabel || $t('common.back')" @click="navigateTo(backTo)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        <span v-if="backLabel">{{ backLabel }}</span>
      </button>
      <div class="studio-identity">
        <h1 class="studio-title">{{ title }}</h1>
        <slot name="identity" />
        <div v-if="$slots.meta" class="studio-meta-row">
          <slot name="meta" />
        </div>
      </div>
    </div>

    <div class="studio-topbar-side">
      <slot />
    </div>
  </header>
</template>

<script setup>
defineProps({
  backTo: { type: String, required: true },
  /** 返回按钮文字；不传则只显示图标 */
  backLabel: { type: String, default: '' },
  title: { type: String, required: true },
})
</script>

<!-- 非 scoped：右侧动作区来自父页面插槽，按钮/选择器的紧凑化规则要能命中它们 -->
<style>
.studio-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  min-height: 40px;
  padding: 4px 10px;
  border-radius: var(--radius-lg);
  background: var(--header-bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

.studio-topbar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.topbar-back {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--overlay-track);
  color: var(--text-1);
  cursor: pointer;
  white-space: nowrap;
  font-size: 11px;
  transition: background 0.16s var(--ease-out), color 0.16s var(--ease-out);
}
.topbar-back:hover { background: var(--bg-active); color: var(--text-0); }
.topbar-back:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
.topbar-back:has(span) {
  width: auto;
  min-width: 72px;
  padding: 0 12px;
}

.studio-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.studio-title {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.studio-episode-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 9px;
  font-weight: 700;
}

.studio-meta-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  min-width: 0;
}

.studio-meta-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 8px;
  font-weight: 600;
  white-space: nowrap;
}

.studio-meta-pill.is-stage {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.studio-meta-pill.is-progress {
  background: var(--success-bg);
  color: var(--success);
}
.studio-meta-inline {
  font-size: 9px;
  color: var(--text-3);
  font-weight: 600;
  white-space: nowrap;
}

.studio-topbar-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.studio-actions {
  display: flex;
  gap: 6px;
}
.studio-topbar .btn {
  height: 26px;
  padding: 0 9px;
  font-size: 10.5px;
  white-space: nowrap;
}

/* 顶栏任务按钮角标（任务中心/任务抽屉共用） */
.task-drawer-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--action-primary-text);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

@media (max-width: 860px) {
  .studio-topbar-main {
    align-items: flex-start;
  }

  .studio-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .studio-topbar-side {
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .studio-actions {
    flex-wrap: wrap;
  }
}
</style>
