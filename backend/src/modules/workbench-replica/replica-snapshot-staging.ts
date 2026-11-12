import { randomUUID } from 'crypto'
import type { DataSource, EntityManager } from 'typeorm'
import { WORKBENCH_TABLE_COLUMNS } from '../../database/workbench-schema'
import { validateChangeGroup, type ReplicaChangeGroup, type ReplicaDatasetScope, type ReplicaRow } from './replica-change-contract'
import { REPLICA_ENTITY_FIELDS } from './replica-domain-normalizer'
import { replicaPayloadHash, replicaSnapshotHash } from './replica-publisher'
import type { ReplicaSnapshotPage } from './replica-source-api'

type Row=Record<string,any>
const entityTables:Record<string,string>=Object.fromEntries(Object.entries(REPLICA_ENTITY_FIELDS).map(([entity,spec])=>[entity,spec.table]))

/** Snapshot collection is durable and independent of applied business cursors.
 * Only identities actually present in collected source snapshots are prepared. Referenced but absent
 * targets are never fabricated, and a missing target cannot get past publication or final validation.
 */
export class ReplicaSnapshotStaging {
  constructor(private readonly db:DataSource){}
  async latest(batchId:string,streamId:string):Promise<Row|undefined>{
    return (await this.db.query('SELECT * FROM hz_fop_bootstrap_pages WHERE batch_id=$1 AND stream_id=$2 ORDER BY page_index DESC LIMIT 1',[batchId,streamId]))[0]
  }
  async collect(scope:ReplicaDatasetScope,batchId:string,streamId:string,snapshotId:string,page:ReplicaSnapshotPage,target:string):Promise<void>{
    if(page.snapshotId!==snapshotId)throw new Error('workbench_snapshot_scope_changed')
    let end=page.afterCursor
    for(const input of page.groups){const group=validateChangeGroup(input);if(group.afterCursor!==end)throw new Error('workbench_snapshot_cursor_mismatch');end=group.endCursor}
    if(!page.groups.length&&!page.complete)throw new Error('workbench_snapshot_no_progress')
    if(page.complete&&(end!==null&&end!==target))throw new Error('workbench_snapshot_cursor_mismatch')
    await this.db.transaction(async m=>{
      await this.building(m,scope,batchId)
      const [last]=await m.query('SELECT * FROM hz_fop_bootstrap_pages WHERE batch_id=$1 AND stream_id=$2 ORDER BY page_index DESC LIMIT 1 FOR UPDATE',[batchId,streamId])
      const expected=last?.end_cursor??null
      if(last?.complete||expected!==page.afterCursor)throw new Error('workbench_snapshot_cursor_mismatch')
      const index=(last?.page_index??-1)+1
      await m.query(`INSERT INTO hz_fop_bootstrap_pages(id,connection_id,company_id,dataset_id,batch_id,stream_id,snapshot_id,page_index,after_cursor,end_cursor,complete,groups,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,[randomUUID(),scope.connectionId,scope.companyId,scope.datasetId,batchId,streamId,snapshotId,index,page.afterCursor,end,page.complete,JSON.stringify(page.groups),replicaPayloadHash(page.groups)])
    })
  }
  async pages(batchId:string,state:'collected'|'prepared',limit:number):Promise<Row[]>{
    return this.db.query('SELECT * FROM hz_fop_bootstrap_pages WHERE batch_id=$1 AND state=$2 ORDER BY stream_id,page_index LIMIT $3',[batchId,state,limit])
  }
  async prepare(scope:ReplicaDatasetScope,batchId:string,page:Row):Promise<void>{
    await this.db.transaction(async m=>{
      await this.building(m,scope,batchId)
      const [staged]=await m.query("SELECT * FROM hz_fop_bootstrap_pages WHERE id=$1 AND batch_id=$2 AND state='collected' FOR UPDATE",[page.id,batchId])
      if(!staged)return
      if(replicaPayloadHash(staged.groups)!==staged.payload_hash)throw new Error('workbench_snapshot_staging_corrupt')
      for(const group of staged.groups as ReplicaChangeGroup[])for(const event of validateChangeGroup(group).events){
        const marker={bootstrapBatchId:batchId,sourceVersion:event.sourceVersion,snapshotHash:replicaSnapshotHash(event)}
        await m.query(`INSERT INTO hz_fop_source_documents(id,connection_id,company_id,dataset_id,entity_code,source_id,document_number,source_version,validation_state,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,NULL,'unverified',$8::jsonb) ON CONFLICT(id) DO NOTHING`,[event.localDocumentId,scope.connectionId,scope.companyId,scope.datasetId,event.entityCode,event.sourceId,event.documentNumber,JSON.stringify(marker)])
        const [existing]=await m.query('SELECT connection_id,company_id,dataset_id,entity_code,source_id,source_version,validation_state,payload FROM hz_fop_source_documents WHERE id=$1',[event.localDocumentId])
        if(!existing||existing.connection_id!==scope.connectionId||existing.company_id!==scope.companyId||existing.dataset_id!==scope.datasetId||existing.entity_code!==event.entityCode||existing.source_id!==event.sourceId||existing.source_version!==null||existing.validation_state!=='unverified'||replicaPayloadHash(existing.payload)!==replicaPayloadHash(marker))throw new Error('workbench_snapshot_identity_conflict')
        if(event.operation==='delete')continue
        const table=entityTables[event.entityCode]
        if(!table||!event.rows.some(row=>row.table===table&&row.values.document_id===event.localDocumentId))throw new Error('workbench_snapshot_header_missing')
        await this.identity(m,scope,{table,values:{document_id:event.localDocumentId,entity_code:event.entityCode}},['document_id'])
        for(const fact of event.rows){
          if(fact.table==='hz_fop_source_lines'){
            if(fact.values.document_id!==event.localDocumentId)throw new Error('workbench_snapshot_identity_conflict')
            await this.identity(m,scope,{table:fact.table,values:Object.fromEntries(['id','document_id','entry_entity','source_entry_id','parent_line_id'].filter(key=>fact.values[key]!==undefined).map(key=>[key,fact.values[key]]))},['id'])
          }else if(fact.table==='hz_fop_order_packages'){
            if(fact.values.order_document_id!==event.localDocumentId)throw new Error('workbench_snapshot_identity_conflict')
            await this.identity(m,scope,{table:fact.table,values:Object.fromEntries(['id','order_document_id','source_package_key'].map(key=>[key,fact.values[key]]))},['id'])
          }
        }
      }
      await m.query("UPDATE hz_fop_bootstrap_pages SET state='prepared' WHERE id=$1",[page.id])
    })
  }
  async applied(scope:ReplicaDatasetScope,batchId:string,page:Row,target:string):Promise<void>{
    await this.db.transaction(async m=>{
      await this.building(m,scope,batchId)
      const [stream]=await m.query('SELECT applied_cursor FROM hz_fop_sync_streams WHERE id=$1 AND dataset_id=$2 FOR UPDATE',[page.stream_id,scope.datasetId])
      if(!stream||stream.applied_cursor!==page.end_cursor)throw new Error('workbench_snapshot_cursor_mismatch')
      await m.query("UPDATE hz_fop_bootstrap_pages SET state='applied',applied_at=now() WHERE id=$1 AND batch_id=$2",[page.id,batchId])
      if(page.complete)await m.query("UPDATE hz_fop_sync_streams SET mode='incremental',state='ready',received_cursor=$2,applied_cursor=$2 WHERE id=$1",[page.stream_id,target])
    })
  }
  private async building(m:EntityManager,scope:ReplicaDatasetScope,batchId:string){
    const rows=await m.query(`SELECT d.id FROM hz_fop_datasets d JOIN hz_fop_bootstrap_batches b ON b.dataset_id=d.id AND b.id=$4
      JOIN hz_fop_companies co ON co.id=d.company_id WHERE d.id=$1 AND d.connection_id=$2 AND d.company_id=$3 AND d.state='building' AND co.active_dataset_id IS DISTINCT FROM d.id AND b.state IN ('importing','failed') FOR UPDATE OF d`,[scope.datasetId,scope.connectionId,scope.companyId,batchId])
    if(!rows.length)throw new Error('workbench_snapshot_staging_scope_changed')
  }
  private async identity(m:EntityManager,scope:ReplicaDatasetScope,input:ReplicaRow,keys:string[]){
    const values={...input.values},columns=WORKBENCH_TABLE_COLUMNS[input.table]
    for(const [name,value]of Object.entries({connection_id:scope.connectionId,company_id:scope.companyId,dataset_id:scope.datasetId}))if(columns.includes(name))values[name]=value
    const names=Object.keys(values)
    await m.query(`INSERT INTO "${input.table}"(${names.map(n=>`"${n}"`).join(',')}) VALUES(${names.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT(${keys.map(n=>`"${n}"`).join(',')}) DO NOTHING`,names.map(n=>values[n]))
    const [old]=await m.query(`SELECT * FROM "${input.table}" WHERE ${keys.map((key,i)=>`"${key}"=$${i+1}`).join(' AND ')}`,keys.map(key=>values[key]))
    if(!old||names.some(key=>(old[key]??null)!==(values[key]??null)))throw new Error('workbench_snapshot_identity_conflict')
  }
}
