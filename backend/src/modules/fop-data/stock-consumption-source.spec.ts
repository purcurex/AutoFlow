import { normalizeStockConsumptions, procurementSources, withProcurementSources } from './stock-consumption-source'
import { physicalBusinessProjection } from './physical-business-projection'
const order=(lines:any[]=[{id:'L1',hzkj_local_sku:{id:'S1',number:'SKU1'},hzkj_qty:'10'}])=>({id:'O1',billno:'TO1',billstatus:'C',hzkj_orders_billentry:lines})
const stock=(type='1',status='0',quantity='4',extra:any={})=>({id:'B'+type,org_id:'100000',hzkj_stock_type:type,hzkj_sale_order_use:[{id:'U'+type,hzkj_sale_order_billno:'TO1',hzkj_sales_order_sku_id:'S1',hzkj_use_qty:quantity,hzkj_use_status:status,...extra}]})
const source=(stocks:any[],complete=true)=>({records:normalizeStockConsumptions(stocks,'100000'),complete,revision:'v1'})
it.each([
 ['2026-07-29 09:33:19','2026-07-29T09:33:19+08:00'],
 ['2026-07-29T01:33:19Z','2026-07-29T01:33:19Z'],
 ['2026-02-30 09:33:19',null],
 [null,null],
])('publishes the source business timezone for consumption time %s', (input,expected)=>{
 const snapshot=source([stock('1','1','4',{hzkj_use_time:input})])
 const next=physicalBusinessProjection(order(),{items:[{id:'L1'}]},new Map(),[],[],snapshot)
 expect(next.items[0].procurementSource.records[0].usedAt).toBe(expected)
 expect(snapshot.records[0].usedAt).toBe(input)
})
it('splits partial full/deposit stock and direct quantity by SKU without trusting header mode',()=>{
 const result=procurementSources({...order(),hzkj_lock_store:'1'},source([stock(),stock('2','1','2')]))
 expect(result.status).toBe('complete')
 expect(result.items[0]).toMatchObject({skuId:'S1',demandQuantity:'10',fullPaymentQuantity:'4',depositQuantity:'2',directQuantity:'4',fullPaymentReserved:'4',fullPaymentUsed:'0',depositUsed:'2'})
})
it('payment status transition changes stage only and repeated same records do not double count',()=>{
 const before=procurementSources(order(),source([stock()])).items[0]
 const after=procurementSources(order(),source([stock('1','1'),stock('1','1')])).items[0]
 expect(after.fullPaymentQuantity).toBe(before.fullPaymentQuantity)
 expect(after).toMatchObject({fullPaymentReserved:'0',fullPaymentUsed:'4',directQuantity:'6'})
})
it('aggregates repeated SKU lines once, excludes virtual SKU, and never cross-offsets other SKUs',()=>{
 const result=procurementSources(order([{id:'1',hzkj_local_sku:{id:'S1'},hzkj_qty:'6'},{id:'2',hzkj_local_sku:{id:'S1'},hzkj_qty:'4'},{id:'3',hzkj_local_sku:{id:'S2'},hzkj_qty:'2'},{id:'4',hzkj_local_sku:{id:'V',number:'HZ000020-001'},hzkj_qty:'3'}]),source([stock()]))
 expect(result.items).toHaveLength(2)
 expect(result.items.map(x=>[x.skuId,x.demandQuantity,x.directQuantity])).toEqual([['S1','10','6'],['S2','2','2']])
})
it('does not fabricate direct quantity when SKU is absent from a consumption record',()=>{
 const r=procurementSources(order(),source([stock('1','1','4',{hzkj_sales_order_sku_id:undefined})]))
 expect(r.status).toBe('incomplete');expect(r.items[0].directQuantity).toBeNull()
 expect(r.issues).toContain('consumption_sku_missing')
})
it('unknown coverage cannot prove zero stock; a complete empty response can',()=>{
 expect(procurementSources(order(),source([],false)).items[0].directQuantity).toBeNull()
 expect(procurementSources(order(),source([])).items[0].directQuantity).toBe('10')
})
it('a released record disappears from a complete replacement and restores direct demand',()=>{
 expect(procurementSources(order(),source([stock()])).items[0].directQuantity).toBe('6')
 expect(procurementSources(order(),source([])).items[0].directQuantity).toBe('10')
})
it('rejects over-allocation and conflicting repeated IDs instead of truncating or guessing',()=>{
 expect(procurementSources(order(),source([stock('1','1','11')])).items[0].directQuantity).toBeNull()
 expect(()=>normalizeStockConsumptions([stock(),stock('1','1')],'100000')).toThrow('consumption_conflicting_record')
})
it('scopes records to their exact order and company; missing purchase source never uses selection flags',()=>{
 expect(()=>normalizeStockConsumptions([{...stock(),org_id:'other'}],'100000')).toThrow('consumption_company_mismatch')
 const r=procurementSources({...order(),hzkj_use_stock:'1'},source([stock('1','1','4',{hzkj_sale_order_billno:'OTHER'})]))
 expect(r.items[0].directQuantity).toBe('10')
})
it('uses precise decimal arithmetic and requires audited demand',()=>{
 const o=order([{id:'1',hzkj_local_sku:{id:'S1'},hzkj_qty:'0.3'}])
 expect(procurementSources(o,source([stock('1','1','0.1')])).items[0].directQuantity).toBe('0.2')
 expect(procurementSources({...o,billstatus:'B'},source([])).status).toBe('not_applicable')
 const large=order([{id:'1',hzkj_local_sku:{id:'S1'},hzkj_qty:'9999999999999999.12345678'}])
 expect(procurementSources(large,source([stock('1','1','0.1')])).items[0].directQuantity).toBe('9999999999999999.02345678')
 expect(procurementSources(o,source([stock('1','1','0.123456789')])).status).toBe('incomplete')
})
it('attaches sources to raw physical lines by SKU, not the old whole-line stock flag',()=>{
 const o=order(),s=procurementSources(o,source([stock()]))
 expect(withProcurementSources(o,s).hzkj_orders_billentry[0].procurementSource.directQuantity).toBe('6')
 const changed=order([{id:'L1',hzkj_local_sku:{id:'S1'},hzkj_qty:'12'}])
 expect(withProcurementSources(changed,s).hzkj_orders_billentry[0].procurementSource).toBeUndefined()
 const stale=physicalBusinessProjection(changed,{items:[{id:'L1',procurementSource:s.items[0]}],procurementSources:s},new Map(),[])
 expect(stale.procurementSources).toBeUndefined()
 expect(stale.items[0].procurementSource).toBeUndefined()
})
it.each(['0','4'])('an unknown stock SKU cannot create direct demand but preserves native milestone %s',status=>{
 const raw={...order([{id:'L1',hzkj_local_sku:{id:'S1'},hzkj_qty:'4',hzkj_entrypurc_status:status,hzkj_use_stock:'1'}]),hzkj_orderstatus:'2'}
 const next=physicalBusinessProjection(raw,{id:'O1',items:[{id:'L1'}],procurementStage:'not_required'},new Map(),[],[],source([stock('1','1','4',{hzkj_sales_order_sku_id:undefined})]))
 expect(next.procurementSources.status).toBe('incomplete')
 expect(next.procurementQueueFlags.pending).toBe(false)
 expect(next.procurementStage).toBe(status==='0'?'unknown':'shipped')
 expect(next.timestampProcurementBasis.lineCoverageVerified).toBe(false)
})
it.each(['1','2'])('keeps fully reserved type %s waiting for its stock supplier without inventing direct demand',type=>{
 const raw={...order(),hzkj_orderstatus:'2'}
 const records=source([{...stock(type,'1','10'),hzkj_purchase_status:'2'}])
 const next=physicalBusinessProjection(raw,{id:'O1',items:[{id:'L1'}]},new Map(),[],[],records)
 expect(next.procurementSources.items[0].directQuantity).toBe('0')
 expect(next.procurementQueueFlags).toMatchObject({pending:false,shipping:true,completed:false})
 expect(next.procurementStage).toBe('supplier_pending')
 expect(next.nativeSupplierShipment).toBe('pending')
 expect(next.fulfillmentProgress.supplierShipment).toBe('pending')
 const shipped=physicalBusinessProjection(raw,next,new Map(),[],[],source([{...stock(type,'1','10'),hzkj_purchase_status:'4'}]))
 expect(shipped.procurementQueueFlags.shipping).toBe(false)
})
it.each(['0','4'])('keeps direct procurement and stock supplier milestones separate for native %s',status=>{
 const raw={...order([{id:'L1',hzkj_local_sku:{id:'S1'},hzkj_qty:'10',hzkj_entrypurc_status:status}]),hzkj_orderstatus:'2'}
 const next=physicalBusinessProjection(raw,{id:'O1',items:[{id:'L1'}]},new Map(),[],[],source([{...stock('1','1','4'),hzkj_purchase_status:'2'}]))
 expect(next.procurementQueueFlags.shipping).toBe(true)
 expect(next.procurementQueueFlags.pending).toBe(status==='0')
 expect(next.procurementStage).toBe(status==='0'?'purchase_order_pending':'supplier_partial')
 expect(next.fulfillmentProgress.supplierShipment).toBe(status==='0'?'pending':'partial')
})
