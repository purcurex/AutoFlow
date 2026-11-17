import { sourceTime, timeText, sameTimestampScope, validateTimestampDocument, type TimestampScope, type TimestampDocument, type TimestampMode, type TimestampStore } from './timestamp-sync'

export type TimestampNumberedQuery = { from:string; to:string; pageNo:number; pageSize:number }
export interface TimestampNumberedSource {
  assertReady(scope:TimestampScope):void
  captureIdentityBasis?():Record<string,unknown>|null
  page(scope:TimestampScope, query:TimestampNumberedQuery):Promise<{scope:TimestampScope;rows:TimestampDocument[];totalCount:number;lastPage:boolean}>
}
/** Ordinary pages are not a snapshot or keyset. A fixed local cutoff is only a capture watermark. */
export class TimestampPagedSync {
  constructor(private readonly store:TimestampStore,private readonly source:TimestampNumberedSource,
    private readonly now=()=>new Date().toISOString(),
    private readonly options={overlapSeconds:600,safetyLagSeconds:120,pageSize:100,maxPages:1000,fullCompensationSeconds:86400}) {
    if(Object.values(options).some(n=>!Number.isSafeInteger(n)||n<1)||options.pageSize>100||options.maxPages>1000)throw Error('timestamp_invalid_options')
  }
  async run(scope:TimestampScope,mode:TimestampMode){
    if(!['initialize','incremental','reconcile'].includes(mode))throw Error('timestamp_invalid_mode')
    this.source.assertReady(scope)
    return this.store.exclusive(scope,async session=>{
      this.source.assertReady(scope)
      const previous=await session.checkpoint(),capturedAt=this.now(),now=sourceTime(capturedAt)
      if(mode==='initialize'&&previous)throw Error('timestamp_already_initialized')
      if(mode!=='initialize'&&!previous)throw Error('timestamp_initialization_required')
      if(mode==='incremental'){
        const fullAt=await session.lastFullCapture?.()
        if(!fullAt||now-sourceTime(fullAt)>=BigInt(this.options.fullCompensationSeconds)*1000000000n)throw Error('timestamp_full_compensation_required')
      }
      // The package accepts seconds. Never advance W beyond the exact upper bound sent upstream.
      const upper=timeText((now/1000000000n-BigInt(this.options.safetyLagSeconds))*1000000000n)
      if(previous&&sourceTime(upper)<=sourceTime(previous))throw Error('timestamp_clock_not_advanced')
      const lower=mode==='incremental'?timeText((sourceTime(previous)/1000000000n-BigInt(this.options.overlapSeconds))*1000000000n):'1970-01-01T00:00:00Z'
      const runId=await session.start(mode,lower,upper)
      try{
        let expected:number|undefined,after:{time:string;id:string}|null=null
        const seen=new Set<string>()
        for(let pageNo=1;pageNo<=this.options.maxPages;pageNo++){
          this.source.assertReady(scope)
          const query={from:lower,to:upper,pageNo,pageSize:this.options.pageSize},page=await this.source.page(scope,query)
          if(!sameTimestampScope(page?.scope,scope)||!Array.isArray(page.rows)||!Number.isSafeInteger(page.totalCount)||page.totalCount<0||typeof page.lastPage!=='boolean'||page.rows.length>query.pageSize)throw Error('timestamp_page_invalid')
          expected??=page.totalCount
          if(expected!==page.totalCount)throw Error('timestamp_total_changed')
          for(const row of page.rows){
            validateTimestampDocument(row,scope)
            if(!row.modifiedAt||sourceTime(row.modifiedAt)<sourceTime(lower)||sourceTime(row.modifiedAt)>=sourceTime(upper))throw Error('timestamp_row_outside_window')
            if(seen.has(row.id))throw Error('timestamp_duplicate_source')
            // Numbered pages expose seconds, not the precise source ordering key. Equal
            // timestamps may contain any ID order; global IDs/count still must reconcile.
            if(after&&sourceTime(row.modifiedAt)<sourceTime(after.time))throw Error('timestamp_cursor_not_monotonic')
            seen.add(row.id);after={time:row.modifiedAt,id:row.id}
          }
          if(seen.size>expected||page.lastPage!==(seen.size===expected)||!page.lastPage&&page.rows.length!==query.pageSize)throw Error('timestamp_page_incomplete')
          await session.stage(runId,page.rows,{mode:'modified',from:lower,to:upper,after:null,limit:query.pageSize,pageNo,pagination:'ordinary'})
          if(page.lastPage){
            this.source.assertReady(scope)
            return await session.commit(runId,upper,[],false,{protocol:'ordinary_modified_pages',clockBasis:'local_capture_time',capturedAt,identityBasis:this.source.captureIdentityBasis?.()??null,consistency:'eventual',sameTimestampIdOrderVerified:false,fullCompensationRequired:true,fullCompensationSeconds:this.options.fullCompensationSeconds,sourceScopeProof:false,deletionDetection:'pending_explicit_existence_api',presentation:'previous_snapshot',publicationPending:true})
          }
        }
        throw Error('timestamp_page_limit')
      }catch(error){await session.fail(runId,error instanceof Error&&/^timestamp_[a-z_]+$/.test(error.message)?error.message:'timestamp_sync_failed');throw error}
    })
  }
}
