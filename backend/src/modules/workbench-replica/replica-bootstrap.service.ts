import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import Decimal from 'decimal.js'
import { DataSource, EntityManager } from 'typeorm'
import { ReplicaHttpSource } from './replica-http-source'
import { ReplicaPublisher } from './replica-publisher'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { ReplicaSnapshotStaging } from './replica-snapshot-staging'
import type { ReplicaBarrier, ReplicaDatasetScope } from './replica-change-contract'
import type { ReplicaSnapshot } from './replica-source-api'
import { REPLICA_API_KEYS } from './replica-source-api'

type Row=Record<string,any>
const failure=(code:string,cause?:unknown)=>new ServiceUnavailableException({code,message:code},{cause})

/** Explicit administrator invocation only. Each call does bounded work; repeating its key resumes durable cursors. */
@Injectable()
export class ReplicaBootstrapService {
  constructor(private readonly db:DataSource,private readonly config:ConfigService,private readonly source:ReplicaHttpSource,
    private readonly publisher:ReplicaPublisher,private readonly authorization:ReplicaAuthorizationService){}
  /** Local-only readiness. No credentials, addresses or source requests are exposed. */
  async readiness(userId:string){
    const [actor]=await this.db.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND NOT account_disabled",[userId])
    if(!actor)return {allowed:false}
    const keys=[...REPLICA_API_KEYS.map(key=>`FOP_REPLICA_${key}_URL`),'FOP_REPLICA_TENANT_ID','FOP_REPLICA_COMPANY_ID','FOP_REPLICA_ACCESS_TOKEN']
    const missingConfiguration=keys.filter(key=>!this.config.get<string>(key)?.trim())
    const configured=this.source.isConfigured()
    const blockers=[...(this.config.get<string>('FOP_QUERIES_PAUSED')==='true'?['fop_queries_paused']:[]),
      ...(this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true'?['workbench_bootstrap_mock_forbidden']:[]),
      ...(!configured||missingConfiguration.length?['workbench_replica_sync_not_configured']:[])]
    const [pending]=await this.db.query(`SELECT co.id company_id,b.page_progress->>'requestKey' request_key,b.state,b.validation_report->>'errorCode' error_code
      FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id
      JOIN hz_fop_bootstrap_batches b ON b.company_id=co.id AND b.connection_id=c.id
      WHERE c.workspace_owner_id=$1 AND c.status='active' AND co.enabled AND b.state<>'published' ORDER BY b.created_at DESC LIMIT 1`,[userId])
    return {allowed:true,configured,executable:blockers.length===0,blockers,missingConfiguration,
      resume:pending?{companyId:pending.company_id,requestKey:pending.request_key,state:pending.state,errorCode:pending.error_code??null}:null}
  }
  private enabled(){
    if(this.config.get<string>('FOP_QUERIES_PAUSED')?.trim().toLowerCase()==='true')throw failure('fop_queries_paused')
    if(this.config.get<string>('WORKBENCH_MOCK_ENABLED')==='true')throw failure('workbench_bootstrap_mock_forbidden')
    if(this.config.get<string>('WORKBENCH_READ_MODE','local')!=='local'||!this.source.isConfigured())throw failure('workbench_replica_sync_not_configured')
  }
  private async administrator(userId:string,companyId:string){
    const [company]=await this.db.query(`SELECT c.id connection_id,co.id company_id,co.active_dataset_id FROM hz_fop_connections c
      JOIN hz_fop_companies co ON co.connection_id=c.id JOIN users u ON u.id=c.workspace_owner_id
      WHERE u.id=$1 AND co.id=$2 AND u.role='admin' AND NOT u.account_disabled AND c.status='active' AND co.enabled`,[userId,companyId])
    if(!company)throw new ForbiddenException('workbench_bootstrap_forbidden')
    return company
  }
  async configure(userId:string){
    const [actor]=await this.db.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND NOT account_disabled",[userId])
    if(!actor)throw new ForbiddenException('workbench_bootstrap_forbidden')
    const tenant=this.config.get<string>('FOP_REPLICA_TENANT_ID')?.trim(),sourceCompany=this.config.get<string>('FOP_REPLICA_COMPANY_ID')?.trim()
    if(!tenant||!sourceCompany||tenant.length>128||sourceCompany.length>128||!this.source.isConfigured())throw failure('workbench_replica_sync_not_configured')
    const origin=new URL(this.config.get<string>('FOP_REPLICA_SNAPSHOT_BEGIN_URL')!).origin
    return this.db.transaction(async m=>{
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`replica-configure:${userId}:${tenant}:${origin}`])
      let [connection]=await m.query("SELECT id FROM hz_fop_connections WHERE workspace_owner_id=$1 AND tenant_id=$2 AND base_url=$3 AND name='FOP service replica'",[userId,tenant,origin])
      if(!connection){connection={id:randomUUID()};await m.query(`INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES($1,$2,'FOP service replica','test',$3,$4,'env:FOP_REPLICA_ACCESS_TOKEN','active')`,[connection.id,userId,tenant,origin])}
      let [company]=await m.query('SELECT id FROM hz_fop_companies WHERE connection_id=$1 AND source_company_id=$2',[connection.id,sourceCompany])
      if(!company){company={id:randomUUID()};await m.query(`INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,enabled) VALUES($1,$2,$3,$4,true)`,[company.id,connection.id,sourceCompany,this.config.get<string>('FOP_REPLICA_COMPANY_NUMBER',sourceCompany)])}
      return {connectionId:connection.id,companyId:company.id,configured:true,sourceVerified:false}
    })
  }
  async status(userId:string,companyId:string,requestKey:string){
    await this.administrator(userId,companyId)
    const [batch]=await this.db.query("SELECT id,dataset_id,state,page_progress,validation_report FROM hz_fop_bootstrap_batches WHERE company_id=$1 AND page_progress->>'requestKey'=$2",[companyId,requestKey])
    return batch?{id:batch.id,datasetId:batch.dataset_id,state:batch.state,errorCode:batch.validation_report.errorCode??null,stage:batch.page_progress.stage}:{state:'not_started'}
  }
  async initialize(userId:string,companyId:string,requestKey:string){
    const company=await this.administrator(userId,companyId);this.enabled()
    const lock=this.db.createQueryRunner();await lock.connect()
    const lockKey=`bootstrap:${company.connection_id}:${companyId}`
    let held=false,batch:Row|undefined
    try{
      held=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) acquired',[lockKey]))[0].acquired
      if(!held)throw new ConflictException('workbench_bootstrap_running')
      ;[batch]=await this.db.query("SELECT * FROM hz_fop_bootstrap_batches WHERE company_id=$1 AND page_progress->>'requestKey'=$2",[companyId,requestKey])
      if(batch?.state==='published')return this.status(userId,companyId,requestKey)
      if(!batch){
        const other=await this.db.query("SELECT id FROM hz_fop_bootstrap_batches WHERE company_id=$1 AND state NOT IN ('published','failed') LIMIT 1",[companyId])
        if(other.length)throw new ConflictException('workbench_bootstrap_resume_required')
        const scope={connectionId:company.connection_id,companyId,datasetId:randomUUID()}
        const manifest=await this.source.begin(scope,requestKey)
        const watermarks=Object.fromEntries(manifest.streams.map(stream=>[stream.key,stream.endCursor]))
        batch={id:randomUUID(),dataset_id:scope.datasetId,sync_run_id:randomUUID(),snapshot_id:manifest.snapshotId,page_progress:{requestKey,stage:'importing',manifest},state:'importing'}
        await this.db.transaction(async m=>{
          const [current]=await m.query('SELECT active_dataset_id FROM hz_fop_companies WHERE id=$1 AND connection_id=$2 FOR UPDATE',[companyId,scope.connectionId])
          if(!current)throw new Error('workbench_scope_changed')
          await m.query(`INSERT INTO hz_fop_datasets(id,connection_id,company_id,previous_dataset_id,snapshot_id,start_watermarks) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[scope.datasetId,scope.connectionId,companyId,current.active_dataset_id,manifest.snapshotId,JSON.stringify(watermarks)])
          await m.query(`INSERT INTO hz_fop_sync_runs(id,connection_id,company_id,dataset_id,trigger_type,state,started_at) VALUES($1,$2,$3,$4,'bootstrap','running',now())`,[batch!.sync_run_id,scope.connectionId,companyId,scope.datasetId])
          await m.query(`INSERT INTO hz_fop_bootstrap_batches(id,connection_id,company_id,dataset_id,sync_run_id,snapshot_id,start_watermarks,entity_scope,page_progress,state) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'importing')`,[batch!.id,scope.connectionId,companyId,scope.datasetId,batch!.sync_run_id,manifest.snapshotId,JSON.stringify(watermarks),JSON.stringify(manifest.entityCodes),JSON.stringify(batch!.page_progress)])
          for(const stream of manifest.streams)await m.query(`INSERT INTO hz_fop_sync_streams(id,connection_id,company_id,dataset_id,stream_key,source_scope_version,state) VALUES($1,$2,$3,$4,$5,$6,'initializing')`,[randomUUID(),scope.connectionId,companyId,scope.datasetId,stream.key,manifest.scopeVersion])
        })
      }
      const scope={connectionId:company.connection_id,companyId,datasetId:batch.dataset_id},progress=batch.page_progress
      const manifest:ReplicaSnapshot=progress.manifest
      await this.db.query("UPDATE hz_fop_sync_runs SET state='running',last_error_code=NULL,finished_at=NULL WHERE id=$1",[batch.sync_run_id])
      await this.db.query("UPDATE hz_fop_bootstrap_batches SET state=$2,validation_report=validation_report-'errorCode',updated_at=now() WHERE id=$1",[batch.id,progress.stage])
      let budget=Number(this.config.get<string>('WORKBENCH_BOOTSTRAP_PAGE_BUDGET','10'))
      if(!Number.isInteger(budget)||budget<1||budget>100)budget=10
      if(progress.stage==='importing'){
        const staging=new ReplicaSnapshotStaging(this.db)
        // Collection cursors belong to durable staging pages, not the unapplied business stream.
        for(const target of manifest.streams){
          const [stream]=await this.db.query('SELECT * FROM hz_fop_sync_streams WHERE dataset_id=$1 AND stream_key=$2',[scope.datasetId,target.key])
          let latest=await staging.latest(batch.id,stream.id)
          while(!latest?.complete){
            if(budget--<=0)return this.status(userId,companyId,requestKey)
            this.enabled()
            if(Date.parse(manifest.expiresAt)<=Date.now())throw new Error('workbench_snapshot_expired')
            const page=await this.source.page(scope,manifest,target.key,latest?.end_cursor??null)
            await staging.collect(scope,batch.id,stream.id,manifest.snapshotId,page,target.endCursor)
            latest=await staging.latest(batch.id,stream.id)
          }
        }
        // Local preparation/publication each have the same bounded page allowance. A single-page
        // snapshot can complete locally in this call even when collection spent the source budget.
        const localBudget=Number(this.config.get<string>('WORKBENCH_BOOTSTRAP_PAGE_BUDGET','10'))
        const allowance=Number.isInteger(localBudget)&&localBudget>=1&&localBudget<=100?localBudget:10
        progress.snapshotPhase='preparing';await this.save(batch,'importing')
        for(const page of await staging.pages(batch.id,'collected',allowance)){
          this.enabled();await staging.prepare(scope,batch.id,page)
        }
        if((await staging.pages(batch.id,'collected',1)).length)return this.status(userId,companyId,requestKey)
        progress.snapshotPhase='publishing';await this.save(batch,'importing')
        for(const page of await staging.pages(batch.id,'prepared',allowance)){
          this.enabled()
          for(const group of page.groups)await this.publisher.apply(scope,page.stream_id,group,undefined,{batchId:batch.id})
          const [stream]=await this.db.query('SELECT stream_key FROM hz_fop_sync_streams WHERE id=$1',[page.stream_id])
          const target=manifest.streams.find(target=>target.key===stream.stream_key)
          if(!target)throw new Error('workbench_snapshot_scope_changed')
          await staging.applied(scope,batch.id,page,target.endCursor)
        }
        if((await staging.pages(batch.id,'prepared',1)).length)return this.status(userId,companyId,requestKey)
        const [unverified]=await this.db.query("SELECT count(*)::int n FROM hz_fop_source_documents WHERE dataset_id=$1 AND (validation_state='unverified' OR source_version IS NULL)",[scope.datasetId])
        if(unverified.n)throw new Error('workbench_snapshot_unverified_identity')
        progress.stage='replaying';progress.snapshotPhase='applied';await this.save(batch,'replaying')
        await this.db.query("UPDATE hz_fop_datasets SET state='replaying' WHERE id=$1",[scope.datasetId])
      }
      let barrier:ReplicaBarrier=progress.barrier
      if(!barrier||Date.parse(barrier.expiresAt)<=Date.now()){
        barrier=await this.source.barrier(scope)
        if(barrier.scopeVersion!==manifest.scopeVersion||JSON.stringify(Object.keys(barrier.targetVector).sort())!==JSON.stringify(manifest.streams.map(s=>s.key).sort()))throw new Error('workbench_snapshot_scope_changed')
        progress.barrier=barrier;await this.save(batch,progress.stage)
      }
      for(const [key,target] of Object.entries(barrier.targetVector)){
        const [stream]=await this.db.query('SELECT * FROM hz_fop_sync_streams WHERE dataset_id=$1 AND stream_key=$2',[scope.datasetId,key])
        while(stream.applied_cursor!==target){
          if(budget--<=0)return this.status(userId,companyId,requestKey)
          this.enabled()
          if(Date.parse(barrier.expiresAt)<=Date.now())throw new Error('workbench_barrier_expired')
          const groups=await this.source.groups(scope,key,stream.applied_cursor,target)
          if(!groups.length)throw new Error('workbench_changes_no_progress')
          for(const group of groups){
            if(stream.applied_cursor===target)throw new Error('workbench_changes_past_barrier')
            stream.applied_cursor=await this.publisher.apply(scope,stream.id,group)
          }
        }
      }
      progress.stage='validating';await this.save(batch,'validating')
      await this.db.query("UPDATE hz_fop_datasets SET state='validating' WHERE id=$1",[scope.datasetId])
      const report=await this.source.reconcile(scope,barrier)
      const proof=await this.authorization.refresh(scope)
      if(proof.scopeVersion!==manifest.scopeVersion)throw new Error('workbench_snapshot_scope_changed')
      await this.administrator(userId,companyId);this.enabled()
      await this.db.transaction(async m=>{
        const [current]=await m.query(`SELECT co.active_dataset_id,co.verified_at,co.expires_at,d.previous_dataset_id FROM hz_fop_companies co JOIN hz_fop_connections c ON c.id=co.connection_id
          JOIN hz_fop_datasets d ON d.company_id=co.id AND d.id=$2 WHERE co.id=$1 AND co.connection_id=$3 AND c.status='active' AND co.enabled FOR UPDATE OF co,d`,[companyId,scope.datasetId,scope.connectionId])
        if(!current||current.active_dataset_id!==current.previous_dataset_id||Date.parse(current.expires_at)<=Date.now()||Date.parse(barrier.expiresAt)<=Date.now())throw new Error('workbench_cutover_scope_changed')
        await this.validate(m,scope,manifest.entityCodes,report.entities)
        const streams:Row[]=await m.query('SELECT stream_key,applied_cursor FROM hz_fop_sync_streams WHERE dataset_id=$1 FOR UPDATE',[scope.datasetId])
        if(streams.some(s=>barrier.targetVector[s.stream_key]!==s.applied_cursor))throw new Error('workbench_cutover_cursor_changed')
        const barrierId=randomUUID()
        await m.query(`INSERT INTO hz_fop_sync_barriers(id,connection_id,company_id,dataset_id,sync_run_id,source_barrier_id,purpose,scope_version,target_vector,capture_proof,source_as_of,expires_at,state,satisfied_at)
          VALUES($1,$2,$3,$4,$5,$6,'bootstrap_cutover',$7,$8::jsonb,$9::jsonb,$10,$11,'satisfied',now())`,[barrierId,scope.connectionId,companyId,scope.datasetId,batch!.sync_run_id,barrier.id,barrier.scopeVersion,JSON.stringify(barrier.targetVector),JSON.stringify(barrier.proof),barrier.sourceAsOf,barrier.expiresAt])
        if(current.active_dataset_id)await m.query("UPDATE hz_fop_datasets SET state='retired',retired_at=now() WHERE id=$1",[current.active_dataset_id])
        await m.query("UPDATE hz_fop_datasets SET state='active',validated_at=now(),activated_at=now(),applied_watermarks=jsonb_set(applied_watermarks||$2::jsonb,'{_local}',COALESCE(applied_watermarks->'_local','{}'::jsonb)||jsonb_build_object('entityCodes',$3::jsonb)) WHERE id=$1",[scope.datasetId,JSON.stringify(barrier.targetVector),JSON.stringify(manifest.entityCodes)])
        await m.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1',[companyId,scope.datasetId])
        await m.query("UPDATE hz_fop_bootstrap_batches SET state='published',published_at=now(),cutover_barrier_id=$2,validation_report=$3::jsonb WHERE id=$1",[batch!.id,barrierId,JSON.stringify({verified:true,entities:report.entities,sourceAsOf:barrier.sourceAsOf})])
        await m.query("UPDATE hz_fop_sync_runs SET state='succeeded',finished_at=now(),target_watermarks=$2::jsonb,achieved_watermarks=$2::jsonb WHERE id=$1",[batch!.sync_run_id,JSON.stringify(barrier.targetVector)])
      })
      return this.status(userId,companyId,requestKey)
    }catch(error){
      if(batch){
        const raw=(error as Error).message,code=/^(workbench_|fop_)[a-z0-9_]+$/.test(raw)?raw:'workbench_bootstrap_failed'
        await this.db.query("UPDATE hz_fop_bootstrap_batches SET state='failed',validation_report=$2::jsonb,updated_at=now() WHERE id=$1 AND state<>'published'",[batch.id,JSON.stringify({errorCode:code})])
        await this.db.query("UPDATE hz_fop_sync_runs SET state='failed',last_error_code=$2,finished_at=now() WHERE id=$1 AND state<>'succeeded'",[batch.sync_run_id,code])
        throw failure(code,error)
      }
      throw error
    }finally{if(held)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockKey]);await lock.release()}
  }
  private async save(batch:Row,state:string){await this.db.query('UPDATE hz_fop_bootstrap_batches SET state=$2,page_progress=$3::jsonb,updated_at=now() WHERE id=$1',[batch.id,state,JSON.stringify(batch.page_progress)])}
  private async validate(m:EntityManager,scope:ReplicaDatasetScope,entities:string[],expected:{entityCode:string;count:number;amounts:Record<string,string>}[]){
    if(JSON.stringify([...entities].sort())!==JSON.stringify(expected.map(e=>e.entityCode).sort()))throw new Error('workbench_reconciliation_entity_mismatch')
    const actual:Row[]=await m.query("SELECT entity_code,count(*)::int count FROM hz_fop_source_documents WHERE company_id=$1 AND dataset_id=$2 AND deleted_at IS NULL GROUP BY entity_code",[scope.companyId,scope.datasetId])
    if(actual.some(e=>!entities.includes(e.entity_code)))throw new Error('workbench_reconciliation_entity_mismatch')
    const amountTables:Record<string,string>={hzkj_orders:'hz_fop_fulfillment_orders',hzkj_stock_order_new:'hz_fop_stock_orders',hzkj_purorderbill:'hz_fop_purchase_orders'}
    for(const entity of expected){
      if((actual.find(e=>e.entity_code===entity.entityCode)?.count??0)!==entity.count)throw new Error('workbench_reconciliation_count_mismatch')
      const table=amountTables[entity.entityCode]
      if(table){
        const rows:Row[]=await m.query(`SELECT h.settlement_currency currency,sum(h.total_amount)::text amount,count(*) FILTER(WHERE h.total_amount IS NULL OR h.settlement_currency IS NULL)::int missing FROM ${table} h JOIN hz_fop_source_documents d ON d.id=h.document_id WHERE d.company_id=$1 AND d.dataset_id=$2 AND d.deleted_at IS NULL GROUP BY h.settlement_currency`,[scope.companyId,scope.datasetId])
        if(rows.some(r=>r.missing)||rows.length!==Object.keys(entity.amounts).length||rows.some(r=>entity.amounts[r.currency]===undefined||!new Decimal(r.amount).eq(entity.amounts[r.currency])))throw new Error('workbench_reconciliation_amount_mismatch')
      }else if(Object.keys(entity.amounts).length)throw new Error('workbench_reconciliation_amount_not_supported')
    }
    const [unverified]=await m.query("SELECT count(*)::int n FROM hz_fop_source_documents WHERE company_id=$1 AND dataset_id=$2 AND (validation_state NOT IN ('verified','deleted') OR source_version IS NULL OR payload ? 'bootstrapBatchId')",[scope.companyId,scope.datasetId])
    if(unverified.n)throw new Error('workbench_reconciliation_unverified_identity')
    const [ownership]=await m.query(`SELECT
      (SELECT count(*) FROM hz_fop_workbench_orders WHERE dataset_id=$1 AND (owner_employee_id IS NULL OR ownership_version IS NULL OR ownership_verified_at IS NULL OR ownership_verified_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds' OR ownership_verified_at>CURRENT_TIMESTAMP))+
      (SELECT count(*) FROM hz_fop_workbench_receipt_notices p JOIN hz_fop_source_documents d ON d.id=p.document_id WHERE d.dataset_id=$1 AND d.deleted_at IS NULL AND (cardinality(p.owner_employee_ids)=0 OR p.ownership_verified_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds' OR p.ownership_verified_at>CURRENT_TIMESTAMP)) AS n`,[scope.datasetId])
    if(Number(ownership.n)>0)throw new Error('workbench_reconciliation_ownership_incomplete')
    const [invalid]=await m.query(`SELECT
      (SELECT count(*) FROM hz_fop_source_documents d LEFT JOIN hz_fop_workbench_orders o ON o.document_id=d.id WHERE d.dataset_id=$1 AND d.deleted_at IS NULL AND d.entity_code IN ('hzkj_orders','hzkj_stock_order_new') AND (o.document_id IS NULL OR o.readiness<>'ready'))+
      (SELECT count(*) FROM hz_fop_document_relations WHERE dataset_id=$1 AND removed_at IS NULL AND resolution_state<>'resolved')+
      (SELECT count(*) FROM hz_fop_projection_dependencies p JOIN hz_fop_source_documents d ON d.id=p.source_document_id WHERE p.dataset_id=$1 AND (p.source_version IS DISTINCT FROM d.source_version OR p.relation_revision<>d.relation_revision)) AS n`,[scope.datasetId])
    if(Number(invalid.n)>0)throw new Error('workbench_reconciliation_incomplete')
  }
}
