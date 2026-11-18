import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DataSource } from 'typeorm'
import { collectedWhere } from './collected-workbench-query'

const database = process.env.ALLOCATION_QUERY_TEST_DB
const integration = database?.startsWith('hz_ddl_validation_') ? describe : describe.skip
integration('allocation queue source-state regression in PostgreSQL', () => {
  let db: DataSource
  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 55432, username: 'autoflow_demo', database,
      password: readFileSync(resolve(__dirname, '../../../../.runtime/local-demo/database-password'), 'utf8').trim(), synchronize: false })
    await db.initialize()
  })
  afterAll(async () => { if (db?.isInitialized) await db.destroy() })
  const allocation = (status = 'B', readiness: string | null = 'completed', association = 'verified') => ({
    batch_id: 'batch', entity_type: 'allocation', display: { sourceOrderId: 'order', rawBillStatus: status, rawAllocationStatus: readiness, association: { state: association } },
  })
  async function ids(queue: string, entity = allocation(), patch = {}, completed = false, employees = ['employee']) {
    const q = collectedWhere('batch', employees, { queue, completed })
    const order = { batch_id: 'batch', source_id: 'order', owner_employee_id: 'employee', raw_bill_status: 'C', raw_delivery_status: null, ...patch }
    // CTE fixtures shadow the source tables; this test cannot mutate captured business data.
    const result = await db.query(`WITH hz_fop_collected_orders AS (
      SELECT * FROM jsonb_to_recordset($3::jsonb) AS o(batch_id text,source_id text,owner_employee_id text,raw_bill_status text,raw_delivery_status text)),
      hz_fop_collected_entities AS (
      SELECT * FROM jsonb_to_recordset($4::jsonb) AS a(batch_id text,entity_type text,display jsonb))
      SELECT source_id FROM hz_fop_collected_orders WHERE ${q.where}`, [...q.params, JSON.stringify([order]), JSON.stringify([entity])])
    return result.map((r: { source_id: string }) => r.source_id)
  }
  it.each(['A', 'B'])('shows ready, unaudited %s when the fulfillment API omits outbound status', async status => {
    expect(await ids('allocation_review', allocation(status))).toEqual(['order'])
    expect(await ids('allocation', allocation(status))).toEqual([])
  })
  it.each(['pending', 'available'])('retains incomplete %s without borrowing an outbound default', async readiness => {
    expect(await ids('allocation', allocation('B', readiness))).toEqual(['order'])
    expect(await ids('allocation_review', allocation('B', readiness))).toEqual([])
  })
  it('moves audited allocations out of both pending queues', async () => {
    expect(await ids('allocation_review', allocation('C'))).toEqual([])
    expect(await ids('allocation', allocation('C'))).toEqual([])
    expect(await ids('allocation_review', allocation('C'), {}, true)).toEqual(['order'])
  })
  it.each([allocation('B', null), allocation('B', 'error'), allocation('B', 'voided'), allocation('D'), allocation('B', 'completed', 'unresolved')])('never treats missing/invalid allocation facts as ready: %j', async entity => {
    expect(await ids('allocation_review', entity)).toEqual([])
  })
  it('keeps parent audit, owner, batch and source relation boundaries', async () => {
    expect(await ids('allocation_review', allocation(), { raw_bill_status: 'B' })).toEqual([])
    expect(await ids('allocation_review', allocation(), { owner_employee_id: 'foreign' })).toEqual([])
    expect(await ids('allocation_review', allocation(), {}, false, [])).toEqual([])
    expect(await ids('allocation_review', { ...allocation(), batch_id: 'other' })).toEqual([])
    expect(await ids('allocation_review', { ...allocation(), display: { ...allocation().display, sourceOrderId: 'other' } })).toEqual([])
  })
})
