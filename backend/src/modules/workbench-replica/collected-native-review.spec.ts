import { execFileSync } from 'node:child_process'
import { collectedWhere, collectedDispatchCompletePredicate } from './collected-workbench-query'
// Execute the generated predicate against isolated in-memory SQL fixtures. No project DB is opened.
// SQLite's JSON boolean extraction differs from PostgreSQL ->>, so fixture flags are text.
function select(queue:string,rows:Record<string,any>[],completed=false,taskStatus?:string){
 const q=collectedWhere('b',null,{queue,completed,taskStatus,timeRange:'all'})
 const script=`import sqlite3,json,sys,re
payload=json.loads(sys.argv[1]);db=sqlite3.connect(':memory:')
db.create_function('jsonb_exists',2,lambda obj,key:key in json.loads(obj or '{}'))
class BoolAnd:
 def __init__(self): self.values=[]
 def step(self,v):
  if v is not None:self.values.append(bool(v))
 def finalize(self):return int(all(self.values)) if self.values else None
class BoolOr(BoolAnd):
 def finalize(self):return int(any(self.values)) if self.values else None
db.create_aggregate('bool_and',1,BoolAnd);db.create_aggregate('bool_or',1,BoolOr)
db.execute('CREATE TABLE hz_fop_collected_orders(batch_id TEXT,source_id TEXT,raw_order_status TEXT,raw_payment_status TEXT,raw_bill_status TEXT,raw_delivery_status TEXT,display TEXT,raw TEXT)')
db.execute('CREATE TABLE hz_fop_collected_entities(batch_id TEXT,entity_type TEXT,source_id TEXT,display TEXT)')
for row in payload['rows']:
 db.execute('INSERT INTO hz_fop_collected_orders VALUES(?,?,?,?,?,?,?,?)',('b',row['id'],row.get('order','1'),row.get('payment','1'),row.get('bill','C'),row.get('delivery','0'),json.dumps(row.get('display',{})),json.dumps(row.get('raw',{}))))
for row in payload['rows']:
 if row.get('allocation'):
  db.execute('INSERT INTO hz_fop_collected_entities VALUES(?,?,?,?)',('b','allocation','allocation-'+row['id'],json.dumps(dict(row['allocation'],sourceOrderId=row['id']))))
where=payload['where'].replace('::jsonb','').replace('jsonb_array_length','json_array_length').replace('jsonb_typeof','json_type')
where=where.replace('jsonb_array_elements','json_each').replace('d->','d.value->')
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
 expect(select('unpaid',rows)).toEqual(['unlinked','pending-payment','conflicting-receipt'])
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
  {id:'excluded',order:'no',payment:'0',display:supplement('excluded')},
  {id:'wrong-source',order:'no',payment:'0',display:supplement('another')},
  {id:'changed-order',order:'1',payment:'0',display:supplement('changed-order')},
  {id:'explicit-null',order:'no',payment:'0',display:supplement('explicit-null'),raw:{hzkj_fulfillment_status:null}},
 ])).toEqual(['wrong-source','changed-order','explicit-null'])
})
it('exception SQL separates normal paid/unpaid work, unknown base/native facts and uncovered unfinished work',()=>{
 const result=select('exceptions',[
  {id:'paid-normal',display:known},{id:'unpaid-normal',payment:'0',display:{}},
  {id:'paid-unknown',display:{...known,procurementStage:'unknown'}},
  {id:'missing-payment',payment:null,display:known},{id:'missing-status',order:null,display:known},
  {id:'missing-coverage',display:{...known,nativeProcurementCaptured:undefined}},
  {id:'uncovered',order:'2',display:{...known,dispatchTaskStatus:'dispatch_synced',procurementStage:'shipped'}},
  {id:'completed-unknown',delivery:'2',display:{...known,procurementStage:'unknown'}},
  {id:'explicit-relation',delivery:'2',display:{...known,nativeProcurementAssociationIssues:['unresolved']}}
 ])
 expect(result).toEqual(['paid-unknown','missing-payment','missing-status','missing-coverage','uncovered','explicit-relation'])
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

it('defaults approved sales orders to seven days of customer payment time',()=>{
 const q=collectedWhere('b',null,{queue:'review',completed:true})
 expect(q.params).toEqual(['b',7]);expect(q.where).toContain('paid_at >= now()')
 expect(collectedWhere('b',null,{queue:'review',completed:true,timeRange:'1m'}).params).toEqual(['b',30])
})
it('executes dispatch membership from the approved order lifecycle, even without downstream capture',()=>{
 const rows=['A','B','C'].flatMap(bill=>['no','0','1','2','3','4','5','6'].map(order=>({id:bill+order,bill,order,payment:null,display:{}})))
 expect(select('dispatch',rows)).toEqual(['C2','C3','C6'])
 expect(select('dispatch',rows,true)).toEqual(['C4','C5'])
})
it('warehouse SQL uses recomputed physical outbound status and sends unresolved partial headers to diagnosis',()=>{
 const rows=[{id:'virtual-excluded-complete',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'completed'}}},{id:'unresolved-partial',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'unknown'}}},{id:'actual-partial',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'partial'}}},{id:'virtual-only',delivery:'1',display:{nativeShippingReady:'true',businessStatus:{outbound:'not_required'}}}]
 expect(select('shipping',rows)).toEqual(['actual-partial'])
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

it('moves SYNC_FAILED from pending to dispatch exceptions, and successful writeback to fulfilled only',()=>{
 const dispatch=(deliveryStatus:string,extra={})=>({association:{state:'verified'},deliveryStatus,trackingNumbers:[{type:'full',number:'TRACK'}],...extra})
 const rows=[
  {id:'failed-paid',order:'2',display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED')]}},
  {id:'failed-processing',order:'3',display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED')]}},
  {id:'failed-partial',order:'5',display:{...known,dispatchDocuments:[dispatch('FULFILLED'),dispatch('SYNC_FAILED')]}},
  {id:'success',order:'4',delivery:'2',display:{...known,dispatchTaskStatus:'dispatch_synced',dispatchDocuments:[dispatch('FULFILLED')]}},
  {id:'old-cancelled',order:'3',display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED',{rawInterceptStatus:'CANCELLED'})]}},
  {id:'unresolved',order:'3',display:{...known,dispatchDocuments:[dispatch('SYNC_FAILED',{association:{state:'unresolved'}})]}},
 ]
 expect(select('dispatch',rows)).toEqual(['old-cancelled','unresolved'])
 expect(select('exceptions',rows,false,'dispatch_exception')).toEqual(['failed-paid','failed-processing','failed-partial'])
 expect(select('dispatch',rows,true)).toEqual(['success'])
})
