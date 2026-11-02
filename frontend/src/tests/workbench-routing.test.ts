import { beforeEach, describe, expect, it, vi } from 'vitest'
import router from '@/router'
import { getWorkbenchAccess } from '@/api/workbench-access'

vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn().mockResolvedValue({ roles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], isAdmin: false }) }))

describe('role workbench navigation', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], isAdmin: false })
  })

  it.each([
    ['unpaid', 'sales'], ['review', 'sales'], ['exceptions', 'sales'], ['procurement', 'procurement'],
    ['allocation', 'allocation'], ['allocation_review', 'allocation'], ['procurement_shipping', 'procurement'], ['dispatch', 'dispatch'], ['shipping', 'warehouse'],
  ])('moves the old %s detail link into the %s workbench, preserving filters', async (queue, role) => {
    await router.push(`/dashboard/orders?queue=${queue}&orderNumber=DEMO-SO-10241&search=Northstar&page=2`)
    expect(router.currentRoute.value.name).toBe('RoleWorkbench')
    expect(router.currentRoute.value.params.role).toBe(role)
    expect(router.currentRoute.value.query).toMatchObject({ queue, orderNumber: 'DEMO-SO-10241', search: 'Northstar', page: '2' })
  })

  it('keeps workbench routes behind the existing login requirement', async () => {
    localStorage.clear()
    await router.push('/workbench/warehouse?queue=shipping')
    expect(router.currentRoute.value.name).toBe('Login')
    expect(router.currentRoute.value.query.redirect).toBe('/workbench/warehouse?queue=shipping')
  })

  it('uses server roles instead of tampered local permissions and rechecks revoked roles', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'admin', workbenchRoles: ['warehouse'] }))
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['warehouse'], isAdmin: false })
    await router.push('/workbench/warehouse?queue=shipping')
    expect(router.currentRoute.value.name).toBe('RoleWorkbench')
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false })
    await router.push('/workbench/warehouse?queue=shipping&page=2')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
  })

  it('guards receipt detail routes with the same role and login access as workbenches', async () => {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['allocation'], isAdmin: false })
    await router.push('/workbench/allocation/receipts?from=2026-10-01&to=2026-10-31')
    expect(router.currentRoute.value.name).toBe('RoleWorkbenchReceipts')
    await router.push('/workbench/sales/receipts')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
    localStorage.clear()
    await router.push('/workbench/allocation/receipts')
    expect(router.currentRoute.value.name).toBe('Login')
  })

  it('lands non-sales users in their own assigned workbench', async () => {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['allocation'], isAdmin: false })
    await router.push('/')
    expect(router.currentRoute.value.params.role).toBe('allocation')
  })
  it('requires an assigned role and login for freight details', async () => {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['dispatch'], isAdmin: false })
    await router.push('/workbench/dispatch/freight?grain=month&year=2026&warehouse=HZ')
    expect(router.currentRoute.value.name).toBe('RoleWorkbenchFreight')
    await router.push('/workbench/sales/freight')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
    localStorage.clear()
    await router.push('/workbench/dispatch/freight')
    expect(router.currentRoute.value.name).toBe('Login')
  })
  it('routes a management-only administrator to account settings and denies business deep links', async () => {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [], isAdmin: true, businessRole: 'none' })
    for (const path of ['/', '/dashboard', '/leads', '/quotes', '/workbench/sales']) {
      await router.push(path)
      expect(router.currentRoute.value.name).toBe('WorkbenchRoleAdmin')
    }
    await router.push('/organization')
    expect(router.currentRoute.value.name).toBe('Organization')
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [], isAdmin: false, businessRole: 'none' })
    await router.push('/dashboard')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
  })

  it('denies organization deep links to business administrators without system management rights', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'admin' }))
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false, businessRole: 'admin' })
    await router.push('/organization')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [], isAdmin: true, businessRole: 'none' })
    await router.push('/organization')
    expect(router.currentRoute.value.name).toBe('Organization')
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false, businessRole: 'salesperson' })
    await router.push('/organization?refresh=1')
    expect(router.currentRoute.value.name).toBe('WorkbenchAccessDenied')
  })

})
