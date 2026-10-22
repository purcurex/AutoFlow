export const WORKBENCH_ROLES = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'] as const
export type WorkbenchRole = typeof WORKBENCH_ROLES[number]

export function isWorkbenchRole(value: unknown): value is WorkbenchRole {
  return typeof value === 'string' && WORKBENCH_ROLES.includes(value as WorkbenchRole)
}
