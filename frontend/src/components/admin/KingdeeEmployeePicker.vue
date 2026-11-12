<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fopAccessError, getFopBindingEmployees, type FopBindingEmployee, type FopEmployeeSelection } from '@/api/fop-access'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'

const props = defineProps<{ modelValue: FopEmployeeSelection | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: FopEmployeeSelection | null]; busy: [value: boolean] }>()
const { locale } = useI18n(), zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const employees = ref<FopBindingEmployee[]>([]), search = ref(''), error = ref(''), loading = ref(false), loaded = ref(false)
const cursor = ref<string | null>(null), version = ref('')
const visible = computed(() => employees.value.filter(row => `${row.employeeNumber ?? ''} ${row.name} ${row.username}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const selected = computed(() => props.modelValue ? `${props.modelValue.employeeId}:${props.modelValue.membershipId}` : '')
let active = true, requestId = 0

/** 按服务端游标加载，账号切换后丢弃旧目录；筛选仅针对已加载人员，不承诺全目录搜索。 */
async function load(more = false) {
  if (loading.value || props.disabled || more && !cursor.value) return
  const request = ++requestId, session = captureSession()
  loading.value = true; emit('busy', true); error.value = ''
  try {
    const page = await getFopBindingEmployees(more ? { cursor: cursor.value!, scopeVersion: version.value } : {})
    assertCurrentSession(session)
    if (!active || request !== requestId) return
    const rows = more ? [...employees.value] : [], keys = new Set(rows.map(row => `${row.id}:${row.membershipId}`))
    for (const row of page.items) { const key = `${row.id}:${row.membershipId}`; if (!keys.has(key)) { rows.push(row); keys.add(key) } }
    employees.value = rows; cursor.value = page.nextCursor; version.value = page.scopeVersion; loaded.value = true
    if (!more) emit('update:modelValue', null)
  } catch (cause) { if (active && request === requestId) error.value = fopAccessError(cause, zh.value) }
  finally { if (active && request === requestId) { loading.value = false; emit('busy', false) } }
}
function choose(event: Event) {
  const key = (event.target as HTMLSelectElement).value
  const row = employees.value.find(item => `${item.id}:${item.membershipId}` === key)
  emit('update:modelValue', row && row.state === 'active' && row.username && row.employeeNumber ? { employeeId: row.id, membershipId: row.membershipId, employeeNumber: row.employeeNumber } : null)
}
const off = onSessionReset(() => { active = false; requestId++; employees.value = []; emit('update:modelValue', null) })
onBeforeUnmount(() => { active = false; requestId++; emit('busy', false); off() })
</script>

<template>
  <div class="space-y-3">
    <p v-if="error" class="org-error" role="alert">{{ error }}</p>
    <button type="button" class="btn btn-secondary" :disabled="loading || disabled" @click="load(false)">{{ loading ? text('正在读取金蝶员工…', 'Loading Kingdee employees…') : loaded ? text('刷新金蝶员工', 'Refresh Kingdee employees') : text('读取金蝶员工', 'Load Kingdee employees') }}</button>
    <template v-if="loaded">
      <label class="block"><span class="field-label">{{ text('筛选已加载员工', 'Filter loaded employees') }}</span><input v-model="search" class="input" :aria-label="text('筛选已加载员工', 'Filter loaded employees')" :placeholder="text('工号 / 姓名 / 用户名', 'Employee number / Name / Username')" :disabled="disabled || loading" /></label>
      <label class="block"><span class="field-label">{{ text('对应金蝶员工', 'Kingdee employee') }}</span>
        <select class="input" :value="selected" :aria-label="text('对应金蝶员工', 'Kingdee employee')" :disabled="disabled || loading" @change="choose">
          <option value="">{{ text('请选择金蝶员工', 'Choose a Kingdee employee') }}</option>
          <option v-for="row in visible" :key="`${row.id}:${row.membershipId}`" :value="`${row.id}:${row.membershipId}`" :disabled="row.state !== 'active' || !row.username || !row.employeeNumber">{{ row.employeeNumber || text('工号缺失', 'Missing employee number') }} · {{ row.name }} · {{ row.username }}<template v-if="employees.filter(item => item.id === row.id).length > 1"> · {{ text('FOP部门', 'FOP department') }} {{ row.departmentId }} · {{ text('任职', 'Membership') }} {{ row.membershipId }}</template>{{ row.state !== 'active' ? text('（不可用）', ' (Unavailable)') : '' }}</option>
        </select>
      </label>
      <button v-if="cursor" type="button" class="btn btn-secondary" :disabled="disabled || loading" @click="load(true)">{{ text('加载更多员工', 'Load more employees') }}</button>
    </template>
  </div>
</template>
