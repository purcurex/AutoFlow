import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import type { ReplicaBarrier, ReplicaDatasetScope } from './replica-change-contract'
import { normalizeReplicaGroup } from './replica-domain-normalizer'
import { REPLICA_API_KEYS, REPLICA_API_VERSION, type ReplicaAuthorization, type ReplicaReconciliation, type ReplicaSnapshot, type ReplicaSnapshotPage, type ReplicaSourceApi } from './replica-source-api'

const object = (v: unknown): Record<string, any> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('fop_replica_invalid_response'); return v }
const text = (v: unknown, max=2000): v is string => typeof v==='string' && v.length>0 && v.length<=max && v.trim()===v
const time = (v: unknown): v is string => text(v) && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
export const REPLICA_RESOURCES = ['orders','stock_orders','purchases','rma','purchase_returns','receipt_notices','stock_inventory','allocation_inventory','contacts','channels'] as const
export const REPLICA_REFERENCES = ['customer','supplier','sku','store','warehouse','logistics_provider','actual_channel','currency'] as const

/** New source contract only: configured URLs are supplied by FOP, never inferred from archived list APIs. */
export class ReplicaHttpSource implements ReplicaSourceApi {
  constructor(private readonly config: ConfigService, private readonly db: DataSource, private readonly request: typeof fetch = fetch) {}
  isConfigured(): boolean {
    return !!this.config.get<string>('FOP_REPLICA_ACCESS_TOKEN')?.trim() && REPLICA_API_KEYS.every(key=>{
      try { this.endpoint(key); return true } catch { return false }
    })
  }
  private endpoint(key: typeof REPLICA_API_KEYS[number]) {
    const url=new URL(this.config.get<string>(`FOP_REPLICA_${key}_URL`)??'')
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error('fop_replica_invalid_endpoint')
    return url
  }
  private enabled() {
    if(this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase()==='true')throw new Error('fop_queries_paused')
    if(this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true')throw new Error('fop_replica_mock_source_forbidden')
    if(!this.isConfigured())throw new Error('workbench_replica_sync_not_configured')
  }
  private async call(key: typeof REPLICA_API_KEYS[number], scope: Omit<ReplicaDatasetScope,'datasetId'>, payload: object) {
    this.enabled()
    const [identity]=await this.db.query(`SELECT c.tenant_id,co.source_company_id FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id
      WHERE c.id=$1 AND co.id=$2 AND c.status='active' AND co.enabled`,[scope.connectionId,scope.companyId])
    if(!identity || !text(identity.tenant_id) || !text(identity.source_company_id))throw new Error('fop_replica_scope_unavailable')
    this.enabled()
    let response: Response
    try {
      response=await this.request(this.endpoint(key),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',access_token:this.config.get<string>('FOP_REPLICA_ACCESS_TOKEN')!.trim()},
        body:JSON.stringify({...payload,schemaVersion:REPLICA_API_VERSION,tenantId:identity.tenant_id,companyId:identity.source_company_id})})
    }catch{throw new Error('fop_replica_request_failed')}
    if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'fop_replica_authentication_failed':'fop_replica_request_failed')}
    if(!response.body)throw new Error('fop_replica_empty_response')
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
    try { for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>8*1024*1024)throw new Error('fop_replica_response_too_large');chunks.push(item.value)} }
    finally {await reader.cancel();reader.releaseLock()}
    const envelope=object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if(envelope.success!==true)throw new Error('fop_replica_source_rejected')
    const data=object(envelope.data)
    if(data.schemaVersion!==REPLICA_API_VERSION || data.tenantId!==identity.tenant_id || data.companyId!==identity.source_company_id)throw new Error('fop_replica_scope_or_version_mismatch')
    this.enabled();return data
  }
  private fresh(data: Record<string,any>) {
    if(!text(data.scopeVersion,160)||!time(data.sourceAsOf)||!time(data.expiresAt)||Date.parse(data.sourceAsOf)>Date.now()||Date.parse(data.expiresAt)<=Date.now())throw new Error('fop_replica_expired_proof')
  }
  async begin(scope: ReplicaDatasetScope, requestKey: string): Promise<ReplicaSnapshot> {
    const data=await this.call('SNAPSHOT_BEGIN',scope,{requestKey});this.fresh(data)
    if(!text(data.snapshotId,200)||!Array.isArray(data.entityCodes)||!data.entityCodes.length||new Set(data.entityCodes).size!==data.entityCodes.length||data.entityCodes.some(v=>!text(v,128))
      ||!Array.isArray(data.streams)||!data.streams.length||data.streams.length>30||new Set(data.streams.map(s=>s.key)).size!==data.streams.length
      ||data.streams.some(s=>!text(s.key,128)||s.key==='_local'||!text(s.endCursor)))throw new Error('fop_replica_invalid_snapshot')
    return data as ReplicaSnapshot
  }
  async page(scope: ReplicaDatasetScope,snapshot: ReplicaSnapshot,streamKey: string,after: string|null): Promise<ReplicaSnapshotPage> {
    this.fresh(snapshot)
    const data=await this.call('SNAPSHOT_PAGE',scope,{snapshotId:snapshot.snapshotId,streamKey,afterCursor:after,limit:100})
    if(data.snapshotId!==snapshot.snapshotId||data.streamKey!==streamKey||data.afterCursor!==after||typeof data.complete!=='boolean'||!Array.isArray(data.groups)||data.groups.length>100)throw new Error('fop_replica_invalid_page')
    return {...data,groups:data.groups.map(group=>normalizeReplicaGroup(scope,group))} as ReplicaSnapshotPage
  }
  async barrier(scope: ReplicaDatasetScope): Promise<ReplicaBarrier> {
    const data=await this.call('BARRIER',scope,{});this.fresh(data)
    if(!text(data.id,128)||!Object.keys(object(data.proof)).length||!Object.keys(object(data.targetVector)).length||Object.entries(data.targetVector).some(([k,v])=>!text(k,128)||k==='_local'||!text(v)))throw new Error('fop_replica_invalid_barrier')
    return data as ReplicaBarrier
  }
  async groups(scope: ReplicaDatasetScope,streamKey: string,after: string|null,until: string) {
    const data=await this.call('CHANGES',scope,{streamKey,afterCursor:after,untilCursor:until,limit:100})
    if(data.streamKey!==streamKey||data.afterCursor!==after||data.untilCursor!==until||!Array.isArray(data.groups)||data.groups.length>100)throw new Error('fop_replica_invalid_page')
    return data.groups.map(group=>normalizeReplicaGroup(scope,group))
  }
  async authorization(scope: Omit<ReplicaDatasetScope,'datasetId'>): Promise<ReplicaAuthorization> {
    const data=await this.call('AUTHORIZATION',scope,{});this.fresh(data)
    if(Date.parse(data.sourceAsOf)<Date.now()-60000||Date.parse(data.expiresAt)>Date.now()+60000||typeof data.companyAllowed!=='boolean'
      ||!Array.isArray(data.resources)||data.resources.length!==REPLICA_RESOURCES.length||new Set(data.resources.map(r=>r.resource)).size!==REPLICA_RESOURCES.length
      ||data.resources.some(r=>!REPLICA_RESOURCES.includes(r.resource)||!Array.isArray(r.grants)||r.grants.length>100000||new Set(r.grants.map((g:any)=>g.target)).size!==r.grants.length||r.grants.some((g:any)=>!text(g.target,160)||!['allow','deny'].includes(g.decision)))
      ||!Array.isArray(data.employees)||!Array.isArray(data.references)||!Object.keys(object(data.ownershipVector)).length
      ||Object.entries(data.ownershipVector).some(([k,v])=>!text(k,128)||k==='_local'||!text(v)))throw new Error('fop_replica_invalid_authorization')
    const numericId=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)
    if(new Set(data.employees.map(e=>e.authUserId)).size!==data.employees.length||data.employees.some(e=>!text(e.authUserId,128)||!numericId(e.personRecordId)||!numericId(e.masterId)||!text(e.number,128)||typeof e.enabled!=='boolean')
      ||data.references.some(r=>!REPLICA_REFERENCES.includes(r.resource)||!text(r.sourceId,128)||!text(r.name,1000)||typeof r.version!=='string'||!/^\d{1,30}$/.test(r.version)||typeof r.deleted!=='boolean'))throw new Error('fop_replica_invalid_authorization')
    return data as ReplicaAuthorization
  }
  async reconcile(scope: ReplicaDatasetScope,barrier: ReplicaBarrier): Promise<ReplicaReconciliation> {
    const data=await this.call('RECONCILE',scope,{barrierId:barrier.id,targetVector:barrier.targetVector})
    if(data.barrierId!==barrier.id||data.scopeVersion!==barrier.scopeVersion||JSON.stringify(Object.entries(object(data.targetVector)).sort())!==JSON.stringify(Object.entries(barrier.targetVector).sort())
      ||!Array.isArray(data.entities)||!data.entities.length||new Set(data.entities.map(e=>e.entityCode)).size!==data.entities.length
      ||data.entities.some(e=>!text(e.entityCode,128)||!Number.isSafeInteger(e.count)||e.count<0||Object.entries(object(e.amounts)).some(([c,v])=>!/^([A-Z]{3})$/.test(c)||typeof v!=='string'||!/^\d{1,20}(?:\.\d{1,8})?$/.test(v))))throw new Error('fop_replica_invalid_reconciliation')
    return data as ReplicaReconciliation
  }
}
