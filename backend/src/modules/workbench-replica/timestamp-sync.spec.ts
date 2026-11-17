import { TimestampSync, sourceTime } from './timestamp-sync'

const scope = { batchId: 'batch', tenantId: 'tenant', companyId: '100000', entityCode: 'hzkj_orders' }
const at = '2026-11-15T00:00:00.000000001Z'
const doc = (id: string, modifiedAt = at) => ({ id, companyId: '100000', createdAt: at, modifiedAt, raw: { id, billno: 'SO'+id } })
function fixture() {
  const state: any = { checkpoint: '2026-11-15T00:00:01Z', pages: [], rows: [], status: '', calls: [] }
  const store: any = { exclusive: async (_: any, fn: any) => fn({
    checkpoint: async () => state.checkpoint,
    start: async () => { state.status='running'; return 'run' },
    stage: async (_: any, rows: any) => { state.pages.push(rows) },
    ids: async () => ['99'],
    commit: async (_: any, checkpoint: any, deleted: any) => { state.rows=state.pages.flat();state.deleted=deleted;state.checkpoint=checkpoint;state.status='captured'; return {state:state.status} },
    fail: async () => {state.status='failed'},
  }) }
  const source: any = { clock: async () => '2026-11-15T00:05:00Z', assertReady: () => {},
    page: async (_: any, query: any) => {state.calls.push(query);return {scope,rows:[],complete:true}},
    exists: async () => ({scope,id:'99',state:'absent'}) }
  return {state,store,source,engine:new TimestampSync(store, source)}
}
describe('timestamp synchronization', () => {
  it('preserves sub-millisecond ordering and timezone equivalence', () => {
    expect(sourceTime(at)<sourceTime('2026-11-15T00:00:00.000000002Z')).toBe(true)
    expect(sourceTime(at)).toBe(sourceTime('2026-11-15T08:00:00.000000001+08:00'))
    expect(() => sourceTime('2026-02-30T00:00:00Z')).toThrow()
    expect(() => sourceTime('2026-11-15 00:00:00')).toThrow()
  })
  it('reads both streams and advances to fixed cutoff, including an empty window', async () => {
    const f=fixture(); await f.engine.run(scope,'incremental')
    expect(f.state.calls.map((x:any)=>x.mode)).toEqual(['created','modified'])
    expect(f.state.calls[0].from).toBe('2026-11-14T23:50:01.000000000Z')
    expect(f.state.checkpoint).toBe('2026-11-15T00:03:00.000000000Z')
  })
  it('uses time plus a lossless bigint ID cursor for a full same-time page', async () => {
    const f=fixture();f.source.page=async (_:any,q:any)=>{f.state.calls.push(q);return {scope,rows:q.mode==='created'&&!q.after?[doc('9007199254740993')]:[],complete:!!q.after||q.mode==='modified'}}
    await f.engine.run(scope,'incremental')
    expect(f.state.calls[1].after).toEqual({time:at,id:'9007199254740993'})
  })
  it('fails on repeated cursor and keeps the old watermark', async () => {
    const f=fixture();f.source.page=async()=>({scope,rows:[doc('10')],complete:false})
    await expect(f.engine.run(scope,'incremental')).rejects.toThrow('timestamp_cursor_not_monotonic')
    expect(f.state.checkpoint).toBe('2026-11-15T00:00:01Z');expect(f.state.status).toBe('failed')
  })
  it.each(['wrong_scope','outside_window','partial','empty_more'])('rejects invalid source evidence: %s',async kind=>{
    const f=fixture();f.source.page=async()=>({scope:kind==='wrong_scope'?{...scope,companyId:'2'}:scope,rows:kind==='empty_more'?[]:[doc('10',at)],complete:kind==='empty_more'?false:true, ...kind==='partial'?{complete:null}:{}})
    if(kind==='outside_window')f.source.page=async()=>({scope,rows:[{...doc('10'),createdAt:'2026-11-15T00:03:00Z'}],complete:true})
    await expect(f.engine.run(scope,'incremental')).rejects.toThrow()
    expect(f.state.checkpoint).toBe('2026-11-15T00:00:01Z')
  })
  it('does not start incremental capture without initialization',async()=>{
    const f=fixture();f.state.checkpoint=null
    await expect(f.engine.run(scope,'incremental')).rejects.toThrow('timestamp_initialization_required')
    expect(f.state.calls).toEqual([])
  })
  it('initializes by full IDs then both time streams',async()=>{
    const f=fixture();f.state.checkpoint=null;await f.engine.run(scope,'initialize')
    expect(f.state.calls.map((x:any)=>x.mode)).toEqual(['full','created','modified'])
    expect(f.state.deleted).toEqual(['99'])
  })
  it('refuses deletion on an ambiguous existence response',async()=>{
    const f=fixture();f.source.exists=async()=>({scope,id:'99',state:'denied'})
    await expect(f.engine.run(scope,'reconcile')).rejects.toThrow('timestamp_existence_unconfirmed')
    expect(f.state.checkpoint).toBe('2026-11-15T00:00:01Z');expect(f.state.deleted).toBeUndefined()
  })
  it('reconciles without advancing the incremental watermark',async()=>{
    const f=fixture();await f.engine.run(scope,'reconcile')
    expect(f.state.calls.map((x:any)=>x.mode)).toEqual(['full'])
    expect(f.state.deleted).toEqual(['99']);expect(f.state.checkpoint).toBe('2026-11-15T00:00:01Z')
  })
  it('a paused source blocks even before a run is persisted',async()=>{
    const f=fixture();f.source.assertReady=()=>{throw Error('fop_queries_paused')}
    await expect(f.engine.run(scope,'incremental')).rejects.toThrow('fop_queries_paused')
    expect(f.state.status).toBe('');expect(f.state.calls).toEqual([])
  })
  it('does not regress or repeatedly replay when the source clock is behind W',async()=>{
    const f=fixture();f.source.clock=async()=>at
    await expect(f.engine.run(scope,'incremental')).rejects.toThrow('timestamp_clock_not_advanced')
    expect(f.state.calls).toEqual([])
  })
})
