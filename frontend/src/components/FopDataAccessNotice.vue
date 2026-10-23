<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getFopDataAccess, type FopDataAccess } from '@/api/fop-access'
const emit = defineEmits<{ recheck: [] }>()
const { locale } = useI18n()
const route = useRoute()
const zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const access = ref<FopDataAccess>()
const loading = ref(false)
let requestId = 0
const status = computed(() => {
  if (access.value?.source === 'mock') return text('演示数据', 'Demo data')
  switch (access.value?.status) {
    case 'ready': return text('已连接', 'Connected')
    case 'unbound': return text('员工账号尚未关联，请联系管理员', 'Employee account not linked · Contact an administrator')
    case 'not_configured': return text('业务数据服务尚未接通', 'Business data service not connected')
    case 'denied': return text('暂时无法查看业务数据，请联系管理员', 'Business data unavailable · Contact an administrator')
    default: return text('暂时无法加载，请稍后重试', 'Unable to load · Please retry later')
  }
})
async function refresh(recheck = false) {
  if (recheck) emit('recheck')
  const id = ++requestId
  access.value = undefined
  loading.value = true
  try {
    const result = await getFopDataAccess()
    if (id === requestId) access.value = result
  } catch { /* Unknown access stays closed; no cached identity is displayed. */ }
  finally { if (id === requestId) loading.value = false }
}
watch(() => route.fullPath, () => refresh(), { immediate: true })
onBeforeUnmount(() => { requestId++ })
</script>

<template>
  <aside class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" aria-live="polite">
    <div><p class="font-semibold">{{ text('业务数据', 'Business data') }} · {{ loading ? text('正在加载…', 'Loading…') : status }}</p><p v-if="access?.businessScope" class="mt-1 font-medium">{{ text('业务范围', 'Business scope') }}：{{ access.businessScope.role === 'none' ? text('尚未开通', 'Not enabled') : access.businessScope.role === 'admin' ? text('当前账号可查看的业务', 'Business available to your account') : access.businessScope.role === 'department_manager' ? text('本部门及下级', 'My department and teams') : text('我的业务', 'My business') }}</p><p v-if="access?.source === 'mock'" class="mt-1">{{ text('当前展示演示数据，便于体验各项功能。', 'Demo data is shown so you can explore the features.') }}</p></div>
    <button class="shrink-0 text-indigo-600 dark:text-indigo-300" :disabled="loading" @click="refresh(true)">{{ text('刷新状态', 'Refresh status') }}</button>
  </aside>
</template>
