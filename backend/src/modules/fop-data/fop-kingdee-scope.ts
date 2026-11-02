import { FopPermissionDeniedError } from './fop-data.types'

/** 金蝶响应的部门链必须从业务组织到当前部门，不能用重复、断头或其他部门的链扩权。 */
export function kingdeeDepartmentPath(value: unknown, organizationId: string, departmentId: string, required = false): string[] | undefined {
  if (value === undefined && !required) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 64
    || value.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id))
    || new Set(value).size !== value.length || value[0] !== organizationId || value[value.length - 1] !== departmentId) {
    throw new FopPermissionDeniedError('Invalid Kingdee department ancestry')
  }
  return [...value] as string[]
}
