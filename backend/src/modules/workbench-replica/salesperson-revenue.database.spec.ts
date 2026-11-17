import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { dashboardAnalyticsQuery } from './dashboard-analytics-query'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg')
const integration = process.env.RUN_SALESPERSON_REVENUE_SQL_TEST === '1' ? describe : describe.skip

integration('salesperson revenue department membership and totals', () => {
  let client: any
  const members = [
    { employeeId: 'a', name: '甲（Alex）', englishName: 'Alex', departmentId: 'd1', departmentName: '业务一部' },
    { employeeId: 'b', name: '乙（Wendy）', englishName: 'Wendy', departmentId: 'd1', departmentName: '业务一部' },
    { employeeId: 'c', name: '丙（Alex）', englishName: 'Alex', departmentId: 'd2', departmentName: '业务二部' },
  ]
  async function run(extra = {}) {
    const q = dashboardAnalyticsQuery({ batchId: 'b', companyId: '100000', employeeIds: ['a','b','c'], members, start: '2026-11-01', end: '2026-12-01', chartId: 'salesperson_receipts', summaryOnly: false, ...extra })
    return (await client.query(q.sql, q.params)).rows[0].analytics
  }
  beforeAll(async () => {
    const env = parseEnv(readFileSync(resolve(__dirname, '../../../.env.workbench.local'), 'utf8'))
    if (env.DB_HOST !== '127.0.0.1' || env.DB_PORT !== '55432' || env.DB_DATABASE !== 'autoflow_local_demo') throw Error('Local test database required')
    client = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE })
    await client.connect(); await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='15s'")
    await client.query(`CREATE TEMP TABLE hz_fop_collected_analytics_facts(batch_id text,company_id text,entity_type text,source_id text,document_number text,paid_at timestamptz,owner_employee_id text,raw jsonb,facts jsonb,quantity numeric,raw_status text,currency_code text)`)
    for (const [id, owner, amount, date] of [['1','a','10.10','2026-11-05'],['2','a','20.20','2026-11-05'],['3','b','40.40','2026-11-05'],['4','c','100.00','2026-11-05'],['5','c','500.00','2026-10-01'],['6','outside','900.00','2026-11-05']]) {
      await client.query(`INSERT INTO hz_fop_collected_analytics_facts VALUES('b','100000','fulfillment',$1,$1,$2,$3,$4,$5,1,'C','USD')`, [id,date,owner,JSON.stringify({ hzkj_total_amount: amount }),JSON.stringify({ scope: { verified: true, companyId: '100000' }, sourceOwnershipVerified: true })])
    }
  })
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end() } })
  it('returns stable person and department IDs, English names and exact scoped subtotals', async () => {
    const result = await run()
    expect(result.rows.filter((r:any)=>r.dimension==='person')).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'a',departmentId:'d1',departmentName:'业务一部',englishName:'Alex',amount:'30.30'}),
      expect.objectContaining({id:'b',departmentId:'d1',englishName:'Wendy',amount:'40.40'}),
      expect.objectContaining({id:'c',departmentId:'d2',englishName:'Alex',amount:'100.00'}),
    ]))
    expect(result.rows.find((r:any)=>r.dimension==='department'&&r.id==='d1').amount).toBe('70.70')
    expect(result.amountsByCurrency).toEqual([{currency:'USD',amount:'170.70',orderCount:4}])
  })
  it('narrows department subtotals to the same authorized personal data', async () => {
    const result = await run({employeeIds:['a']})
    expect(result.rows.filter((r:any)=>r.dimension==='person')).toEqual([expect.objectContaining({id:'a',departmentId:'d1',amount:'30.30'})])
    expect(result.rows.filter((r:any)=>r.dimension==='department')).toEqual([expect.objectContaining({id:'d1',amount:'30.30'})])
  })
  it('never returns personal identity or personal columns for summary-only accounts', async () => {
    const result = await run({summaryOnly:true})
    expect(result.rows.every((r:any)=>r.dimension==='department'&&!('englishName' in r)&&!('departmentId' in r))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/Alex|Wendy/)
    expect(result.amountsByCurrency[0].amount).toBe('170.70')
  })
})
