import { publishTimestampProjections } from './timestamp-projection-publisher'
it('an unchanged capture without pending tasks does not enumerate or rebuild projections', async () => {
  const query = jest.fn(async (sql: string) => {
    if(sql.includes('to_regclass'))return [{present:true}]
    if(sql.startsWith('SELECT * FROM hz_fop_collected_batches'))return [{metadata:{}}]
    if(sql.includes('hz_fop_timestamp_projection_tasks'))return []
    throw Error('Unexpected full projection scan')
  })
  expect(await publishTimestampProjections({query} as any,{batchId:'b',tenantId:'t',companyId:'100000',entityCode:'hzkj_orders'})).toMatchObject({applied:0,rebuildChain:false})
  expect(query.mock.calls.some(([sql])=>sql.includes('FROM hz_fop_collected_orders'))).toBe(false)
})
