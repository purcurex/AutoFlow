import { normalizeTimestampProjectionRaw, TIMESTAMP_PROJECTION_KINDS } from './timestamp-projection-normalizer'
import { normalizeCollectedOrder } from '../fop-data/collected-order-normalizer'
import { normalizeNativeCapture } from '../fop-data/collected-native-facts'

const company = '100000'
const order = (extra: Record<string, unknown> = {}) => ({ id: '10', billno: 'TO10', billstatus: 'C', createtime: '2026-11-01 00:00:00', modifytime: '2026-11-02 01:00:00',
  hzkj_operator_id: '70', hzkj_operator_name: 'Alex', hzkj_customer_id: '80', hzkj_customer_name: 'Customer', hzkj_dept_id: '90', hzkj_dept_name: '业务一部',
  hzkj_dst_warehouse_id: '60', hzkj_dst_warehouse_number: 'HZ', hzkj_dst_warehouse_name: 'Warehouse', hzkj_country_id: '50', hzkj_country_twocountrycode: 'US',
  hzkj_settlecurrency_number: 'USD', hzkj_total_amount: '12.34', hzkj_order_amount: '10.00', hzkj_orderstatus: '3', hzkj_receipt_status: '1',
  hzkj_receipt_date: '2026-11-02 00:00:00', hzkj_datetimefield: '2026-11-01 23:00:00',
  hzkj_orders_billentry: [{id: '11', pid: '10', seq: 1, hzkj_qty: '2', hzkj_local_sku_id: '501', hzkj_local_sku_number: 'SKU-1', hzkj_local_sku_name: 'Product', hzkj_local_sku_hzkj_picturefield: 'https://example.test/item.png'}], ...extra })
const allocation = (extra: Record<string, unknown> = {}) => ({ id: '20', billno: 'AL20', org_id: company, billstatus: 'C', hzkj_order_id: '10', hzkj_order_no: 'TO10', hzkj_operator_id: '70', hzkj_alloc_status: 'completed', auditdate: '2026-11-02 01:00:00', hzkj_complete_time: '2026-11-02 00:00:00', hzkj_alloc_entry: [{id: '21',seq:1,hzkj_sku_id:'501',hzkj_sku_number:'SKU-1',hzkj_req_qty:'2'}], ...extra })
const dispatch = (extra: Record<string, unknown> = {}) => ({ id: '30', billno: 'DS30', org_id: company, billstatus: 'C', hzkj_order_no: 'TO10', hzkj_customer_id: '80', hzkj_delivery_status: 'TRACKING_OBTAINED', hzkj_logistics_channel1_name: 'Actual Channel', hzkj_logistics_channel1_number: 'CH1', hzkj_logistics_providers_id: '40', hzkj_logistics_providers_name: 'Carrier', hzkj_logistics_orderno:'FULL-1', hzkj_logistics_trackno:'LAST-1', auditdate:'2026-11-02 02:00:00', hzkj_logisticstrackentry:[], ...extra })
const notice = (extra: Record<string, unknown> = {}) => ({id:'40',billno:'DN40',org_id:company,auditdate:'2026-11-02 03:00:00',entryentity:[{id:'41',seq:1,hzkj_order_billno:'TO10',hzkj_local_sku_id:'501',hzkj_local_sku_number:'SKU-1',hzkj_qty:'2',modifydatefield:'2026-11-02 03:00:00'}],...extra})

it('bridges flattened order references and UTC+8 times without mutating the source payload', () => {
  const raw = order(), before = JSON.stringify(raw)
  const projected = normalizeTimestampProjectionRaw('hzkj_orders',raw,company)
  expect(JSON.stringify(raw)).toBe(before)
  expect(projected.hzkj_orders_billentry).not.toBe(raw.hzkj_orders_billentry)
  expect(projected).toMatchObject({hzkj_org:{id:company},hzkj_operator:{id:'70',name:'Alex'},hzkj_country:{id:'50',twocountrycode:'US'},hzkj_settlecurrency:{number:'USD'},createtime:'2026-11-01T00:00:00+08:00',timestampProjection:{companyBasis:'verified_timestamp_scope'}})
  const normalized = normalizeCollectedOrder(projected,{companyId:company})
  expect(normalized).toMatchObject({owner_employee_id:'70',customer_id:'80',warehouse_code:'HZ',country_code:'US',created_at:'2026-10-31T16:00:00.000Z',paid_at:'2026-11-01T16:00:00.000Z',consumer_paid_at:'2026-11-01T15:00:00.000Z',total_amount:'12.34',currency_code:'USD'})
  expect(normalized.display.items[0]).toMatchObject({id:'11',parentId:'10',productId:'501',sku:'SKU-1',name:'Product',quantity:2})
})
it('preserves explicit zones and known business dates while leaving invalid or absent times unknown',()=>{
 const projected=normalizeTimestampProjectionRaw('hzkj_orders',order({auditdate:'2026-11-02T01:00:00Z',hzkj_receipt_date:'2026-02-30 00:00:00',hzkj_datetimefield:null,hzkj_bizdate:'2026-11-01'}),company)
 expect(projected.auditdate).toBe('2026-11-02T01:00:00Z')
 expect(projected.hzkj_receipt_date).toBeNull();expect(projected.hzkj_datetimefield).toBeNull()
 expect(projected.hzkj_bizdate).toBe('2026-11-01T00:00:00+08:00')
 expect(projected.timestampProjection.unknownTimes).toEqual(['hzkj_receipt_date'])
 expect(projected.timestampProjection.timeMappings).toContainEqual({field:'auditdate',basis:'explicit_timezone',precision:'timestamp'})
})
it('feeds allocation, dispatch and delivery-notice facts into the existing native normalizer',()=>{
 const parent=normalizeTimestampProjectionRaw('hzkj_orders',order(),company)
 const a=normalizeTimestampProjectionRaw('hzkj_alloc_bill',allocation(),company)
 const d=normalizeTimestampProjectionRaw('hzkj_deliver_bill',dispatch(),company)
 const n=normalizeTimestampProjectionRaw('hzkj_deliver_order',notice(),company)
 const result=normalizeNativeCapture([{items:[parent],facts:{allocations:[a],dispatches:[d],deliveryNotices:[n]}}],{companyId:company,complete:true,coverage:'full_parent_scan',queue:'allocation'})
 expect(result.entities.find(e=>e.entityType==='allocation')).toMatchObject({ownerEmployeeId:'70',display:{sourceOrderId:'10',approvedAt:'2026-11-01T17:00:00.000Z',association:{state:'verified'}}})
 expect(result.entities.find(e=>e.entityType==='dispatch')).toMatchObject({ownerEmployeeId:'70',display:{sourceOrderId:'10',channelName:'Actual Channel',channelCode:'CH1',carrierName:'Carrier',approvedAt:'2026-11-01T18:00:00.000Z',association:{state:'verified'}}})
 expect(result.entities.find(e=>e.entityType==='delivery_notice')).toMatchObject({sourceId:'40',display:{association:{state:'raw_only'}}})
 expect(n.entryentity[0]).toMatchObject({hzkj_local_sku:{id:'501',number:'SKU-1'},modifydatefield:'2026-11-02T03:00:00+08:00'})
 expect(TIMESTAMP_PROJECTION_KINDS.hzkj_deliver_order).toBe('delivery_notice')
})
it('does not substitute unrelated source references, old nested fields, carrier channel or payment timestamps',()=>{
 const raw=order({hzkj_operator_id:null,hzkj_operator_name:null,hzkj_operator:{name:'Old display'},hzkj_customer_id:'0',hzkj_customer_name:null,hzkj_receipt_date:null,hzkj_total_amount:null,hzkj_settlecurrency_number:null})
 const projected=normalizeTimestampProjectionRaw('hzkj_orders',raw,company), normalized=normalizeCollectedOrder(projected,{companyId:company})
 expect(projected.hzkj_operator).toEqual({id:null,name:null})
 expect(normalized.owner_employee_id).toBeNull();expect(normalized.customer_id).toBeNull();expect(normalized.paid_at).toBeNull();expect(normalized.total_amount).toBeNull();expect(normalized.currency_code).toBeNull()
 const projectedDispatch=normalizeTimestampProjectionRaw('hzkj_deliver_bill',dispatch({hzkj_logistics_channel1_name:null,hzkj_logistics_channel1_number:null}),company)
 expect(projectedDispatch.hzkj_logistics_channel1).toEqual({name:null,number:null})
})
it.each([
 ['hzkj_orders',order({id:10}),'invalid_id'],
 ['hzkj_orders',order({hzkj_operator_id:70}),'invalid_id'],
 ['hzkj_orders',order({hzkj_org:{id:'200000'}}),'company_mismatch'],
 ['hzkj_alloc_bill',allocation({org_id:'200000'}),'company_mismatch'],
 ['hzkj_deliver_order',notice({org_id:undefined}),'invalid_id'],
 ['hzkj_orders',order({hzkj_orders_billentry:undefined}),'partial_entries'],
 ['hzkj_orders',order({hzkj_orders_billentry:[{id:'11',pid:999}]}),'invalid_id'],
 ['hzkj_orders',order({hzkj_orders_billentry:[{id:'11'},{id:'11'}]}),'duplicate_entry_id'],
 ['hzkj_orders',order({hzkj_orders_billentry:[{id:11}]}),'invalid_id'],
 ['hzkj_orders',order({hzkj_operator:{id:'71'}}),'reference_conflict'],
 ['hzkj_orders',order({billno:''}),'missing_billno'],
 ['unknown',order(),'unsupported_entity'],
])('rejects malformed projection input for %s with stable %s errors',(entity,raw,error)=>{
 expect(()=>normalizeTimestampProjectionRaw(entity as string,raw,company)).toThrow(`timestamp_projection_${error}`)
})
it('does not assign a business timezone to carrier-local tracking time',()=>{
 const raw=dispatch({hzkj_logisticstrackentry:[{id:'31',hzkj_process_time:'2026-11-02 02:00:00',hzkj_track_time_zone:'America/New_York',hzkj_modifydatefield2:'2026-11-02 00:00:00'}]})
 const out=normalizeTimestampProjectionRaw('hzkj_deliver_bill',raw,company)
 expect(out.hzkj_logisticstrackentry[0].hzkj_process_time).toBe('2026-11-02 02:00:00')
 expect(out.hzkj_logisticstrackentry[0].hzkj_modifydatefield2).toBe('2026-11-02T00:00:00+08:00')
})

it('keeps source line hierarchy pid=0 as empty instead of inventing a header or parent-line link',()=>{
 const raw=order({hzkj_orders_billentry:[{id:'11',pid:'0',seq:1,hzkj_qty:'1'}]})
 const projected=normalizeTimestampProjectionRaw('hzkj_orders',raw,company)
 expect(projected.hzkj_orders_billentry[0].pid).toBe('0')
 expect(normalizeCollectedOrder(projected,{companyId:company}).display.items[0].parentId).toBeUndefined()
})
it('normalizes an explicitly null native entry collection without inventing rows or changing the stored raw',()=>{
 const raw=order({hzkj_orders_billentry:null})
 expect(normalizeTimestampProjectionRaw('hzkj_orders',raw,company).hzkj_orders_billentry).toEqual([])
 expect(raw.hzkj_orders_billentry).toBeNull()
})

it('normalizes complete purchase references and payment facts without accepting missing relationship fields',()=>{
 const raw={id:'80',billno:'P80',org_id:company,hzkj_supplier_id:'90',hzkj_supplier_name:'Supplier',hzkj_pay_time:'2026-11-02 08:00:00',hzkj_billentry:[{id:'81',hzkj_salbillnumber:'TO10',hzkj_salbillid:'0',hzkj_salbillentryid:'0',hzkj_material_number:'SKU-1',hzkj_qty:'2'}]}
 const before=JSON.stringify(raw),out=normalizeTimestampProjectionRaw('hzkj_purorderbill',raw,company)
 expect(out).toMatchObject({organizationId:company,hzkj_supplier:{id:'90',name:'Supplier'},hzkj_pay_time:'2026-11-02T08:00:00+08:00',hzkj_billentry:[{hzkj_material:{number:'SKU-1'},hzkj_salbillnumber:'TO10'}]})
 expect(JSON.stringify(raw)).toBe(before)
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',{...raw,org_id:'200000'},company)).toThrow('company_mismatch')
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',{...raw,hzkj_billentry:[{id:'81'}]},company)).toThrow('missing_purchase_sales_reference')
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',{...raw,hzkj_billentry:undefined},company)).toThrow('partial_entries')
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',{...raw,hzkj_billentry:[{id:'81',hzkj_salbillnumber:null}]},company)).not.toThrow()
})
it('publishes a complete numbered purchase even when optional legacy line references disappear',()=>{
 const previous={id:'80',billno:'P80',org_id:company,hzkj_billentry:[{id:'81',hzkj_salbillnumber:'TO10',hzkj_salbillid:'10',hzkj_salbillentryid:'101'}]}
 const incoming={...previous,hzkj_billentry:[{id:'81',hzkj_salbillnumber:'TO10'}]}
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',incoming,company,previous)).not.toThrow()
 expect(normalizeTimestampProjectionRaw('hzkj_purorderbill',incoming,company,previous).hzkj_billentry[0]).not.toHaveProperty('hzkj_salbillentryid')
})


it('accepts a verified fulfillment source number without an optional sales number',()=>{
 const raw={id:'80',billno:'P80',org_id:company,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO10',hzkj_srcbillentity:'hzkj_orders'}]}
 expect(normalizeTimestampProjectionRaw('hzkj_purorderbill',raw,company).hzkj_billentry).toEqual(raw.hzkj_billentry)
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',{...raw,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'PA10',hzkj_srcbillentity:'hzkj_purapplybill'}]},company)).toThrow('missing_purchase_sales_reference')
})
it('keeps a published authoritative source reference when its field is omitted, while allowing explicit clearing',()=>{
 const previous={id:'80',billno:'P80',org_id:company,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO10',hzkj_salbillnumber:'TO20'}]}
 const incoming={...previous,hzkj_billentry:[{id:'81',hzkj_salbillnumber:'TO20'}]}
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',incoming,company,previous)).toThrow('missing_purchase_source_reference')
 const cleared={...incoming,hzkj_billentry:[{...incoming.hzkj_billentry[0],hzkj_srcbillnumber:null}]}
 expect(normalizeTimestampProjectionRaw('hzkj_purorderbill',cleared,company,previous).hzkj_billentry[0]).toMatchObject({hzkj_srcbillnumber:null,hzkj_salbillnumber:'TO20'})
})


it('accepts explicit clearing of a source-only purchase link without restoring an old reference',()=>{
 const previous={id:'80',billno:'P80',org_id:company,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:'TO10'}]}
 const cleared={...previous,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:null}]}
 expect(normalizeTimestampProjectionRaw('hzkj_purorderbill',cleared,company,previous).hzkj_billentry[0]).toEqual({id:'81',hzkj_srcbillnumber:null})
})


it('does not treat an empty optional source number as clearing an omitted authoritative sales number',()=>{
 const previous={id:'80',billno:'P80',org_id:company,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:null,hzkj_salbillnumber:'TO10'}]}
 const incoming={...previous,hzkj_billentry:[{id:'81',hzkj_srcbillnumber:null}]}
 expect(()=>normalizeTimestampProjectionRaw('hzkj_purorderbill',incoming,company,previous)).toThrow('missing_purchase_sales_reference')
})
