/** Report the timestamp scheduler separately from the unconfigured strict snapshot services. */
export function timestampRuntimeStatus(get: (key: string) => string | undefined, schedule: Record<string, any> = {}) {
  const paused = get('FOP_QUERIES_PAUSED') === 'true'
  const configured = get('WORKBENCH_TIMESTAMP_SYNC_ENABLED') === 'true'
  const blockers = [
    ...(get('FOP_QUERIES_PAUSED') !== 'false' ? ['fop_queries_paused'] : []),
    ...(!configured ? ['timestamp_scheduler_disabled'] : []),
    ...(get('WORKBENCH_AUTOMATIC_CALLS_ENABLED') !== 'true' ? ['automatic_calls_disabled'] : []),
    ...(get('WORKBENCH_SYNC_ENABLED') !== 'true' ? ['sync_disabled'] : []),
    ...(get('WORKBENCH_READ_MODE') !== 'local' ? ['local_read_mode_required'] : []),
    ...(get('WORKBENCH_COLLECTED_ENABLED') !== 'true' ? ['collected_mode_required'] : []),
    ...(get('WORKBENCH_MOCK_ENABLED') === 'true' ? ['mock_dataset'] : []),
  ]
  const enabled = blockers.length === 0
  const codes=['hzkj_orders','hzkj_alloc_bill','hzkj_deliver_bill','hzkj_deliver_order']
  const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0?Number(n):0
  const errorCode=(v:unknown)=>typeof v==='string'&&/^timestamp_[a-z_]+$/.test(v)?v:null
  const entities=(Array.isArray(schedule.entities)?schedule.entities:[]).filter(e=>codes.includes(e?.entityCode)).map(e=>({entityCode:e.entityCode,status:e.status,pages:count(e.pages),rows:count(e.rows),changed:count(e.changed),pendingProjection:count(e.pendingProjection),errorCode:errorCode(e.errorCode),nextAttemptAt:e.nextAttemptAt??null}))
  const retries=codes.filter(code=>schedule.entityRetry?.[code]).map(entityCode=>({entityCode,count:count(schedule.entityRetry[entityCode].count),errorCode:errorCode(schedule.entityRetry[entityCode].errorCode),nextAttemptAt:schedule.entityRetry[entityCode].nextAttemptAt??null}))
  return {
    paused, automaticCallsEnabled: enabled, syncConfigured: configured,
    nextScheduledAt: enabled ? schedule.nextAttemptAt ?? null : null,
    scheduledSync: {
      mechanism: 'ordinary_modified_pages', enabled,
      entityCodes: ['hzkj_orders', 'hzkj_alloc_bill', 'hzkj_deliver_bill', 'hzkj_deliver_order'],
      lastStatus: schedule.lastStatus ?? null, lastAttemptAt: schedule.lastAttemptAt ?? null,
      lastFinishedAt: schedule.lastFinishedAt ?? null, failureCount: schedule.failureCount ?? 0,
      lastSuccessfulCycleAt:schedule.lastSuccessfulCycleAt??null,lastErrorCode:errorCode(schedule.errorCode),
      entities,retries,pendingProjection:entities.reduce((sum,e)=>sum+e.pendingProjection,0),
    },
    capabilities: {
      historicalImport: { implemented: true, executable: false, blockers: ['strict_snapshot_services_not_configured'] },
      incrementalSync: { configured, executable: enabled, blockers },
    },
  }
}
