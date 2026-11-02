import { expect, it, vi } from 'vitest'
import api from '@/api/index'
import { exportPurchaseGroups } from '@/api/procurement-groups'
vi.mock('@/api/index', () => ({ default: { post: vi.fn() } }))
it('decodes a blob error so stale selections show the server error code', async () => {
  const error = { code: 'purchase_groups_changed' }
  vi.mocked(api.post).mockRejectedValue({} as Blob)
  // jsdom Blob lacks text(); a real HTTP Blob exposes it.
  const body = Object.assign(new Blob(), { text: async () => JSON.stringify(error) })
  vi.mocked(api.post).mockRejectedValue(body)
  await expect(exportPurchaseGroups({ queue: 'procurement', mode: 'filtered' })).rejects.toEqual(error)
})
