import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkbenchAccess } from './useWorkbenchAccess'

const departmentNames = ['营销中心', '业务一部', '业务二部', '业务三部', '业务四部']
type Department = { id: string; name: string }

// Labels only: the empty filter continues to mean the full server-authorized scope.
// Never infer access from system-admin status or fetch an unscoped organization tree.
export function useWorkbenchDepartment(labels?: Ref<Record<string, string>>) {
  const { access } = useWorkbenchAccess()
  const { locale } = useI18n()
  const ownDepartment = computed(() => {
    if (!['salesperson', 'department_manager'].includes(access.value?.businessRole ?? '')) return null
    const department = access.value?.businessDepartment
    const name = department && (department.name || labels?.value[department.id])
    return department && name && departmentNames.includes(name) ? { id: department.id, name } : null
  })
  const defaultDepartmentLabel = computed(() => {
    const zh = String(locale.value).startsWith('zh')
    const role = access.value?.businessRole
    if (role !== 'salesperson' && role !== 'department_manager') return zh ? '营销中心' : 'Marketing Center'
    return ownDepartment.value?.name || (zh ? '本部门' : 'My department')
  })
  const departmentOptions = (rows: readonly Department[] | undefined) => (rows ?? [])
    .filter(row => departmentNames.includes(row.name) && row.name !== '营销中心' && row.id !== ownDepartment.value?.id)
    .slice().sort((a, b) => departmentNames.indexOf(a.name) - departmentNames.indexOf(b.name))
  // Keep existing explicit bookmarks selected without duplicating the default option.
  const defaultDepartmentValue = (rows: readonly Department[] | undefined, selected: string | undefined) => selected &&
    (selected === ownDepartment.value?.id || rows?.some(row => row.id === selected && row.name === '营销中心')) ? selected : ''
  return { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue }
}
