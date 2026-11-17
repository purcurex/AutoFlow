import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { customerRegistrationQuery } from './customer-registration-query'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg')
const integration = process.env.RUN_REGISTRATION_GROUPING_SQL_TEST === '1' ? describe : describe.skip

integration('registration department grouping in isolated PostgreSQL TEMP tables', () => {
  let client: any
  const members = [
    { employeeId: 'a', fopUserId: 'u1', name: '甲', englishName: 'Alex', departmentId: 'd1', departmentName: '业务一部' },
    { employeeId: 'b', fopUserId: 'u2', name: '乙', englishName: 'Wendy', departmentId: 'd1', departmentName: '业务一部' },
    { employeeId: 'c', fopUserId: 'u3', name: '丙', englishName: 'Alex', departmentId: 'd2', departmentName: '业务二部' },
  ]
  async function run(extra = {}) {
    const q = customerRegistrationQuery({ batchId: 'b', companyId: '100000', employeeIds: ['a','b','c'], members, start: '2026-11-01', end: '2026-12-01', chartId: 'registrations', summaryOnly: false, ...extra })
    return (await client.query(q.sql, q.params)).rows[0].analytics
  }
  beforeAll(async () => {
    const env = parseEnv(readFileSync(resolve(__dirname, '../../../.env.workbench.local'), 'utf8'))
    if (env.DB_HOST !== '127.0.0.1' || env.DB_PORT !== '55432' || env.DB_DATABASE !== 'autoflow_local_demo') throw Error('Local test database required')
    client = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE })
    await client.connect(); await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='15s'")
    await client.query(`CREATE TEMP TABLE hz_fop_collected_customer_registrations(batch_id text,company_id text,source_id text,source_entity text,source_owner_user_id text,created_at timestamptz)`)
    for (const [id, owner, date] of [['1','u1','2026-11-05'],['2','u1','2026-11-05'],['3','u2','2026-11-05'],['4','u3','2026-11-05'],['5','u3','2026-10-01'],['6','outside','2026-11-05']]) {
      await client.query(`INSERT INTO hz_fop_collected_customer_registrations VALUES('b','100000',$1,'hzkj_member_customer',$2,$3)`, [id,owner,date])
    }
  })
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end() } })
  it('retains stable identity and exact department and overall counts after time and scope filtering', async () => {
    const result = await run()
    expect(result.rows.filter((r:any)=>r.dimension==='person')).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'a',departmentId:'d1',departmentName:'业务一部',englishName:'Alex',registrationCount:2}),
      expect.objectContaining({id:'b',departmentId:'d1',englishName:'Wendy',registrationCount:1}),
      expect.objectContaining({id:'c',departmentId:'d2',englishName:'Alex',registrationCount:1}),
    ]))
    expect(result.rows.find((r:any)=>r.dimension==='department'&&r.id==='d1').registrationCount).toBe(3)
    expect(result.registrationCount).toBe(4)
  })
  it('limits department subtotals to authorized people and rejects ambiguous account mappings', async () => {
    const result = await run({employeeIds:['a']})
    expect(result.rows.filter((r:any)=>r.dimension==='person')).toEqual([expect.objectContaining({id:'a',departmentId:'d1',registrationCount:2})])
    expect(result.rows.filter((r:any)=>r.dimension==='department')).toEqual([expect.objectContaining({id:'d1',registrationCount:2})])
    expect((await run({employeeIds:['a'],members:[...members,{...members[0],employeeId:'ambiguous'}]})).registrationCount).toBe(0)
  })
  it('does not return personal identity to summary-only accounts', async () => {
    const result = await run({summaryOnly:true})
    expect(result.rows.every((r:any)=>r.dimension==='department'&&!('englishName' in r)&&!('departmentId' in r))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/Alex|Wendy/)
    expect(result.registrationCount).toBe(4)
  })
})
