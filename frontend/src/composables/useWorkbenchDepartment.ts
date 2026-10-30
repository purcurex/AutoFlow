import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkbenchAccess } from './useWorkbenchAccess'

// Labels only: the empty filter continues to mean the full server-authorized scope.
// Never infer access from system-admin status or fetch an unscoped organization tree.
export function useWorkbenchDepartment(labels?: Ref<Record<string, string>>) {
  const { access } = useWorkbenchAccess()
  const { locale } = useI18n()
  const defaultDepartmentLabel = computed(() => {
    const zh = String(locale.value).startsWith('zh')
    const role = access.value?.businessRole
    if (role === 'admin' || !role) return zh ? '营销中心' : 'Marketing Center'
    const department = access.value?.businessDepartment
    return (department && (department.name || labels?.value[department.id])) || (zh ? '本部门' : 'My department')
  })
  return { defaultDepartmentLabel }
}
