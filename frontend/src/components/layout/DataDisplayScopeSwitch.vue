<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
const users = useUserStore()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const saving = ref(false), error = ref('')
const manager = computed(() => users.user?.role === 'user' && users.user.businessRole === 'department_manager')
async function change(event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value as 'department' | 'self'
  if (saving.value || value === (users.user?.dataDisplayScope ?? 'self')) return
  saving.value = true; error.value = ''
  try { await users.updateProfile({ dataDisplayScope: value }) }
  catch { error.value = zh.value ? '保存失败，请重试' : 'Could not save. Try again.' }
  finally { saving.value = false; select.value = users.user?.dataDisplayScope ?? 'self' }
}
</script>
<template>
  <div v-if="manager" class="relative" :aria-busy="saving">
    <select :value="users.user?.dataDisplayScope ?? 'self'" :disabled="saving" :aria-label="zh ? '全局数据展示范围' : 'Global data scope'" :title="zh ? '保存后对首页、工作台和统计全局生效' : 'Applies to home, workbenches and analytics'" class="h-9 max-w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]" @change="change">
      <option value="self">{{ zh ? '个人数据' : 'Personal' }}</option>
      <option value="department">{{ zh ? '部门数据' : 'Department' }}</option>
    </select>
    <p v-if="error" role="alert" class="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-red-50 px-2 py-1 text-xs text-red-700">{{ error }}</p>
  </div>
</template>
