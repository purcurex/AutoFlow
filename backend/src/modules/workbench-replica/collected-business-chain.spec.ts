import { buildCollectedBusinessChain } from './collected-business-chain'
const scope={connectionId:'c',companyId:'co',sourceCompanyId:'100000',datasetId:'ds'}
const input=(kind:string,raw:Record<string,any>)=>({kind,raw,capturedAt:'2026-11-12T00:00:00Z'})
const order=(id:string,no:string)=>input('fulfillment',{id,billno:no,hzkj_orders_billentry:[{id:id+'1',seq:1,hzkj_qty:'2',hzkj_local_sku:{number:'SAME'}}]})
it('keeps combined purchase lines attached to the exact order rather than the same SKU',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),order('2','TO2'),input('purchase',{id:'3',billno:'PO',hzkj_billentry:[{id:'31',hzkj_salbillid:'1',hzkj_salbillentryid:'11',hzkj_qty:'2'},{id:'32',hzkj_salbillid:'2',hzkj_salbillentryid:'21',hzkj_qty:'7'}]})])
 expect(g.relations.map(r=>[r.rootSourceId,r.toEntryId,r.quantity])).toEqual([['1','31','2'],['2','32','7']])
 expect(g.documents.every(d=>d.sourceVersion===null)).toBe(true)
})
it('rejects absent or duplicate source numbers; never matches by SKU',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO'),order('2','TO'),input('purchase',{id:'3',hzkj_billentry:[{id:'31',hzkj_salbillnumber:'TO',hzkj_srcbillentryseq:1},{id:'32',hzkj_salbillid:'1',hzkj_salbillnumber:'OTHER',hzkj_salbillentryid:'11'}]})])
 expect(g.relations).toHaveLength(0);expect(g.issues).toHaveLength(2)
})
it('uses receipt source type and line amounts, never allocating the header total to every order',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),order('2','TO2'),input('receipt',{id:'r',hzkj_src_type:'A',hzkj_src_bill:'TO1',hzkj_rec_amount:'100',entryentity:[{id:'r1',hzkj_entry_src_type:'A',hzkj_src_order:'TO1',hzkj_real_receive_amt:'0.12345678'},{id:'r2',hzkj_entry_src_type:'A',hzkj_src_order:'TO2',hzkj_real_receive_amt:'99.87654322'},{id:'r3',hzkj_entry_src_type:'D',hzkj_src_order:'TO1',hzkj_real_receive_amt:'50'}]})])
 expect(g.relations.map(r=>[r.rootSourceId,r.amount,r.currency])).toEqual([['1','0.12345678',null],['2','99.87654322',null]])
})
it('links allocation, dispatch, notification and outbound using explicit source evidence',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),input('allocation',{id:'a',hzkj_order_id:'1',hzkj_order_no:'TO1'}),input('dispatch',{id:'d',billno:'FY1',hzkj_order_no:'TO1'}),input('delivery_notice',{id:'n',billno:'FH1',hzkj_deliver_billno:'FY1'}),input('outbound',{id:'o',billentry:[{id:'o1',hzkj_entry_billno:'TO1',qty:'2'}]})])
 expect(g.relations.map(r=>r.type)).toEqual(['allocation','dispatch','delivery_notice','outbound'])
 expect(g.relations.every(r=>r.rootSourceId==='1')).toBe(true)
 expect(g.relations[g.relations.length-1]?.fromEntryId).toBeNull()
})
it('retains raw lines and deterministically removes relationships absent in a new snapshot',()=>{
 const rows=[order('1','TO1'),input('purchase_application',{id:'a',entryentity:[{id:'a1',hzkj_srcbillnumber:'TO1',hzkj_srcbillentryseq:1,hzkj_applyqty:'2'}]})]
 const a=buildCollectedBusinessChain(scope,rows),b=buildCollectedBusinessChain(scope,rows)
 expect(a).toEqual(b);expect(a.lines).toHaveLength(2);expect(a.relations).toHaveLength(1)
 expect(buildCollectedBusinessChain(scope,[rows[0],input('purchase_application',{id:'a',entryentity:[]})]).relations).toHaveLength(0)
})
it('treats FOP zero reference IDs as absent and uses a unique source row number',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),input('purchase',{id:'p',hzkj_billentry:[{id:'p1',hzkj_salbillid:'0',hzkj_srcbillid:'0',hzkj_salbillentryid:'0',hzkj_srcbillentryid:'0',hzkj_salbillentryseq:'0',hzkj_srcbillentryseq:'1',hzkj_salbillnumber:'TO1',hzkj_qty:'2'}]})])
 expect(g.relations).toHaveLength(1);expect(g.relations[0].fromEntryId).toBe('11')
})
it('follows explicit requisition entries through purchase and receipt notice',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),input('purchase_application',{id:'a',billno:'AP1',entryentity:[{id:'a1',hzkj_srcbillnumber:'TO1',hzkj_srcbillentryseq:1}]}),input('purchase',{id:'p',hzkj_billentry:[{id:'p1',hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'a',hzkj_srcbillentryid:'a1',hzkj_srcbillnumber:'AP1'}]}),input('receipt_notice',{id:'n',entryentity:[{id:'n1'}]})],{n1:'p1'})
 expect(g.issues).toEqual([]);expect(g.relations.map(r=>[r.rootSourceId,r.fromEntryId,r.toEntryId])).toEqual([['1','11','a1'],['1','a1','p1'],['1','p1','n1']])
})
it('does not reinterpret unknown source entities as fulfillment orders',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),input('purchase',{id:'p',hzkj_billentry:[{id:'p1',hzkj_srcbillentity:'unknown',hzkj_srcbillid:'1',hzkj_srcbillentryid:'11'}]})])
 expect(g.relations).toEqual([]);expect(g.issues[0].reason).toBe('unsupported_source_entity')
})

it('links purchase entry sales numbers to multiple orders without requiring a requisition API or sales entry ID',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),order('2','TO2'),input('purchase',{id:'p',hzkj_billentry:[{id:'p1',hzkj_salbillnumber:'TO1',hzkj_salbillid:'0',hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'absent',hzkj_qty:'2'},{id:'p2',hzkj_salbillnumber:'TO2',hzkj_qty:'3'}]})])
 expect(g.issues).toEqual([])
 expect(g.relations.map(r=>[r.rootSourceId,r.fromEntryId,r.toEntryId])).toEqual([['1',null,'p1'],['2',null,'p2']])
})

it('trusts purchase sales numbers over stale optional source IDs',()=>{
 const g=buildCollectedBusinessChain(scope,[order('1','TO1'),order('2','TO2'),input('purchase',{id:'p',hzkj_billentry:[{id:'p1',hzkj_salbillnumber:'TO1',hzkj_salbillid:'2',hzkj_salbillentryid:'21',hzkj_qty:'2'}]})])
 expect(g.issues).toEqual([])
 expect(g.relations.map(r=>[r.rootSourceId,r.fromEntryId,r.toEntryId])).toEqual([['1',null,'p1']])
})
