import { ReplicaPublisher } from './replica-publisher'
import type { ReplicaChangeGroup } from './replica-change-contract'
const scope={connectionId:'00000000-0000-4000-a000-000000000001',companyId:'00000000-0000-4000-a000-000000000002',datasetId:'00000000-0000-4000-a000-000000000003'}
const id='00000000-0000-4000-a000-000000000004'
function fixture(version='2'):ReplicaChangeGroup{return {groupKey:'g',afterCursor:null,endCursor:'end',committedAt:'2026-11-11T01:00:00Z',expectedCount:1,events:[{eventId:'e',entityCode:'hzkj_receiptnotice',sourceId:'source',sourceVersion:version,operation:'upsert',localDocumentId:id,documentNumber:'RN-1',linesComplete:true,rows:[{table:'hz_fop_receipt_notices',values:{document_id:id,entity_code:'hzkj_receiptnotice'}}],affectedOrderIds:[]}],projections:[],receiptNotices:[{documentId:id,deleted:false,rows:[{table:'hz_fop_workbench_receipt_notices',values:{document_id:id,source_version:version,owner_employee_ids:['owner'],ownership_verified_at:'2026-11-11T01:00:00Z',shipment_state:'shipped',quantity:'1',inbound_quantity:'0',lines:[{quantity:'1',inboundQuantity:'0'}]}}]}]}}
function mock(old?:{source_version:string;payload_hash:string}){
 const q=jest.fn(async(sql:string)=>{
  if(sql.includes('FOR UPDATE OF co'))return [{id:scope.companyId}]
  if(sql.includes('FROM hz_fop_datasets')&&sql.includes("state IN"))return [{id:scope.datasetId}]
  if(sql.startsWith('SELECT * FROM hz_fop_sync_streams'))return [{state:'ready',applied_cursor:null,received_cursor:null}]
  if(sql.includes(' AS revision'))return [{revision:'1'}]
  if(sql.includes(' AS position'))return [{position:'0'}]
  if(sql.startsWith('SELECT id,source_version'))return old?[{id,...old}]:[]
  if(sql.startsWith('INSERT INTO'))return [{id,document_id:id}]
  return []
 })
 const runner={query:q,connect:jest.fn(),startTransaction:jest.fn(),commitTransaction:jest.fn(),rollbackTransaction:jest.fn(),release:jest.fn()}
 return {runner,publisher:new ReplicaPublisher({createQueryRunner:()=>runner} as any)}
}
it('publishes independent receipt notice and lifecycle tombstones before the same transaction cursor commit',async()=>{
 const {runner,publisher}=mock();await publisher.apply(scope,'stream',fixture())
 const sql=runner.query.mock.calls.map(c=>c[0]);expect(sql.some(s=>s.includes('INSERT INTO "hz_fop_workbench_receipt_notices"'))).toBe(true)
 for(const table of ['hz_fop_source_lines','hz_fop_document_relations','hz_fop_tracking_numbers','hz_fop_document_packages'])expect(sql.some(s=>s.startsWith('UPDATE '+table)&&s.includes('removed_at'))).toBe(true)
 expect(runner.commitTransaction).toHaveBeenCalledTimes(1);expect(runner.rollbackTransaction).not.toHaveBeenCalled()
})
it('rolls the whole group back on stale source version without advancing its cursor',async()=>{
 const {runner,publisher}=mock({source_version:'999999999999999999999999',payload_hash:'old'})
 await expect(publisher.apply(scope,'stream',fixture('999999999999999999999998'))).rejects.toThrow('regressed')
 expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);expect(runner.commitTransaction).not.toHaveBeenCalled();expect(runner.query.mock.calls.some(([s])=>s.startsWith('UPDATE hz_fop_sync_streams'))).toBe(false)
})
it('rejects a missing receipt projection and rolls back rather than exposing an old same-document snapshot',async()=>{
 const {runner,publisher}=mock();const group=fixture();group.receiptNotices=[]
 await expect(publisher.apply(scope,'stream',group)).rejects.toThrow('Receipt notice projection missing');expect(runner.commitTransaction).not.toHaveBeenCalled()
})
