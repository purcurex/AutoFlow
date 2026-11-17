/** Eventual query-copy capture. This protocol never creates transaction versions/barriers. */
export type TimestampScope = { batchId: string; tenantId: string; companyId: string; entityCode: string }
export type TimestampDocument = { id: string; companyId: string; createdAt: string | null; modifiedAt: string | null; raw: Record<string, unknown> }
export type TimestampMode = 'initialize' | 'incremental' | 'reconcile'
export type TimestampQuery = { mode: 'full' | 'created' | 'modified'; from?: string; to?: string; after: {time: string | null; id: string} | null; limit: number; pageNo?:number; pagination?:'ordinary' }
export type TimestampPage = { scope: TimestampScope; rows: TimestampDocument[]; complete: boolean }
export interface TimestampSource {
  assertReady(scope: TimestampScope): void
  clock(scope: TimestampScope): Promise<string>
  page(scope: TimestampScope, query: TimestampQuery): Promise<TimestampPage>
  exists(scope: TimestampScope, id: string): Promise<{scope: TimestampScope; id: string; state: 'present' | 'absent'; document?: TimestampDocument}>
}
export interface TimestampSession {
  checkpoint(): Promise<string | null>
  lastFullCapture?(): Promise<string | null>
  start(mode: TimestampMode, lower: string | null, upper: string | null): Promise<string>
  stage(runId: string, rows: TimestampDocument[], query: TimestampQuery): Promise<void>
  ids(): Promise<string[]>
  commit(runId: string, watermark: string | null, deleted: string[], authoritative: boolean, captureMetadata?:Record<string,unknown>): Promise<Record<string, unknown>>
  fail(runId: string, code: string): Promise<void>
}
export interface TimestampStore {
  exclusive<T>(scope: TimestampScope, work: (session: TimestampSession) => Promise<T>): Promise<T>
}
export function sourceId(id: unknown): string {
  if (typeof id !== 'string' || !/^[1-9]\d{0,30}$/.test(id)) throw Error('timestamp_invalid_id')
  return id
}
/** Nanoseconds retain source precision; Date is used only for whole seconds and calendar validation. */
export function sourceTime(value: unknown): bigint {
  if (typeof value !== 'string') throw Error('timestamp_invalid_time')
  const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value)
  if (!m || +m[1]<1970 || +m[4]>23 || +m[5]>59 || +m[6]>59) throw Error('timestamp_invalid_time')
  const calendar=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]))
  if (calendar.getUTCFullYear()!==+m[1] || calendar.getUTCMonth()!==+m[2]-1 || calendar.getUTCDate()!==+m[3]) throw Error('timestamp_invalid_time')
  const seconds=Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[8]}`)
  if (!Number.isFinite(seconds) || seconds<0) throw Error('timestamp_invalid_time')
  return BigInt(seconds)*1000000n+BigInt((m[7]??'').padEnd(9,'0'))
}
export function timeText(value: bigint): string {
  if(value<0n)throw Error('timestamp_invalid_time')
  return new Date(Number(value/1000000000n)*1000).toISOString().slice(0,19)+'.'+String(value%1000000000n).padStart(9,'0')+'Z'
}
export function sameTimestampScope(a: TimestampScope, b: TimestampScope) {
  return !!a && ['batchId','tenantId','companyId','entityCode'].every(k=>a[k as keyof TimestampScope]===b[k as keyof TimestampScope])
}
export function validateTimestampDocument(d: TimestampDocument, scope: TimestampScope) {
  if(!d || d.companyId!==scope.companyId || !d.raw || typeof d.raw!=='object' || Array.isArray(d.raw))throw Error('timestamp_document_scope_invalid')
  sourceId(d.id)
  if(d.createdAt!==null)sourceTime(d.createdAt)
  if(d.modifiedAt!==null)sourceTime(d.modifiedAt)
  if(d.createdAt===null&&d.modifiedAt===null)throw Error('timestamp_document_time_missing')
}
export class TimestampSync {
  constructor(private readonly store: TimestampStore, private readonly source: TimestampSource,
    private readonly options={ overlapSeconds:600, safetyLagSeconds:120, pageSize:100, maxPages:100000 }) {
    for(const n of Object.values(options))if(!Number.isSafeInteger(n)||n<0)throw Error('timestamp_invalid_options')
    if(options.pageSize<1||options.pageSize>1000||options.maxPages<1)throw Error('timestamp_invalid_options')
  }
  async run(scope: TimestampScope, mode: TimestampMode) {
    if(!['initialize','incremental','reconcile'].includes(mode))throw Error('timestamp_invalid_mode')
    this.source.assertReady(scope)
    return this.store.exclusive(scope,async session=>{
      this.source.assertReady(scope)
      const previous=await session.checkpoint()
      if(mode!=='initialize'&&!previous)throw Error('timestamp_initialization_required')
      if(mode==='initialize'&&previous)throw Error('timestamp_already_initialized')
      const now=sourceTime(await this.source.clock(scope))
      const upper=timeText(now-BigInt(this.options.safetyLagSeconds)*1000000000n)
      if(mode==='incremental'&&sourceTime(upper)<=sourceTime(previous))throw Error('timestamp_clock_not_advanced')
      const lower=timeText((previous?sourceTime(previous):now)-BigInt(this.options.overlapSeconds)*1000000000n)
      const runId=await session.start(mode,mode==='reconcile'?null:lower,mode==='reconcile'?null:upper)
      try {
        const seen=new Set<string>()
        const scan=async(kind:TimestampQuery['mode'])=>{
          let after:TimestampQuery['after']=null
          for(let page=0;page<this.options.maxPages;page++){
            this.source.assertReady(scope)
            const query:TimestampQuery={mode:kind,after,limit:this.options.pageSize,...kind==='full'?{}:{from:lower,to:upper}}
            const result=await this.source.page(scope,query)
            if(!sameTimestampScope(result?.scope,scope)||!Array.isArray(result.rows)||typeof result.complete!=='boolean'||result.rows.length>query.limit||(!result.complete&&!result.rows.length))throw Error('timestamp_page_invalid')
            for(const d of result.rows){
              validateTimestampDocument(d,scope)
              const time=kind==='full'?null:kind==='created'?d.createdAt:d.modifiedAt
              if(kind!=='full'&&(time===null||sourceTime(time)<sourceTime(lower)||sourceTime(time)>=sourceTime(upper)))throw Error('timestamp_row_outside_window')
              if(after){const delta=kind==='full'?0n:sourceTime(time)-sourceTime(after.time)
                if(delta<0n || delta===0n&&BigInt(d.id)<=BigInt(after.id))throw Error('timestamp_cursor_not_monotonic')}
              after={time,id:d.id};seen.add(d.id)
            }
            await session.stage(runId,result.rows,query)
            if(result.complete)return
          }
          throw Error('timestamp_page_limit')
        }
        if(mode!=='incremental')await scan('full')
        if(mode!=='reconcile'){await scan('created');await scan('modified')}
        const deleted:string[]=[]
        if(mode!=='incremental')for(const id of await session.ids())if(!seen.has(id)){
          this.source.assertReady(scope)
          const proof=await this.source.exists(scope,id)
          if(!sameTimestampScope(proof?.scope,scope)||proof.id!==id)throw Error('timestamp_existence_unconfirmed')
          if(proof.state==='absent')deleted.push(id)
          else if(proof.state==='present'&&proof.document){validateTimestampDocument(proof.document,scope);if(proof.document.id!==id)throw Error('timestamp_existence_unconfirmed');await session.stage(runId,[proof.document],{mode:'full',after:null,limit:1})}
          else throw Error('timestamp_existence_unconfirmed')
        }
        this.source.assertReady(scope)
        return await session.commit(runId,mode==='reconcile'?previous:upper,deleted,mode!=='incremental')
      }catch(error){await session.fail(runId,error instanceof Error&&/^timestamp_[a-z_]+$/.test(error.message)?error.message:'timestamp_sync_failed');throw error}
    })
  }
}
