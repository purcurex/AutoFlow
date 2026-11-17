import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { dashboardAnalyticsQuery } from './dashboard-analytics-query'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg')
const integration = process.env.RUN_DASHBOARD_PAYMENT_DATE_SQL_TEST === '1' ? describe : describe.skip

integration('dashboard receipt date diagnostics in PostgreSQL TEMP tables', () => {
  let client: any
  const input = { batchId: 'b', companyId: '100000', employeeIds: ['alice'], members: [], start: '2026-11-01', end: '2026-12-01', chartId: 'order_volume', summaryOnly: false }
  async function run(extra = {}) {
    const q = dashboardAnalyticsQuery({ ...input, ...extra })
    return (await client.query(q.sql, q.params)).rows[0].analytics
  }
  beforeAll(async () => {
    const env = parseEnv(readFileSync(resolve(__dirname, '../../../.env.workbench.local'), 'utf8'))
    if (env.DB_HOST !== '127.0.0.1' || env.DB_PORT !== '55432' || env.DB_DATABASE !== 'autoflow_local_demo') throw Error('Local test database required')
    client = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE })
    await client.connect(); await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='15s'")
    await client.query(`CREATE TEMP TABLE hz_fop_collected_analytics_facts(batch_id text,company_id text,entity_type text,source_id text,document_number text,paid_at timestamptz,owner_employee_id text,raw jsonb,facts jsonb,quantity numeric,raw_status text,currency_code text)`)
    // All have a C-end payment date, including the unpaid and undated records.
    const rows = [
      ['dated', '1', 'WH1', 'USD', 'alice', '2026-11-05'],
      ['unpaid', '0', 'WH1', 'USD', 'alice', null],
      ['paid-missing', '1', 'WH1', 'USD', 'alice', null],
      ['unknown', null, 'WH2', 'USD', 'alice', null],
      ['new-status', 'new', 'WH2', 'USD', 'alice', null],
      ['other-currency', '0', 'WH2', 'CNY', 'alice', null],
      ['outside-scope', '1', 'WH1', 'USD', 'bob', null],
    ]
    for (const [id, status, warehouse, currency, owner, paidAt] of rows) {
      await client.query(`INSERT INTO hz_fop_collected_analytics_facts VALUES('b','100000','fulfillment',$1,$1,$2,$3,$4,$5,1,'C',$6)`, [id, paidAt, owner,
        JSON.stringify({ hzkj_receipt_status: status, hzkj_receipt_date: paidAt, hzkj_datetimefield: '2026-11-03 12:00:00', hzkj_settlecurrency_number: currency }),
        JSON.stringify({ warehouse: { number: warehouse }, scope: { verified: true, companyId: '100000' }, sourceOwnershipVerified: true }), currency])
    }
  })
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end() } })
  it('separates unpaid, paid-but-undated and unknown without using C-end payment or bill approval', async () => {
    expect(await run()).toMatchObject({ orderCount: 1, missingPaidAtCount: 5, missingPaidAtBreakdown: { unpaid: 2, paid: 1, unknown: 2 } })
  })
  it('applies the same warehouse and currency scope to undated counts', async () => {
    expect(await run({ warehouseCode: 'WH1' })).toMatchObject({ orderCount: 1, missingPaidAtCount: 2, missingPaidAtBreakdown: { unpaid: 1, paid: 1, unknown: 0 } })
    expect(await run({ warehouseCode: 'WH2', currency: 'USD' })).toMatchObject({ orderCount: 0, missingPaidAtCount: 2, missingPaidAtBreakdown: { unpaid: 0, paid: 0, unknown: 2 } })
    expect(await run({ employeeIds: [] })).toMatchObject({ orderCount: 0, missingPaidAtCount: 0, missingPaidAtBreakdown: { unpaid: 0, paid: 0, unknown: 0 } })
  })
  it('does not assign undated records to the selected payment period', async () => {
    expect(await run({ start: '2026-10-01', end: '2026-11-01' })).toMatchObject({ orderCount: 0, missingPaidAtCount: 5, missingPaidAtBreakdown: { unpaid: 2, paid: 1, unknown: 2 } })
  })
})
