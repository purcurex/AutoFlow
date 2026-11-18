import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'

it('keeps exception fields and products while withholding the unused internal sync snapshot', async () => {
  const snapshot = { originalPayload: 'internal-record'.repeat(1000) }
  const display = { id: 'o1', orderNumber: 'TO1', items: [], amount: 23.5, currency: 'USD', timestampProjection: snapshot,
    exception: { type: 'allocation_exception', reason: '配货单报错', hours: null } }
  const db = { query: jest.fn(async () => [{ total: 1, quantity: 0, countries: [], rows: [{ display, raw: {} }] }]) }
  const service = new CollectedWorkbenchService(db as any, {} as any, new ConfigService())
  jest.spyOn(service as any, 'context').mockResolvedValue({ user: { role: 'admin' }, filter: { employeeIds: [] }, org: { employeeIds: [], members: [], departments: [] },
    batch: { id: 'b', company_id: '100000', metadata: {} }, signature: 'stable' })
  const result = await service.orders('u', { queue: 'exceptions' }, 'sales')
  expect(result.items[0].timestampProjection).toBeUndefined()
  expect(result.items[0]).toMatchObject({ id: 'o1', orderNumber: 'TO1', items: [], exception: { type: 'allocation_exception', reason: '配货单报错' } })
  expect(display.timestampProjection).toBe(snapshot)
  expect(result.total).toBe(1)
})
