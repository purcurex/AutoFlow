import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DataSource } from 'typeorm'
import { WORKBENCH_TABLE_COLUMNS } from '../../database/workbench-schema'
import { ReplicaBootstrapService } from './replica-bootstrap.service'
import { ReplicaHttpSource, REPLICA_RESOURCES } from './replica-http-source'
import { REPLICA_API_KEYS } from './replica-source-api'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { ReplicaPublisher } from './replica-publisher'
import { completeFulfillmentDomainFixture } from './replica-domain.fixture'
import { LocalWorkbenchService } from './local-workbench.service'
import { UsersService } from '../users/users.service'
import { ReplicaSyncService } from './replica-sync.service'

const database=process.env.LOCAL_WORKBENCH_TEST_DB
const integration=database?.match(/^hz_ddl_validation_\d+$/)?describe:describe.skip
integration('service API to PostgreSQL historical initialization',()=>{
  let db:DataSource,actor:string,connection:string,company:string,previous:string,source:ReplicaHttpSource,bootstrap:ReplicaBootstrapService
  let failChanges:boolean,mismatch:boolean,calls:string[],config:ConfigService,ownershipTarget:string
  async function cleanup(companyId:string,connectionId:string){
    await db.transaction(async m=>{
      await m.query('SET CONSTRAINTS ALL DEFERRED');await m.query('UPDATE hz_fop_companies SET active_dataset_id=NULL WHERE id=$1',[companyId])
      await m.query('UPDATE hz_fop_bootstrap_batches SET start_barrier_id=NULL,cutover_barrier_id=NULL WHERE company_id=$1',[companyId])
      const tables=Object.entries(WORKBENCH_TABLE_COLUMNS).filter(([,cols])=>cols.includes('company_id')).map(([table])=>table)
      while(tables.length){let progress=false
        for(const table of [...tables]){await m.query('SAVEPOINT cleanup_row')
          try{await m.query(`DELETE FROM ${table} WHERE company_id=$1`,[companyId]);tables.splice(tables.indexOf(table),1);progress=true}
          catch(error){await m.query('ROLLBACK TO SAVEPOINT cleanup_row');if((error as any).code!=='23503')throw error}
          await m.query('RELEASE SAVEPOINT cleanup_row')
        }
        if(!progress)throw new Error('Fixture cleanup dependency cycle')
      }
      await m.query('DELETE FROM hz_fop_companies WHERE id=$1',[companyId]);await m.query('DELETE FROM hz_fop_connections WHERE id=$1',[connectionId])
    })
  }
  beforeAll(async()=>{
    db=await new DataSource({type:'postgres',host:'127.0.0.1',port:55432,username:'autoflow_demo',database,password:readFileSync(resolve(__dirname,'../../../../.runtime/local-demo/database-password'),'utf8').trim()}).initialize()
    actor=(await db.query("SELECT id FROM users WHERE role='admin' AND NOT account_disabled ORDER BY id LIMIT 1"))[0].id
    const residue=await db.query("SELECT c.id connection_id,co.id company_id FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id WHERE c.name='Bootstrap API test' AND c.base_url='https://fixture.invalid'")
    for(const row of residue)await cleanup(row.company_id,row.connection_id)
  })
  afterAll(async()=>{await db?.destroy()})
  beforeEach(async()=>{
    connection=randomUUID();company=randomUUID();previous=randomUUID();calls=[];failChanges=false;mismatch=false;ownershipTarget='change-end'
    config=new ConfigService({...Object.fromEntries(REPLICA_API_KEYS.map(k=>[`FOP_REPLICA_${k}_URL`,`https://fixture.invalid/${k}`])),FOP_REPLICA_ACCESS_TOKEN:'synthetic-only',WORKBENCH_BOOTSTRAP_PAGE_BUDGET:'1'})
    await db.query(`INSERT INTO hz_fop_connections(id,workspace_owner_id,name,environment,tenant_id,base_url,credential_ref,status) VALUES($1,$2,'Bootstrap API test','test','fixture','https://fixture.invalid','fixture','active')`,[connection,actor])
    await db.query(`INSERT INTO hz_fop_companies(id,connection_id,source_company_id,company_number,enabled,verified_at,expires_at) VALUES($1,$2,'fixture','fixture',true,now()-interval '1 second',now()+interval '60 seconds')`,[company,connection])
    await db.query(`INSERT INTO hz_fop_datasets(id,connection_id,company_id,state,validated_at,activated_at) VALUES($1,$2,$3,'active',now(),now())`,[previous,connection,company])
    await db.query('UPDATE hz_fop_companies SET active_dataset_id=$2 WHERE id=$1',[company,previous])
    source=new ReplicaHttpSource(config,db,async(url,options)=>{
      const key=new URL(String(url)).pathname.slice(1),body=JSON.parse(String(options?.body));calls.push(key)
      const sourceAsOf=new Date(Date.now()-100).toISOString(),expiresAt=new Date(Date.now()+50000).toISOString()
      const common={scopeVersion:'v1',sourceAsOf,expiresAt}
      let data:object
      if(key==='SNAPSHOT_BEGIN')data={...common,snapshotId:'synthetic-snapshot',entityCodes:['hzkj_orders'],streams:[{key:'business',endCursor:'snapshot-end'}]}
      else if(key==='SNAPSHOT_PAGE'){
        const group=completeFulfillmentDomainFixture(sourceAsOf,'10');group.groupKey='snapshot-group';group.endCursor='snapshot-end';group.afterCursor=null
        data={snapshotId:body.snapshotId,streamKey:body.streamKey,afterCursor:body.afterCursor,complete:true,groups:[group]}
      }else if(key==='BARRIER')data={...common,id:'barrier-'+calls.filter(key=>key==='BARRIER').length,targetVector:{business:'change-end'},proof:{consistent:true,fixture:true}}
      else if(key==='CHANGES'){
        if(failChanges)throw new Error('synthetic timeout')
        const group=completeFulfillmentDomainFixture(sourceAsOf,'10');group.groupKey='change-group';group.endCursor='change-end';group.afterCursor='snapshot-end';group.documents[0].eventId='change-event';group.documents[0].sourceVersion='2'
        data={streamKey:body.streamKey,afterCursor:body.afterCursor,untilCursor:body.untilCursor,groups:[group]}
      }else if(key==='AUTHORIZATION')data={...common,companyAllowed:true,ownershipVector:{business:ownershipTarget},resources:REPLICA_RESOURCES.map(resource=>({resource,grants:[{target:'*',decision:'allow'}]})),employees:[],references:[]}
      else if(key==='RECONCILE')data={barrierId:body.barrierId,targetVector:body.targetVector,scopeVersion:'v1',entities:[{entityCode:'hzkj_orders',count:1,amounts:{USD:mismatch?'99':'10'}}]}
      else throw new Error('Unexpected API')
      return new Response(JSON.stringify({success:true,data:{schemaVersion:'fop-replica/1',tenantId:'fixture',companyId:'fixture',...data}}))
    })
    bootstrap=new ReplicaBootstrapService(db,config,source,new ReplicaPublisher(db),new ReplicaAuthorizationService(db,config,source))
  })
  afterEach(async()=>{await cleanup(company,connection)})
  const active=async()=> (await db.query('SELECT active_dataset_id id FROM hz_fop_companies WHERE id=$1',[company]))[0].id
  it('resumes a failed page, validates amounts, atomically activates and serves the local list',async()=>{
    expect((await bootstrap.initialize(actor,company,'resume')).state).toBe('replaying');expect(await active()).toBe(previous)
    failChanges=true
    await expect(bootstrap.initialize(actor,company,'resume')).rejects.toMatchObject({response:{code:'fop_replica_request_failed'}})
    expect(await active()).toBe(previous)
    failChanges=false
    const result=await bootstrap.initialize(actor,company,'resume');expect(result.state).toBe('published');expect(await active()).toBe(result.datasetId)
    expect((await db.query('SELECT state FROM hz_fop_datasets WHERE id=$1',[previous]))[0].state).toBe('retired')
    expect(calls.filter(c=>c==='SNAPSHOT_BEGIN')).toHaveLength(1);expect(calls.filter(c=>c==='SNAPSHOT_PAGE')).toHaveLength(1)
    const count=calls.length;expect((await bootstrap.initialize(actor,company,'resume')).datasetId).toBe(result.datasetId);expect(calls).toHaveLength(count)
    const users={findById:async()=>({id:actor,role:'admin',businessRole:'none',workbenchRoles:[],accountDisabled:false})} as unknown as UsersService
    const local=new LocalWorkbenchService(db,users,new ConfigService({WORKBENCH_READ_MODE:'local'}))
    jest.spyOn(local as any,'companies').mockImplementation(async()=>db.query(`SELECT c.id connection_id,c.tenant_id,c.workspace_owner_id,co.id company_id,co.source_company_id,co.active_dataset_id,co.verified_at,co.expires_at,co.scope_version,d.state dataset_state,d.validated_at,d.activated_at,d.applied_watermarks FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id=c.id JOIN hz_fop_datasets d ON d.id=co.active_dataset_id WHERE co.id=$1`,[company]))
    const rows=await local.getOrders(actor,{queue:'unpaid',page:1,pageSize:20})
    expect(rows.total).toBe(1);expect(rows.items[0].items[0].sku).toBeTruthy();expect(rows.replica.sourceSyncedAt).toBeTruthy()
    const grants=await db.query('SELECT id FROM hz_fop_resource_grants WHERE company_id=$1 ORDER BY id',[company])
    const before=(await db.query('SELECT scope_version FROM hz_fop_companies WHERE id=$1',[company]))[0].scope_version
    await db.query("UPDATE hz_fop_workbench_orders SET ownership_verified_at=now()-interval '2 minutes' WHERE dataset_id=$1",[result.datasetId])
    const auth=new ReplicaAuthorizationService(db,config,source)
    await auth.refresh({connectionId:connection,companyId:company})
    expect(await db.query('SELECT id FROM hz_fop_resource_grants WHERE company_id=$1 ORDER BY id',[company])).toEqual(grants)
    expect((await db.query('SELECT scope_version FROM hz_fop_companies WHERE id=$1',[company]))[0].scope_version).toBe(before)
    expect((await local.getOrders(actor,{queue:'unpaid',page:1,pageSize:20})).total).toBe(1)
    ownershipTarget='unapplied-ownership-change';await auth.refresh({connectionId:connection,companyId:company})
    await expect(local.getOrders(actor,{queue:'unpaid',page:1,pageSize:20})).rejects.toMatchObject({response:{code:'workbench_replica_incomplete'}})
  })
  it('renews authorization only inside the explicitly requested manual sync batch',async()=>{
    await bootstrap.initialize(actor,company,'manual-auth')
    const initialized=await bootstrap.initialize(actor,company,'manual-auth')
    expect(initialized.state).toBe('published')
    config.set('WORKBENCH_AUTOMATIC_CALLS_ENABLED','false')
    const auth=new ReplicaAuthorizationService(db,config,source)
    await db.query("UPDATE hz_fop_companies SET verified_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' WHERE id=$1",[company])
    const local={enabled:true,mock:false,replicaScope:async()=>[{connectionId:connection,companyId:company,datasetId:initialized.datasetId}]} as unknown as LocalWorkbenchService
    const sync=new ReplicaSyncService(db,local,config,source,new ReplicaPublisher(db),auth)
    const before=calls.length
    await expect(auth.ensure({connectionId:connection,companyId:company})).rejects.toMatchObject({response:{code:'workbench_replica_authorization_stale'}})
    await sync.tick();expect(calls).toHaveLength(before)
    const job=await sync.request(actor,'explicit-auth-renewal')
    await sync.tick({actorAccountId:actor,batchId:job.id!})
    expect(await sync.job(actor,job.id!)).toMatchObject({state:'succeeded'})
    expect(calls.slice(before).filter(key=>key==='AUTHORIZATION')).toHaveLength(1)
    const after=calls.length;await auth.ensure({connectionId:connection,companyId:company});expect(calls).toHaveLength(after)
  })
  it('refuses an amount mismatch and keeps the prior dataset active until a corrected verification',async()=>{
    await bootstrap.initialize(actor,company,'amount');mismatch=true
    await expect(bootstrap.initialize(actor,company,'amount')).rejects.toMatchObject({response:{code:'workbench_reconciliation_amount_mismatch'}})
    expect(await active()).toBe(previous)
    mismatch=false;expect((await bootstrap.initialize(actor,company,'amount')).state).toBe('published')
  })
  it('allows only one running initializer per company',async()=>{
    const runner=db.createQueryRunner();await runner.connect()
    try{await runner.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`bootstrap:${connection}:${company}`])
      await expect(bootstrap.initialize(actor,company,'race')).rejects.toThrow('workbench_bootstrap_running');expect(calls).toEqual([])
    }finally{await runner.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`bootstrap:${connection}:${company}`]);await runner.release()}
  })
})
