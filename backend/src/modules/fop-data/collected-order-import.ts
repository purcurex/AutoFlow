import { createHash, randomUUID } from 'node:crypto'
import type { DataSource } from 'typeorm'
import { normalizeCollectedOrder } from './collected-order-normalizer'
export interface CollectedContext {tenantId:string;userId:string;companyId:string}
export interface CollectedPage { data: Record<string, any>; rawText:string }
export interface CollectedImportOptions extends CollectedContext {
  workspaceOwnerId:string;captureId:string;startedAt:string;warehouseMap?:Record<string,string>;metadata?:Record<string,unknown>
}
const fail=()=>{throw new Error('collected_invalid_page')}
/** Cursor source IDs are strings so comparison never passes through IEEE-754. */
export function validateCollectedPage(p:Record<string,any>,c:CollectedContext,index:number,after:string|null):{ids:string[];next:string|null}{
  if(p.workbenchFactsSchemaVersion!==1||p.queue!=='review'||p.subject?.tenantId!==c.tenantId||p.subject?.userId!==c.userId||!Array.isArray(p.organizationIds)||p.organizationIds.length!==1||p.organizationIds[0]!==c.companyId
    ||p.page!==1||p.pageSize!==100||typeof p.hasMore!=='boolean'||!Array.isArray(p.items)||p.items.length>100)fail()
  const ids=p.items.map((r:Record<string,unknown>)=>r.id)
  if(ids.some((id:unknown)=>typeof id!=='string'||!/^[1-9]\d{0,30}$/.test(id as string))||new Set(ids).size!==ids.length)fail()
  let prev=after
  for(const id of ids){if(prev!==null&&BigInt(id)<=BigInt(prev))fail();prev=id}
  if(p.hasMore&&(ids.length===0||typeof p.nextAfterOrderId!=='string'||p.nextAfterOrderId!==ids.at(-1)))fail()
  return {ids,next:p.hasMore?p.nextAfterOrderId:null}
}

/** Pages stage durably; only a complete verified scan can replace the active batch in one transaction. */
export async function importCollectedOrders(ds:DataSource, pages:AsyncIterable<CollectedPage>,o:CollectedImportOptions){
  const q=ds.createQueryRunner(),batchId=randomUUID(),hash=createHash('sha256');let rowCount=0,pageCount=0,itemCount=0,after:string|null=null,terminal=false
  const missingCounts:Record<string,number>={},seen=new Set<string>()
  await q.connect()
  const lockKey=`collected:${o.workspaceOwnerId}:${o.tenantId}:${o.companyId}`
  let locked=false,staged=false
  try{
    locked=(await q.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[lockKey]))[0].locked===true
    if(!locked)throw new Error('collected_import_already_running')
    const prior=await q.query("SELECT id,state,row_count,page_count FROM hz_fop_collected_batches WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND metadata->>'captureId'=$4 AND state IN ('active','superseded')",[o.workspaceOwnerId,o.tenantId,o.companyId,o.captureId])
    if(prior.length)return {batchId:prior[0].id,rowCount:prior[0].row_count,pageCount:prior[0].page_count,reused:true}
    await q.query(`INSERT INTO hz_fop_collected_batches(id,workspace_owner_id,tenant_id,company_id,state,source_as_of,metadata) VALUES($1,$2,$3,$4,'staging',$5,$6)`,[batchId,o.workspaceOwnerId,o.tenantId,o.companyId,o.startedAt,JSON.stringify({...o.metadata,captureId:o.captureId,sourceTimeMeaning:'capture_started_at_not_source_watermark',readOnly:true})]);staged=true
    for await(const page of pages){
      if(terminal||pageCount>=10000)throw new Error('collected_unexpected_page')
      const checked=validateCollectedPage(page.data,o,pageCount+1,after)
      for(const id of checked.ids){if(seen.has(id))throw new Error('collected_duplicate_source_id');seen.add(id)}
      const rows=page.data.items.map((r:unknown)=>normalizeCollectedOrder(r,o))
      hash.update(page.rawText);hash.update('\n')
      await q.startTransaction()
      try{
        if(rows.length){
          const columns=Object.keys(rows[0]);const values:unknown[]=[]
          const tuples=rows.map((r:any)=>{const vals=[batchId,...columns.map(k=>k==='display'||k==='raw'?JSON.stringify(r[k]):r[k])];return `(${vals.map(v=>{values.push(v);return `$${values.length}`}).join(',')})`})
          await q.query(`INSERT INTO hz_fop_collected_orders(batch_id,${columns.join(',')}) VALUES ${tuples.join(',')}`,values)
        }
        await q.query('UPDATE hz_fop_collected_batches SET row_count=row_count+$2,page_count=page_count+1 WHERE id=$1',[batchId,rows.length])
        await q.commitTransaction()
      }catch(e){await q.rollbackTransaction();throw e}
      rowCount+=rows.length;pageCount++;after=checked.next;terminal=after===null
      for(const r of rows){itemCount+=r.display.items.length;for(const field of r.display.dataQuality.missingFields)missingCounts[field]=(missingCounts[field]||0)+1}
    }
    if(!terminal||pageCount===0)throw new Error('collected_incomplete_capture')
    const digest=hash.digest('hex')
    const verified=await q.query('SELECT count(*)::integer AS count,count(DISTINCT source_id)::integer AS unique_count,coalesce(sum(jsonb_array_length(display->\'items\')),0)::integer AS item_count FROM hz_fop_collected_orders WHERE batch_id=$1',[batchId])
    if(verified[0].count!==rowCount||verified[0].unique_count!==rowCount||verified[0].item_count!==itemCount)throw new Error('collected_verification_failed')
    await q.startTransaction()
    try{
      await q.query("UPDATE hz_fop_collected_batches SET state='superseded' WHERE workspace_owner_id=$1 AND tenant_id=$2 AND company_id=$3 AND state='active'",[o.workspaceOwnerId,o.tenantId,o.companyId])
      await q.query("UPDATE hz_fop_collected_batches SET state='active',completed_at=now(),metadata=metadata||$2::jsonb WHERE id=$1",[batchId,JSON.stringify({sha256:digest,itemCount,missingCounts,readbackVerified:true})])
      await q.commitTransaction()
    }catch(e){await q.rollbackTransaction();throw e}
    return {batchId,rowCount,pageCount,itemCount,sha256:digest,missingCounts,reused:false}
  }catch(e){
    if(q.isTransactionActive)await q.rollbackTransaction()
    if(staged)await q.query("UPDATE hz_fop_collected_batches SET state='failed',completed_at=now(),metadata=metadata||$2::jsonb WHERE id=$1",[batchId,JSON.stringify({failure:'capture_or_validation_failed'})])
    throw e
  }finally{if(locked)await q.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockKey]);await q.release()}
}
