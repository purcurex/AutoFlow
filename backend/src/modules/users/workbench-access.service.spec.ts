import { WorkbenchAccessService } from './workbench-access.service'

describe('salesperson workbench policy', () => {
  const setup = (extra = {}) => new WorkbenchAccessService({ findById: async () => ({ id: 'u', role: 'user', businessRole: 'salesperson', workbenchRoles: ['sales'], ...extra }), workbenchDepartment: async () => null, defaultProcurementView: async () => 'fulfillment' } as any)
  it.each(['sales', 'dispatch', 'procurement', 'allocation', 'warehouse'])('allows %s while keeping the salesperson data role', async role => {
    const access = await setup().requireRole('u', role)
    expect(access.businessRole).toBe('salesperson')
    expect(access.roles).toContain(role)
  })
  it('does not reopen a disabled or explicitly closed account', async () => {
    await expect(setup({ accountDisabled: true }).requireRole('u', 'sales')).rejects.toThrow()
    await expect(setup({ businessRole: 'none', workbenchRoles: [] }).requireRole('u', 'sales')).rejects.toThrow()
  })
})

it('allows explicitly assigned entry without expanding data scope', async () => {
 const { effectiveWorkbenchRoles } = await import('./workbench-role')
 expect(effectiveWorkbenchRoles({ role: 'user', businessRole: 'none', workbenchRoles: ['sales'] } as any)).toEqual(['sales'])
})
