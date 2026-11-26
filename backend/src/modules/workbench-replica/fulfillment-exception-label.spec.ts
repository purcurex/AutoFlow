import { Workbook } from 'exceljs'
import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
import { getTaskStatus, taskStatusLabel } from '../fop-data/workbench-status'
import { hasDispatchException } from '../fop-data/order-dispatch-status'

it('uses the fulfillment exception label and preserves a supplied failure reason in Excel', async () => {
  const service = new CollectedWorkbenchService({} as any, {} as any, new ConfigService())
  jest.spyOn(service as any, 'context').mockResolvedValue({ user: { sessionVersion: 2 }, batch: { id: 'b', source_as_of: '2026-11-25T00:00:00Z' }, signature: 'same' })
  const row = { id: '1', orderNumber: 'TO261125000001', items: [], exception: { type: 'dispatch_exception', reason: '获取跟踪号失败', hours: null } }
  jest.spyOn(service, 'orders').mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 100, replica: { readMode: 'local', datasetId: 'b', revision: 'r' } } as any)
  expect(taskStatusLabel(getTaskStatus(row as any, 'exceptions'), 'exceptions')).toEqual(['履约异常', 'Fulfillment exception'])
  const buffer = await service.export('admin', { queue: 'exceptions', mode: 'filtered' }, 2, 'orders')
  const workbook = new Workbook(); await workbook.xlsx.load(buffer as any)
  const values: string[] = []; workbook.worksheets[0].eachRow(r => r.eachCell(c => values.push(String(c.value))))
  expect(values).toContain('履约异常')
  expect(values).toContain('获取跟踪号失败')
})

it('does not infer a carrier rejection from a pending dispatch with no tracking', () => {
  expect(hasDispatchException({ reviewStatus: 'approved', businessStatus: { order: 'processing', sourceShipment: 'unfulfilled' },
    dispatchDocuments: [{ number: 'FY1', association: { state: 'verified' }, deliveryStatus: 'PENDING', trackingNumbers: [] }] })).toBe(false)
})
