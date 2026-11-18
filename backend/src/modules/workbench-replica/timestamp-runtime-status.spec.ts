import { timestampRuntimeStatus } from './timestamp-runtime-status'
const flags: Record<string,string> = { FOP_QUERIES_PAUSED:'false', WORKBENCH_AUTOMATIC_CALLS_ENABLED:'true', WORKBENCH_SYNC_ENABLED:'true', WORKBENCH_TIMESTAMP_SYNC_ENABLED:'true', WORKBENCH_READ_MODE:'local', WORKBENCH_COLLECTED_ENABLED:'true', WORKBENCH_MOCK_ENABLED:'false' }
describe('timestamp runtime status', () => {
  it('reports the enabled scheduler without claiming strict snapshot readiness', () => {
    const result = timestampRuntimeStatus(k=>flags[k],{nextAttemptAt:'2026-11-18T12:00:00Z',lastStatus:'applied'})
    expect(result).toMatchObject({paused:false,automaticCallsEnabled:true,syncConfigured:true,nextScheduledAt:'2026-11-18T12:00:00Z'})
    expect(result.capabilities.incrementalSync.executable).toBe(true)
    expect(result.capabilities.historicalImport.executable).toBe(false)
  })
  it.each(['FOP_QUERIES_PAUSED','WORKBENCH_AUTOMATIC_CALLS_ENABLED','WORKBENCH_SYNC_ENABLED','WORKBENCH_TIMESTAMP_SYNC_ENABLED','WORKBENCH_READ_MODE','WORKBENCH_COLLECTED_ENABLED','WORKBENCH_MOCK_ENABLED'])('honors %s before exposing automatic execution', key => {
    const values={...flags,[key]:key==='WORKBENCH_READ_MODE'?'live':flags[key]==='true'?'false':'true'}
    const result=timestampRuntimeStatus(k=>values[k],{nextAttemptAt:'2026-11-18T12:00:00Z'})
    expect(result.automaticCallsEnabled).toBe(false)
    expect(result.nextScheduledAt).toBeNull()
    expect(result.capabilities.incrementalSync.blockers.length).toBeGreaterThan(0)
  })
  it('does not expose raw schedule metadata or invent successful synchronization',()=>{
    const result=timestampRuntimeStatus(k=>flags[k],{secret:'private',entities:[{raw:'private'}]})
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.scheduledSync.lastStatus).toBeNull()
  })
  it('exposes retry and projection gaps separately from capture success without raw payloads',()=>{
    const result=timestampRuntimeStatus(k=>flags[k],{lastStatus:'succeeded',lastSuccessfulCycleAt:'2026-11-18T09:00:00Z',entities:[{entityCode:'hzkj_alloc_bill',status:'projection_pending',pendingProjection:93,raw:'private'}],entityRetry:{hzkj_orders:{count:2,errorCode:'timestamp_source_rejected',nextAttemptAt:'2026-11-18T10:00:00Z',raw:'private'}}})
    expect(result.scheduledSync).toMatchObject({lastSuccessfulCycleAt:'2026-11-18T09:00:00Z',pendingProjection:93,entities:[{entityCode:'hzkj_alloc_bill',status:'projection_pending',pendingProjection:93}],retries:[{entityCode:'hzkj_orders',count:2,errorCode:'timestamp_source_rejected'}]})
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
