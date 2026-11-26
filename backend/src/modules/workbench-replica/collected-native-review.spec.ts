import { execFileSync } from 'node:child_process'
import { collectedWhere, collectedDispatchCompletePredicate } from './collected-workbench-query'
// Execute the generated predicate against isolated in-memory SQL fixtures. No project DB is opened.
// SQLite's JSON boolean extraction differs from PostgreSQL ->>, so fixture flags are text.
function select(queue:string,rows:Record<string,any>[],completed=false,taskStatus?:string){
 const q=collectedWhere('b',null,{queue,completed,taskStatus,timeRange:'all',skuAssociation:queue==='unpaid'&&rows.every(r=>r.order==='no')?'unlinked':undefined},'facts')
 const script=`import sqlite3,json,sys,re
payload=json.loads(sys.argv[1]);db=sqlite3.connect(':memory:')
db.create_function('chr',1,chr)
db.create_function('jsonb_exists',2,lambda obj,key:key in json.loads(obj or '{}'))
class BoolAnd:
 def __init__(self): self.values=[]
 def step(self,v):
  if v is not None:self.values.append(bool(v))
 def finalize(self):return int(all(self.values)) if self.values else None
class BoolOr(BoolAnd):
 def finalize(self):return int(any(self.values)) if self.values else None
db.create_aggregate('bool_and',1,BoolAnd);db.create_aggregate('bool_or',1,BoolOr)
db.execute('CREATE TABLE hz_fop_collected_orders(batch_id TEXT,source_id TEXT,raw_order_status TEXT,raw_payment_status TEXT,raw_bill_status TEXT,raw_delivery_status TEXT,paid_at TEXT,display TEXT,raw TEXT)')
db.execute('CREATE TABLE hz_fop_collected_batches(id TEXT,company_id TEXT)')
db.execute("INSERT INTO hz_fop_collected_batches VALUES('b','company')")
db.execute('CREATE TABLE hz_fop_collected_entities(batch_id TEXT,entity_type TEXT,source_id TEXT,display TEXT,raw TEXT)')
for row in payload['rows']:
 db.execute('INSERT INTO hz_fop_collected_orders VALUES(?,?,?,?,?,?,?,?,?)',('b',row['id'],row.get('order','1'),row.get('payment','1'),row.get('bill','C'),row.get('delivery','0'),row.get('paidAt'),json.dumps(row.get('display',{})),json.dumps(row.get('raw',{}))))
for row in payload['rows']:
 if row.get('allocation'):
  db.execute('INSERT INTO hz_fop_collected_entities VALUES(?,?,?,?,?)',('b','allocation','allocation-'+row['id'],json.dumps(dict(row['allocation'],sourceOrderId=row['id'])), '{}'))
# Translate PostgreSQL JSON key existence without changing its missing/null semantics.
where=re.sub(r"(\\w+(?:->'[^']+')*) [?] ('[^']+')",r'jsonb_exists(\\1,\\2)',payload['where'])
where=where.replace('::jsonb','').replace('jsonb_array_length','json_array_length').replace('jsonb_typeof','json_type').replace("='string'","='text'")
where=where.replace('jsonb_array_elements_text','json_each').replace('jsonb_array_elements','json_each').replace('CROSS JOIN LATERAL','CROSS JOIN').replace('WHERE issue IN','WHERE issue.value IN').replace('d->','d.value->').replace('t->','t.value->').replace('pkg->','pkg.value->')
where=re.sub(r'unnest\\(ARRAY\\[(.*?)\\]\\) company',r'json_each(json_array(\\1)) company',where)
where=where.replace('company IS NOT NULL','company.value IS NOT NULL').replace('company<>','company.value<>').replace('virtual_entry->','virtual_entry.value->')
# SQLite requires an aggregate in SELECT when HAVING is used; EXISTS ignores its projected value.
where=re.sub(r'EXISTS\\(SELECT 1 FROM hz_fop_collected_entities a WHERE ([^)]*?) HAVING',r'EXISTS(SELECT count(*) FROM hz_fop_collected_entities a WHERE \\1 HAVING',where)
print(json.dumps([r[0] for r in db.execute('SELECT source_id FROM hz_fop_collected_orders WHERE '+where,payload['params'])]))`
 return JSON.parse(execFileSync('python3',['-c',script,JSON.stringify({where:q.where.replaceAll(collectedDispatchCompletePredicate(),collectedDispatchCompletePredicate().replace('SELECT 1','SELECT count(*)')),rows,params:q.params})],{encoding:'utf8'})) as string[]
}
const known={nativeFactsCaptured:'true',nativeProcurementCaptured:'true',dispatchTaskStatus:'dispatch_pending',procurementStage:'supplier_pending',nativeAssociationIssues:[],nativeProcurementAssociationIssues:[]}
it('sales unpaid SQL uses native no/1 order statuses instead of receipt status',()=>{
 const rows=[
  {id:'unlinked',order:'no',payment:null},
  {id:'pending-payment',order:'1',payment:'0'},
  {id:'conflicting-receipt',order:'1',payment:'1'},
  ...['0','2','3','4','5','6','unknown',null].map((status,i)=>({id:`other-${i}`,order:status,payment:'0'})),
 ]
 expect(select('unpaid',rows)).toEqual(['pending-payment','conflicting-receipt']);expect(select('unpaid',[rows[0]])).toEqual(['unlinked'])
})
it.each(['no','1'])('sales unpaid excludes fulfilled source orders for native status %s, retaining partial and absent source status',order=>{
 const rows=[
  {id:'fulfilled',order,payment:'0',raw:{hzkj_fulfillment_status:'fulfilled'}},
  {id:'partial',order,payment:'0',raw:{hzkj_fulfillment_status:'partial'}},
  {id:'unfulfilled',order,payment:'0',raw:{hzkj_fulfillment_status:'unfulfilled'}},
  {id:'null',order,payment:'0',raw:{hzkj_fulfillment_status:null}},
  {id:'missing',order,payment:'0',raw:{}},
 ]
 expect(select('unpaid',rows)).toEqual(['partial','unfulfilled','null','missing'])
})
it('uses the verified same-document status projection, with primary explicit null taking precedence over supplemental history',()=>{
 const supplement=(sourceId:string,orderStatus='no')=>({salesSourceStatus:{source:'fulfillment_capture',sourceId,orderStatus,fulfillmentStatus:'fulfilled'}})
 expect(select('unpaid',[
  {id:'excluded',order:'1',payment:'0',display:supplement('excluded','1')},
  {id:'wrong-source',order:'1',payment:'0',display:supplement('another','1')},
  {id:'changed-order',order:'1',payment:'0',display:supplement('changed-order')},
  {id:'explicit-null',order:'1',payment:'0',display:supplement('explicit-null','1'),raw:{hzkj_fulfillment_status:null}},
 ])).toEqual(['wrong-source','changed-order','explicit-null'])
})
it('exception SQL excludes technical coverage gaps and retains missing native state and actual conflicts',()=>{
 const result=select('exceptions',[
  {id:'paid-normal',display:known},{id:'unpaid-normal',payment:'0',display:{}},
  {id:'paid-unknown',display:{...known,procurementStage:'unknown'}},
  {id:'missing-payment',order:'2',payment:null,display:known},{id:'missing-status',order:null,display:known},
  {id:'missing-coverage',display:{...known,nativeProcurementCaptured:undefined}},
  {id:'uncovered',order:'2',display:{...known,dispatchTaskStatus:'dispatch_synced',procurementStage:'shipped'}},
  {id:'completed-unknown',delivery:'2',display:{...known,procurementStage:'unknown'}},
  {id:'explicit-relation',delivery:'2',display:{...known,nativeProcurementAssociationIssues:['current_purchase_relationship_conflict']}}
 ])
 expect(result).toEqual(['missing-payment','missing-status','uncovered','explicit-relation'])
})
it('pending warehouse SQL excludes unpaid/cancelled ready orders; native completed archive remains independent',()=>{
 const ready={nativeShippingReady:'true'}
 const rows=[{id:'paid',display:ready},{id:'unpaid',payment:'0',display:ready},{id:'cancelled',order:'0',display:ready},{id:'not-ready',display:{}},{id:'archive',payment:'0',order:'0',delivery:'2',display:ready}]
 expect(select('shipping',rows)).toEqual(['paid']);expect(select('shipping',rows,true)).toEqual(['archive'])
})

it.each(['allocation','allocation_review'])('%s dispatch completion SQL partitions effective native documents without losing empty/unknown states',queue=>{
 const approved={status:'approved',association:{state:'verified'}}
 const allocation={rawBillStatus:'B',rawAllocationStatus:queue==='allocation'?'pending':'completed',association:{state:'verified'}}
 const rows=[
  {id:'approved',docs:[approved]}, {id:'draft',docs:[{...approved,status:'draft'}]},
  {id:'empty',docs:[]}, {id:'unknown',docs:[{...approved,status:null}]},
  {id:'cancelled-only',docs:[{...approved,rawInterceptStatus:'CANCELLED'}]},
  {id:'approved-and-old-cancelled',docs:[approved,{status:'draft',rawInterceptStatus:'CANCELLED'}]},
  {id:'conflict-only',docs:[{...approved,association:{state:'conflict'}}]},
  {id:'missing',docs:undefined}
 ].map(r=>({id:r.id,allocation,display:{dispatchDocuments:r.docs}}))
 const complete=select(queue,rows,false,'dispatch_complete'),incomplete=select(queue,rows,false,'dispatch_incomplete')
 expect(complete).toEqual(['approved','approved-and-old-cancelled'])
 expect(incomplete).toEqual(['draft','empty','unknown','cancelled-only','conflict-only','missing'])
 expect(new Set([...complete,...incomplete]).size).toBe(rows.length)
})

it('sales review requires native paid order and draft/submitted bill, independently of receipt flag',()=>{
 const rows=['no','0','1','2','3','4','5',null].flatMap(order=>['A','B','C','D',null].map(bill=>({id:`${order}-${bill}`,order,bill,payment:null})))
 expect(select('review',rows)).toEqual(['2-A','2-B'])
 expect(select('review',rows,true)).toEqual(['no-C','0-C','1-C','2-C','3-C','4-C','5-C','null-C'])
})

it('defaults approved sales orders to ninety days of customer payment time',()=>{
 const q=collectedWhere('b',null,{queue:'review',completed:true})
 expect(q.params).toEqual(['b',90]);expect(q.where).toContain('paid_at >= now()')
 expect(collectedWhere('b',null,{queue:'review',completed:true,timeRange:'1m'}).params).toEqual(['b',30])
})
it('uses the approved source shipment state independently of order lifecycle and downstream capture',()=>{
 const rows=['A','B','C'].flatMap(bill=>[
  {id:bill+'-pending',bill,order:'2',raw:{hzkj_fulfillment_status:'unfulfilled'}},
  {id:bill+'-partial',bill,order:'5',raw:{hzkj_fulfillment_status:'partial'}},
  {id:bill+'-fulfilled',bill,order:'3',raw:{hzkj_fulfillment_status:'fulfilled'}},
  {id:bill+'-missing',bill,order:'4',raw:{}},
  {id:bill+'-cancelled',bill,order:'0',raw:{hzkj_fulfillment_status:'unfulfilled'}},
 ])
 expect(select('dispatch',rows)).toEqual(['C-pending','C-partial'])
 expect(select('dispatch',rows,true)).toEqual(['C-fulfilled'])
})
it('warehouse SQL keeps unresolved native partial headers in normal shipping plus diagnosis',()=>{
 const rows=[{id:'virtual-excluded-complete',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'completed'}}},{id:'unresolved-partial',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'unknown'}}},{id:'actual-partial',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'partial'}}},{id:'virtual-only',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'not_required'}}}]
 expect(select('shipping',rows)).toEqual(['unresolved-partial','actual-partial'])
 expect(select('shipping',rows,true)).toEqual(['virtual-excluded-complete'])
 expect(select('exceptions',rows)).toContain('unresolved-partial')
})

it.each(['no','1'])('unpaid excludes exactly the four source payment states for order %s',order=>{
 const blocked=['refunded','voided','expired','unpaid'],kept=['pending','authorized','partially_paid','paid','partially_refunded','due','',null]
 const rows=[...blocked,...kept].map((status,i)=>({id:String(i),order,raw:{hzkj_sourcepayststus:status}}))
 expect(select('unpaid',rows)).toEqual(kept.map((_,i)=>String(i+blocked.length)))
})
it('unpaid payment supplementation requires matching source/order state and never overrides a native value',()=>{
 const display=(sourceId:string,orderStatus='1')=>({salesSourcePaymentStatus:{source:'fulfillment_capture',sourceId,orderStatus,paymentStatus:'refunded'}})
 expect(select('unpaid',[
  {id:'excluded',display:display('excluded')},
  {id:'different-id',display:display('other')},
  {id:'different-status',display:display('different-status','no')},
  {id:'raw-paid',display:display('raw-paid'),raw:{hzkj_sourcepayststus:'paid'}},
  {id:'raw-null',display:display('raw-null'),raw:{hzkj_sourcepayststus:null}},
 ])).toEqual(['different-id','different-status','raw-paid','raw-null'])
})

it('source-payment exclusions do not manufacture exception work',()=>{
 expect(select('exceptions',['refunded','voided','expired','unpaid'].map(status=>({id:status,order:'1',payment:'0',raw:{hzkj_sourcepayststus:status},display:known})))).toEqual([])
})

it('adds SYNC_FAILED exceptions alongside the native lifecycle and clears after writeback',()=>{
 const dispatch=(deliveryStatus:string,extra={})=>({association:{state:'verified'},deliveryStatus,trackingNumbers:[{type:'full',number:'TRACK'}],...extra})
 const rows=[
  {id:'failed-paid',order:'2',raw:{hzkj_fulfillment_status:'unfulfilled'},display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED')]}},
  {id:'failed-processing',order:'3',raw:{hzkj_fulfillment_status:'unfulfilled'},display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED')]}},
  {id:'failed-partial',order:'5',raw:{hzkj_fulfillment_status:'partial'},display:{...known,dispatchDocuments:[dispatch('FULFILLED'),dispatch('SYNC_FAILED')]}},
  {id:'success',order:'4',delivery:'2',raw:{hzkj_fulfillment_status:'fulfilled',hzkj_logistics_info:[{hzkj_tracking_number:'TRACK'}]},display:{...known,dispatchTaskStatus:'dispatch_synced',dispatchDocuments:[dispatch('FULFILLED')]}},
  {id:'old-cancelled',order:'3',raw:{hzkj_fulfillment_status:'unfulfilled'},display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED',{rawInterceptStatus:'CANCELLED'})]}},
  {id:'unresolved',order:'3',raw:{hzkj_fulfillment_status:'unfulfilled'},display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED',{association:{state:'unresolved'}})]}},
 ]
 expect(select('dispatch',rows)).toEqual(['failed-paid','failed-processing','failed-partial','old-cancelled','unresolved'])
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['failed-paid','failed-processing','failed-partial'])
 expect(select('dispatch',rows,true)).toEqual(['success'])
})

it('retains fulfilled orders while independently diagnosing missing package tracking',()=>{
 const rows=[undefined,null,[],[{hzkj_tracking_number:null}],[{hzkj_tracking_number:' \t\r\n '}],[{hzkj_tracking_number:'CURRENT'}],[{hzkj_tracking_number:null},{hzkj_tracking_number:'PARTIAL'}]].map((packages,i)=>({
  id:String(i),order:i===6?'5':'4',delivery:'2',raw:{hzkj_fulfillment_status:'fulfilled',hzkj_logistics_info:packages},
  display:{...known,dispatchTaskStatus:'dispatch_synced',dispatchDocuments:[{deliveryStatus:'FULFILLED',trackingNumbers:[{type:'full',number:'OLD'}]}]},
 }))
 expect(select('dispatch',rows,true)).toEqual(['0','1','2','3','4','5','6'])
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['0','1','2','3','4'])
 expect(select('dispatch',rows)).toEqual([])
 rows[0].raw.hzkj_logistics_info=[{hzkj_tracking_number:'RECOVERED'}]
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['1','2','3','4'])
})

it('uses same-order same-company supplemental packages only when the native field is omitted',()=>{
 const capture=(sourceId:string,companyId='company',packages:any=[{hzkj_tracking_number:'SUPPLEMENT'}])=>({moneyCapture:{sourceId,orderNumber:'TO1',companyId,operation:'order-list',values:{hzkj_logistics_info:packages}}})
 const raw={id:'1',billno:'TO1',hzkj_fulfillment_status:'fulfilled'}
 const rows=[
  {id:'valid',order:'4',raw,display:capture('1')},
  {id:'other-order',order:'4',raw,display:capture('2')},
  {id:'other-company',order:'4',raw,display:capture('1','other')},
  {id:'native-empty',order:'4',raw:{...raw,hzkj_logistics_info:[]},display:capture('1')},
  {id:'native-current',order:'4',raw:{...raw,hzkj_logistics_info:[{hzkj_tracking_number:'CURRENT'}]},display:capture('1','company',[])},
 ]
 expect(select('dispatch',rows,true)).toEqual(['valid','other-order','other-company','native-empty','native-current'])
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['other-order','other-company','native-empty'])
})

it('keeps obtained dispatches in normal lists while diagnosing their own missing tracking',()=>{
 const doc=(deliveryStatus:string,trackingNumbers:any=[],extra={})=>({number:'FY-TEST',deliveryStatus,trackingNumbers,association:{state:'verified'},...extra})
 const rows=[
  {id:'missing',docs:[doc('TRACKING_OBTAINED')]},
  {id:'null',docs:[doc('TRACKING_OBTAINED',null)]},
  {id:'blank',docs:[doc('TRACKING_OBTAINED',[{type:'full',number:' \t\r\n'}])]},
  {id:'tail-only',docs:[doc('TRACKING_OBTAINED',[{type:'last_mile',number:'TAIL'}])]},
  {id:'inferred-tail-only',docs:[doc('PENDING',[{type:'last_mile',number:'TAIL'}])]},
  {id:'pending',docs:[doc('PENDING')]},
  {id:'valid',docs:[doc('TRACKING_OBTAINED',[{type:'full',number:'CURRENT'}])]},
  {id:'mixed',docs:[doc('TRACKING_OBTAINED'),doc('TRACKING_OBTAINED',[{type:'full',number:'OTHER'}])]},
  {id:'cancelled',docs:[doc('TRACKING_OBTAINED',[],{rawInterceptStatus:'CANCELLED'})]},
  {id:'unverified',docs:[doc('TRACKING_OBTAINED',[],{association:{state:'unresolved'}})]},
 ].map(r=>({id:r.id,order:'3',raw:{hzkj_fulfillment_status:'unfulfilled'},display:{...known,dispatchDocuments:r.docs}}))
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['missing','null','blank','tail-only','inferred-tail-only','mixed'])
 expect(select('dispatch',rows)).toEqual(rows.map(r=>r.id))
 expect(select('dispatch',rows,false,'dispatch_tracking')).toEqual(['valid','mixed'])
 rows[0].display.dispatchDocuments[0].trackingNumbers=[{type:'full',number:'RESTORED'}]
 expect(select('dispatch',rows,false,'dispatch_tracking')).toEqual(['missing','valid','mixed'])
 expect(select('exceptions',rows,false,'dispatch_exception')).not.toContain('missing')
})
