import { describe, expect, it } from 'vitest'
import router from '@/router'

describe('retired business record routes', () => {
  it.each(['/admin', '/notes/existing-record'])('does not expose the retired page %s', path => {
    expect(router.resolve(path).name).toBe('NotFound')
  })

  it('preserves account administration and the active workbench routes', () => {
    expect(router.resolve('/admin/workbenches').name).toBe('WorkbenchRoleAdmin')
    expect(router.resolve('/dashboard').name).toBe('FopDashboard')
    for (const role of ['sales', 'dispatch', 'procurement', 'allocation', 'warehouse']) {
      expect(router.resolve(`/workbench/${role}`).name).toBe('RoleWorkbench')
    }
  })
})
