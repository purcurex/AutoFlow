export const BUSINESS_DEPARTMENT_NAMES = ['业务一部', '业务二部', '业务三部', '业务四部'] as const
export interface MarketingScope { rootId: string | null; departmentIds: string[] }

/** Resolve the real hierarchy before personal/department authorization hides ancestors. */
export function marketingDepartments(nodes: readonly { id: string; name: string; parentId: string | null }[]): MarketingScope {
  const roots = nodes.filter(node => node.name === '营销中心')
  if (roots.length !== 1) return { rootId: null, departmentIds: [] }
  const rootId = roots[0].id
  const departments = nodes.filter(node => node.parentId === rootId && (BUSINESS_DEPARTMENT_NAMES as readonly string[]).includes(node.name))
  if (new Set(departments.map(node => node.name)).size !== departments.length) return { rootId: null, departmentIds: [] }
  return { rootId, departmentIds: departments.map(node => node.id) }
}
