import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { dashboardAnalyticsQuery } from './dashboard-analytics-query'
import { combineDashboardStatements, withDepartmentSummary } from './manager-dashboard-scope'
// eslint-disable-next-line @typescript-eslint/no-require-imports -- SQL tests use the installed pg runtime without optional typings.
const { Client } = require('pg')
const integration = process.env.RUN_CUSTOMER_OWNER_SQL_TEST === '1' ? describe : describe.skip

integration('customer chart owners in isolated PostgreSQL TEMP tables', () => {
  let client: any
  const members = [
    { employeeId: 'alice', fopUserId: 'u1', name: 'Alice', englishName: 'Alice', departmentId: 'd1', departmentName: '业务一部' },
    { employeeId: 'bob', fopUserId: 'u2', name: '张博（Bob）', englishName: 'Bob', departmentId: 'd2', departmentName: '业务二部' },
  ]
  const input = { batchId: 'b', companyId: '100000', employeeIds: ['alice', 'bob'], members, start: '2026-11-01', end: '2026-12-01', chartId: 'customer_orders', summaryOnly: false }
  async function run(extra = {}) {
    const q = dashboardAnalyticsQuery({ ...input, ...extra })
    return (await client.query(q.sql, q.params)).rows[0].analytics
  }
  beforeAll(async () => {
    const env = parseEnv(readFileSync(resolve(__dirname, '../../../.env.workbench.local'), 'utf8'))
    if (env.DB_HOST !== '127.0.0.1' || env.DB_PORT !== '55432' || env.DB_DATABASE !== 'autoflow_local_demo') throw Error('Local test database required')
    client = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE })
    await client.connect(); await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='15s'")
    await client.query(`CREATE TEMP TABLE hz_fop_collected_analytics_facts(batch_id text,company_id text,entity_type text,source_id text,document_number text,paid_at timestamptz,owner_employee_id text,raw jsonb,facts jsonb,quantity numeric,raw_status text,currency_code text);
      CREATE TEMP TABLE hz_fop_collected_customer_registrations(batch_id text,company_id text,source_id text,source_entity text,source_owner_user_id text,PRIMARY KEY(batch_id,source_id));
      INSERT INTO hz_fop_collected_customer_registrations VALUES('b','100000','c1','hzkj_member_customer','u2'),('b','200000','c2','hzkj_member_customer','u2'),('other','100000','c3','hzkj_member_customer','u2')`)
    for (const [id, customer] of [['1', 'c1'], ['2', 'c1'], ['3', 'c2'], ['4', 'c3'], ['5', 'missing']]) {
      await client.query(`INSERT INTO hz_fop_collected_analytics_facts VALUES('b','100000','fulfillment',$1,$1,'2026-11-05','alice','{}',$2,3,'C','USD')`, [id, JSON.stringify({ customer: { id: customer, name: 'Customer' }, scope: { verified: true, companyId: '100000' }, sourceOwnershipVerified: true })])
    }
  })
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end() } })
  it('uses the customer archive owner, not the historical order owner, without duplicating counts', async () => {
    const result = await run()
    expect(result.orderCount).toBe(5)
    expect(result.rows.filter((r: any) => r.dimension === 'person')).toEqual(expect.arrayContaining([expect.objectContaining({id:'bob',label:'张博（Bob）',orderCount:2,quantity:'6'}),expect.objectContaining({id:'unknown',orderCount:3})]))
    expect(result.rows.filter((r: any) => r.dimension === 'person').reduce((sum: number,r: any)=>sum+r.orderCount,0)).toBe(result.orderCount)
    expect(result.rows.find((r: any) => r.dimension === 'customer' && r.id === 'c1')).toMatchObject({ customerOwnerName: '张博（Bob）', orderCount: 2, quantity: '6' })
    expect(result.rows.filter((r: any) => r.dimension === 'customer' && r.id !== 'c1').every((r: any) => r.customerOwnerName === null)).toBe(true)
  })
  it('groups person subtotals by the customer owner department instead of the order owner department', async () => {
    const result = await run()
    expect(result.rows.find((r:any)=>r.dimension==='person'&&r.id==='bob')).toMatchObject({departmentId:'d2',departmentName:'业务二部',englishName:'Bob'})
    expect(result.rows.filter((r:any)=>r.dimension==='person_department')).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'d2',label:'业务二部',orderCount:2,quantity:'6'}),
      expect.objectContaining({id:'unknown',orderCount:3,quantity:'9'}),
    ]))
    expect(result.rows.find((r:any)=>r.dimension==='department'&&r.id==='d1').orderCount).toBe(5)
    expect(result.rows.filter((r:any)=>r.dimension==='person_department').reduce((sum:number,r:any)=>sum+r.orderCount,0)).toBe(5)
  })
  it('does not expose names outside employee scope or from ambiguous account bindings', async () => {
    for (const extra of [{ employeeIds: ['alice'] }, { members: [...members, { ...members[0], employeeId: 'charlie', fopUserId: 'u2' }] }]) {
      const result = await run(extra)
      expect(result.rows.find((r: any) => r.dimension === 'customer' && r.id === 'c1').customerOwnerName).toBeNull()
      expect(result.orderCount).toBe(5)
      expect(result.rows.filter((r: any)=>r.dimension==='person')).toEqual([expect.objectContaining({id:'unknown',label:'未绑定业务员',orderCount:5})])
      expect(result.rows.filter((r:any)=>r.dimension==='person_department')).toEqual([expect.objectContaining({id:'unknown',orderCount:5})])
      expect(result.rows.filter((r:any)=>r.dimension==='person').every((r:any)=>r.departmentId===null&&r.englishName===null)).toBe(true)
    }
  })
  it('groups order volume by the order owner with matching department counts and quantities', async () => {
    const result = await run({chartId:'order_volume'})
    expect(result.orderCount).toBe(5)
    expect(result.totalQuantity).toBe('15')
    expect(result.rows.filter((r:any)=>r.dimension==='person')).toEqual([
      expect.objectContaining({id:'alice',englishName:'Alice',departmentId:'d1',departmentName:'业务一部',orderCount:5,quantity:'15'}),
    ])
    expect(result.rows.filter((r:any)=>r.dimension==='department')).toEqual([
      expect.objectContaining({id:'d1',orderCount:5,quantity:'15'}),
    ])
    expect(result.rows.some((r:any)=>r.dimension==='person_department'||r.dimension==='customer')).toBe(false)
    expect((await run({chartId:'order_volume',employeeIds:['bob']})).orderCount).toBe(0)
  })
  it('does not add owner identities to summary-only or other charts', async () => {
    for (const extra of [{ summaryOnly: true }, { chartId: 'order_volume', summaryOnly: true }, { chartId: 'department_receipts' }]) {
      const result = await run(extra)
      expect(result.rows.every((r: any) => !('customerOwnerName' in r))).toBe(true)
      expect(result.rows.some((r: any)=>r.dimension==='person')).toBe(false)
      expect(result.rows.some((r:any)=>r.dimension==='person_department')).toBe(false)
      expect(result.rows.every((r:any)=>!('englishName' in r)&&!('departmentId' in r))).toBe(true)
    }
  })
  it('returns own customer-owner people and anonymous peer summaries in one statement',async()=>{
    const options={...input,customerOwnershipScope:true,recordEmployeeIds:['alice','bob']}
    const own=dashboardAnalyticsQuery({...options,employeeIds:['alice']})
    const peer=dashboardAnalyticsQuery({...options,summaryOnly:true})
    const statement=combineDashboardStatements([{key:'analytics',...own},{key:'summary',...peer}])
    const result=(await client.query(statement.sql,statement.params)).rows[0]
    // The two known customer orders belong to Bob's customer archive, despite Alice on the order.
    expect(result.analytics.orderCount).toBe(0)
    expect(result.summary.orderCount).toBe(2)
    expect(result.summary.rows).toEqual([expect.objectContaining({dimension:'department',id:'d2',orderCount:2})])
    expect(JSON.stringify(result.summary)).not.toMatch(/Bob|Alice|englishName|customerOwnerName|"bob"|"alice"/)
    const combined=withDepartmentSummary(result.analytics,result.summary,true)
    expect(combined.rows.map((r:any)=>r.dimension)).toEqual(['person_department'])
    const bob=await run({...options,employeeIds:['bob']})
    expect(bob.rows.filter((r:any)=>r.dimension==='person')).toEqual([expect.objectContaining({id:'bob',orderCount:2})])
    expect((await run({...options,employeeIds:['bob'],recordEmployeeIds:[]})).orderCount).toBe(0)
  })
})
