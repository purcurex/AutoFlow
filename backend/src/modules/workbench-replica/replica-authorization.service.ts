import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { DataSource, EntityManager } from 'typeorm'
import { ReplicaHttpSource } from './replica-http-source'
import type { ReplicaDatasetScope } from './replica-change-contract'
import type { ReplicaAuthorization } from './replica-source-api'

/** Permissions have a separate short lease; refreshing them never enumerates business documents. */
@Injectable()
export class ReplicaAuthorizationService implements OnModuleInit, OnModuleDestroy {
  private readonly pending=new Map<string,Promise<void>>()
  private timer?:ReturnType<typeof setInterval>
  private working=false
  private readonly logger=new Logger(ReplicaAuthorizationService.name)
  constructor(private readonly db:DataSource,private readonly config:ConfigService,private readonly source:ReplicaHttpSource){}
  onModuleInit(){
    if(this.config.get<string>('WORKBENCH_AUTOMATIC_CALLS_ENABLED')==='false'||this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase()==='true'||this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true'||!this.source.isConfigured())return
    this.timer=setInterval(()=>{void this.tick().catch(()=>this.logger.warn('Independent FOP authorization refresh failed; expired proofs remain unavailable'))},20000);this.timer.unref()
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  async tick(){
    if(this.working||this.config.get<string>('WORKBENCH_AUTOMATIC_CALLS_ENABLED')==='false'||this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase()==='true'||this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true'||!this.source.isConfigured())return
    this.working=true
    try{
      const rows=await this.db.query("SELECT co.id,co.connection_id FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id WHERE c.status='active' AND co.enabled ORDER BY co.verified_at NULLS FIRST LIMIT 50")
      for(const row of rows)await this.ensure({connectionId:row.connection_id,companyId:row.id})
    }finally{this.working=false}
  }
  async ensure(scope:Omit<ReplicaDatasetScope,'datasetId'>) {
    if(this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true')return
    const [row]=await this.db.query('SELECT verified_at,expires_at FROM hz_fop_companies WHERE connection_id=$1 AND id=$2',[scope.connectionId,scope.companyId])
    if(this.config.get<string>('WORKBENCH_AUTOMATIC_CALLS_ENABLED')==='false'){
      const now=Date.now(),verified=Date.parse(row?.verified_at),expires=Date.parse(row?.expires_at)
      if(verified<=now&&verified>=now-60000&&expires>now)return
      throw new ServiceUnavailableException({code:'workbench_replica_authorization_stale',message:'Automatic authorization calls are disabled; explicitly synchronize to renew current proof'})
    }
    if(row&&Date.parse(row.verified_at)>=Date.now()-20000&&Date.parse(row.expires_at)>Date.now()+10000)return
    const key=`${scope.connectionId}:${scope.companyId}`
    let promise=this.pending.get(key)
    if(!promise){promise=this.refresh(scope).then(()=>undefined).finally(()=>this.pending.delete(key));this.pending.set(key,promise)}
    try{await promise}catch(error){const raw=(error as Error).message;const code=/^(fop_|workbench_)[a-z0-9_]+$/.test(raw)?raw:'workbench_replica_authorization_unavailable';throw new ServiceUnavailableException({code,message:code})}
  }
  private async renewEmployeeBindings(manager: EntityManager, connectionId: string, company: Record<string, any>, proof: ReplicaAuthorization) {
    const bindings: Record<string, any>[] = await manager.query(`SELECT b.*,u.fop_tenant_id,u.fop_user_id FROM hz_fop_employee_bindings b
      JOIN users u ON u.id=b.local_account_id WHERE b.connection_id=$1`, [connectionId])
    // Directory proofs are connection-wide. A delayed company's refresh must not undo a newer identity decision.
    if (bindings.some(binding => binding.last_checked_at && Date.parse(binding.last_checked_at) > Date.parse(proof.sourceAsOf))) return
    const companies: Record<string, any>[] = await manager.query('SELECT source_company_id FROM hz_fop_companies WHERE connection_id=$1 AND enabled', [connectionId])
    const companyIds = new Set(companies.map(row => row.source_company_id))
    const candidates: Record<string, any>[] = await manager.query(`SELECT u.id AS local_account_id,u.fop_tenant_id,u.fop_user_id,u.fop_binding_details,
      u.account_disabled,u.organization_workspace_owner_id,e.id AS local_employee_id,e.owner_user_id,e.archived_at,e.name
      FROM organization_employees e JOIN users u ON u.id=e.account_id WHERE e.owner_user_id=$1 AND u.fop_tenant_id=$2 FOR UPDATE OF u,e`, [company.workspace_owner_id, company.tenant_id])
    const accounts = new Set([...bindings.map(row => row.local_account_id), ...candidates.map(row => row.local_account_id)])
    const numeric = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    const plans: Record<string, any>[] = []
    for (const accountId of accounts) {
      const binding = bindings.find(row => row.local_account_id === accountId)
      const employees = candidates.filter(row => row.local_account_id === accountId && !row.archived_at)
      const employee = employees.length === 1 ? employees[0] : undefined
      const details = employee?.fop_binding_details
      const local = !!employee && !employee.account_disabled && employee.owner_user_id === company.workspace_owner_id
        && (!employee.organization_workspace_owner_id || employee.organization_workspace_owner_id === company.workspace_owner_id)
        && employee.fop_tenant_id === company.tenant_id
      const legacy = local && details && typeof details === 'object' && !Array.isArray(details)
        && details.localEmployeeId === employee!.local_employee_id && companyIds.has(details.organizationId)
        && numeric(details.employeeRecordId) && numeric(details.employeeMasterId) && typeof details.employeeNumber === 'string' && !!details.employeeNumber.trim()
        && typeof details.verifiedAt === 'string' && Number.isFinite(Date.parse(details.verifiedAt)) && Date.parse(details.verifiedAt) <= Date.parse(proof.sourceAsOf)
      const authId = binding?.auth_user_id ?? employee?.fop_user_id ?? null
      const sameAccount = local && typeof authId === 'string' && !!authId.trim() && employee!.fop_user_id === authId
      const previouslyVerified = !!binding && (['directory_verified', 'identity_verified'].includes(binding.state) || binding.evidence?.trustedAuthUserId === authId)
      const person = proof.employees.find(row => row.authUserId === authId)
      const unique = !!person && proof.employees.filter(row => row.masterId === person.masterId || row.personRecordId === person.personRecordId || row.authUserId === person.authUserId).length === 1
      const legacyMatches = legacy && !!person && details.employeeRecordId === person.personRecordId && details.employeeMasterId === person.masterId && details.employeeNumber === person.number
      const enabled = sameAccount && !!person?.enabled && unique && (previouslyVerified || legacyMatches)
      const trustedAuth = previouslyVerified || enabled
      plans.push({ id: binding?.id ?? randomUUID(), accountId, authId,
        personId: enabled ? person!.personRecordId : binding?.person_record_id ?? null,
        masterId: enabled ? person!.masterId : binding?.employee_master_id ?? null,
        number: enabled ? person!.number : binding?.employee_number ?? null,
        username: binding?.username ?? (legacy ? details.username ?? null : null), displayName: employee?.name ?? binding?.display_name ?? null,
        state: enabled ? previouslyVerified && binding.state === 'directory_verified' && !legacyMatches ? 'directory_verified' : 'identity_verified' : 'disabled', enabled,
        identityVerifiedAt: binding?.identity_verified_at ?? (legacyMatches && enabled ? details.verifiedAt : null),
        evidence: { ...(binding?.evidence ?? {}), contract: 'fop-replica/1', ...(trustedAuth ? { trustedAuthUserId: authId } : {}), directoryScopeVersion: proof.scopeVersion },
      })
    }
    // Multiple local accounts claiming one source identity must all remain disabled, without unique-index races.
    const conflicts = plans.filter(plan => plan.enabled && plans.some(other => other !== plan && other.enabled
      && (other.authId === plan.authId || other.masterId === plan.masterId || other.personId === plan.personId)))
    for (const plan of conflicts) { plan.enabled = false; plan.state = 'disabled'; delete plan.evidence.trustedAuthUserId }
    const write = (plan: Record<string, any>, enabled: boolean) => manager.query(`INSERT INTO hz_fop_employee_bindings
      (id,connection_id,local_account_id,person_record_id,employee_master_id,employee_number,username,auth_user_id,display_name,state,enabled,directory_verified_at,identity_verified_at,last_checked_at,evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT(connection_id,local_account_id) DO UPDATE SET person_record_id=EXCLUDED.person_record_id,employee_master_id=EXCLUDED.employee_master_id,
      employee_number=EXCLUDED.employee_number,username=EXCLUDED.username,auth_user_id=EXCLUDED.auth_user_id,display_name=EXCLUDED.display_name,state=EXCLUDED.state,
      enabled=EXCLUDED.enabled,directory_verified_at=EXCLUDED.directory_verified_at,identity_verified_at=EXCLUDED.identity_verified_at,last_checked_at=EXCLUDED.last_checked_at,evidence=EXCLUDED.evidence,updated_at=now()`,
      [plan.id, connectionId, plan.accountId, plan.personId, plan.masterId, plan.number, plan.username, plan.authId, plan.displayName,
        enabled ? plan.state : 'disabled', enabled, enabled ? proof.sourceAsOf : null, plan.identityVerifiedAt, proof.sourceAsOf, JSON.stringify(plan.evidence)])
    // Release obsolete identity uniqueness claims before applying the current complete directory atomically.
    for (const plan of plans) await write(plan, false)
    for (const plan of plans.filter(plan => plan.enabled)) await write(plan, true)
  }
  async refresh(scope:Omit<ReplicaDatasetScope,'datasetId'>) {
    if(this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase()==='true')throw new Error('fop_queries_paused')
    if(this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true')throw new Error('fop_replica_mock_source_forbidden')
    const proof=await this.source.authorization(scope)
    await this.db.transaction(async m=>{
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`replica-directory:${scope.connectionId}`])
      const [company]=await m.query('SELECT co.id,co.verified_at,c.tenant_id,c.workspace_owner_id FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id WHERE co.id=$1 AND c.id=$2 AND c.status=\'active\' AND co.enabled FOR UPDATE OF co',[scope.companyId,scope.connectionId])
      if(!company)throw new Error('fop_replica_scope_unavailable')
      if(company.verified_at&&Date.parse(company.verified_at)>Date.parse(proof.sourceAsOf))throw new Error('fop_replica_authorization_regressed')
      const previous:Record<string,any>[]=await m.query('SELECT id,resource_type,target_key,decision,grant_version,evidence FROM hz_fop_resource_grants WHERE connection_id=$1 AND company_id=$2',[scope.connectionId,scope.companyId])
      const next=proof.resources.flatMap(resource=>(proof.companyAllowed&&resource.grants.length?resource.grants:[{target:'*',decision:'deny'}]).map(grant=>({resource_type:resource.resource,target_key:grant.target,decision:grant.decision,grant_version:proof.scopeVersion})))
      const signature=(rows:Record<string,any>[])=>JSON.stringify(rows.map(r=>[r.resource_type,r.target_key,r.decision,r.grant_version]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
      const vectorSignature=(v:Record<string,string>)=>JSON.stringify(Object.entries(v).sort())
      const changed=signature(previous)!==signature(next)||previous.some(g=>vectorSignature(g.evidence?.ownershipVector??{})!==vectorSignature(proof.ownershipVector))
      // Source timestamp is preserved. Fetch time never extends the source authorization lease.
      await m.query('DELETE FROM hz_fop_resource_grants WHERE connection_id=$1 AND company_id=$2',[scope.connectionId,scope.companyId])
      for(const resource of proof.resources){
        const grants=proof.companyAllowed&&resource.grants.length?resource.grants:[{target:'*',decision:'deny'}]
        for(const grant of grants)await m.query(`INSERT INTO hz_fop_resource_grants(id,connection_id,company_id,resource_type,target_key,decision,grant_version,verified_at,source_as_of,expires_at,evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10::jsonb)`,[previous.find(g=>g.resource_type===resource.resource&&g.target_key===grant.target)?.id??randomUUID(),scope.connectionId,scope.companyId,resource.resource,grant.target,grant.decision,proof.scopeVersion,proof.sourceAsOf,proof.expiresAt,JSON.stringify({contract:'fop-replica/1',serviceIdentity:true,ownershipVector:proof.ownershipVector})])
      }
      // Only existing workspace accounts/employees can receive bindings; source data never creates identities or roles.
      await this.renewEmployeeBindings(m, scope.connectionId, company, proof)
      for(const ref of proof.references)await m.query(`INSERT INTO hz_fop_reference_items(id,connection_id,company_id,resource_type,source_id,master_id,code,name,source_version,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(connection_id,company_id,resource_type,source_id) DO UPDATE
        SET master_id=EXCLUDED.master_id,code=EXCLUDED.code,name=EXCLUDED.name,source_version=EXCLUDED.source_version,deleted_at=EXCLUDED.deleted_at,synced_at=now()
        WHERE hz_fop_reference_items.source_version IS NULL OR hz_fop_reference_items.source_version<=EXCLUDED.source_version`,[randomUUID(),scope.connectionId,scope.companyId,ref.resource,ref.sourceId,ref.masterId??null,ref.code??null,ref.name,ref.version,ref.deleted?proof.sourceAsOf:null])
      // A source ownership barrier is distinct from a local receipt time. Missing/advanced streams revoke the proof.
      const datasets=await m.query("SELECT id FROM hz_fop_datasets WHERE connection_id=$1 AND company_id=$2 AND state IN ('building','replaying','validating','active')",[scope.connectionId,scope.companyId])
      for(const dataset of datasets){
        const streams:Record<string,any>[]=await m.query('SELECT stream_key,source_scope_version,applied_cursor FROM hz_fop_sync_streams WHERE dataset_id=$1',[dataset.id])
        const covered=proof.companyAllowed&&streams.length===Object.keys(proof.ownershipVector).length&&streams.every(s=>s.source_scope_version===proof.scopeVersion&&proof.ownershipVector[s.stream_key]===s.applied_cursor)
        const at=covered?proof.sourceAsOf:'1970-01-01T00:00:00Z'
        await m.query(`UPDATE hz_fop_workbench_orders SET ownership_verified_at=$2 WHERE dataset_id=$1
          AND ownership_version IS NOT NULL AND owner_employee_id IS NOT NULL AND ownership_verified_at<=$3`,[dataset.id,at,proof.sourceAsOf])
        await m.query(`UPDATE hz_fop_workbench_receipt_notices p SET ownership_verified_at=$2 FROM hz_fop_source_documents d
          WHERE d.id=p.document_id AND d.dataset_id=$1 AND cardinality(p.owner_employee_ids)>0 AND p.ownership_verified_at<=$3`,[dataset.id,at,proof.sourceAsOf])
      }
      await m.query('UPDATE hz_fop_companies SET scope_version=scope_version+$4,verified_at=$2,expires_at=$3,updated_at=now() WHERE id=$1',[scope.companyId,proof.sourceAsOf,proof.expiresAt,changed?1:0])
    })
    if(!proof.companyAllowed)throw new Error('fop_replica_company_access_denied')
    return proof
  }
}
