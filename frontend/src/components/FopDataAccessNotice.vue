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
  if (access.value?.source === 'mock') return text('MOCK · 演示数据 · 按当前账号权限展示', 'MOCK · Demo data · Scoped to your account access')
  switch (access.value?.status) {
    case 'ready': return text('仅显示当前 FOP 用户获授权的数据', 'Only data authorized for your FOP user is shown')
    case 'unbound': return text('未绑定 FOP 用户 · 请联系管理员绑定员工账号', 'FOP user not linked · Contact an administrator')
    case 'not_configured': return text('已绑定 · FOP 权限接口待接通', 'Linked · FOP permissions integration pending')
    case 'denied': return text('FOP 数据访问未获授权', 'FOP data access denied')
    default: return text('暂时无法确认 FOP 数据权限', 'FOP data permissions could not be verified')
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
    <div><p class="font-semibold">{{ text('用户数据权限', 'User data access') }} · {{ loading ? text('正在核验…', 'Checking…') : status }}</p><p v-if="access?.businessScope" class="mt-1 font-medium">{{ text('数据范围', 'Data scope') }}：{{ access.businessScope.role === 'none' ? text('无业务数据权限', 'No business data access') : access.businessScope.role === 'admin' ? text('管理员 · 全部业务数据', 'Administrator · All business data') : access.businessScope.role === 'department_manager' ? text('部门经理 · 本部门及子部门', 'Department manager · Department and teams') : text('业务员 · 仅本人数据', 'Salesperson · Own records') }}</p><p v-if="access?.binding && access.source !== 'mock'" class="mt-1">{{ text('租户', 'Tenant') }} {{ access.binding.tenantId }} / FOP {{ text('用户', 'user') }} {{ access.binding.userId }}</p><p v-if="access?.source === 'mock'" class="mt-1">{{ text('组织、员工、商品与订单均为演示数据，组织架构由系统管理员维护。', 'Organizations, employees, products and orders are demo data. System administrators maintain the organization structure.') }}</p></div>
    <button class="shrink-0 text-indigo-600 dark:text-indigo-300" :disabled="loading" @click="refresh(true)">{{ text('核验绑定', 'Check binding') }}</button>
  </aside>
</template>
