import Decimal from 'decimal.js'
const ExactDecimal = Decimal.clone({ precision: 80 })
type Row = Record<string, any>
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
function id(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('collected_unsafe_identifier')
    value = String(value)
  }
  return typeof value === 'string' && /^[1-9]\d{0,30}$/.test(value) ? value : null
}
function decimal(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const s = typeof value === 'number' ? String(value) : text(value)
  return s && /^-?\d{1,40}(?:\.\d{1,20})?$/.test(s) ? new ExactDecimal(s).toFixed() : null
}
function number(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) && new ExactDecimal(n.toString()).eq(value) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null
}
function date(value: unknown): string | null {
  const s = text(value)
  return s && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null
}
const ref = (value: unknown) => { const r = object(value); return id(r.id) ? { id:id(r.id)!, name:text(r.name) || '' } : undefined }

/** Partial historical source facts only. No default currency, totals, current stock, or authorization leases. */
export function normalizeCollectedOrder(input: unknown, context: {companyId: string; warehouseMap?: Record<string,string>}) {
  const r=object(input), sourceId=id(r.id), org=ref(r.hzkj_org)
  if (!sourceId || !text(r.billno)) throw new Error('collected_missing_primary_key')
  if (!org || org.id !== context.companyId) throw new Error('collected_company_mismatch')
  const missing = new Set<string>()
  const product=decimal(r.hzkj_order_amount), total=decimal(r.hzkj_total_amount)
  const settlement=text(object(r.hzkj_settlecurrency).number)
  const currency=settlement && /^[A-Z]{3}$/.test(settlement) ? settlement : null
  const entries=Array.isArray(r.hzkj_orders_billentry) ? r.hzkj_orders_billentry : []
  const quantities=entries.map((e:unknown)=>decimal(object(e).hzkj_qty))
  const quantity=entries.length && quantities.every((q:string|null)=>q!==null) ? quantities.reduce((s:Decimal,q:string)=>s.plus(q),new ExactDecimal(0)).toFixed() : null
  const items=entries.map((v:unknown,i:number)=>{const e=object(v),sku=object(e.hzkj_local_sku);return {
    id:id(e.id)||undefined,parentId:id(e.pid)||undefined,productId:id(sku.id)||undefined,
    sku:text(sku.number)||'',name:text(sku.name)||'',imageUrl:text(e.hzkj_picture)||text(sku.hzkj_picturefield),
    variant:Array.isArray(sku.hzkj_sku_values)?sku.hzkj_sku_values.map((x:unknown)=>text(object(x).name)).filter(Boolean).join(' / '):'',quantity:number(quantities[i]),
  }})
  const owner=ref(r.hzkj_operator),customer=ref(r.hzkj_customer),warehouse=ref(r.hzkj_dst_warehouse),shop=ref(r.hzkj_shop)
  const bill=text(r.billstatus),payment=text(r.hzkj_receipt_status),status=text(r.hzkj_orderstatus),delivery=text(r.hzkj_delivery_status)
  const paidAt=date(r.hzkj_receipt_date),consumerPaidAt=date(r.hzkj_datetimefield),createdAt=date(r.createtime)
  const paymentStatus=payment==='1'?'paid':payment==='0'?'unpaid':'unknown'
  const reviewStatus=bill==='C'?'approved':['A','B'].includes(bill||'')?'pending':'unknown'
  const cancelled=status==='0'?true:['1','2','3','4','5','no'].includes(status||'')?false:null
  const warehouseCode=warehouse ? context.warehouseMap?.[warehouse.id] || text(object(r.hzkj_dst_warehouse).number) : null
  const country=text(object(r.hzkj_country).twocountrycode)
  for(const [field,value] of Object.entries({amount:total,productAmount:product,currency,totalQuantity:quantity,paymentStatus,reviewStatus,cancelled,createdAt,paidAt,ownerEmployeeId:owner?.id,customerId:customer?.id}))if(value==null||value==='unknown')missing.add(field)
  for(const field of ['fulfillmentProgress','dispatchDocuments','allocationDocument','procurementProgress','shipmentInterceptStatus'])missing.add(field)
  if(items.some((x:Row)=>x.quantity===null))missing.add('itemQuantity')
  const display: Row={
    id:sourceId,orderNumber:text(r.billno),shopifyOrderNumber:text(r.hzkj_source_number)||'',organization:org,department:ref(r.hzkj_dept),owner,
    departmentPathIds:Array.isArray(r.departmentPathIds)?r.departmentPathIds.map(id).filter(Boolean):[],
    customerId:customer?.id,customerName:customer?.name||'',storeName:shop?.name||'',warehouseCode:warehouseCode||undefined,warehouse:warehouse?.name||'',salesperson:owner?.name||'',
    items,amount:number(total),currency,paymentStatus,reviewStatus,cancelled,createdAt,paidAt,consumerPaidAt:paidAt,sourceOrderPaidAt:consumerPaidAt,reviewedAt:date(r.auditdate),
    amountBreakdown:{productAmount:number(product),shippingFee:null,taxAmount:null,discountAmount:null,totalAmount:number(total)},
    sourcePurchaseStatus:['0','1','2','3','4'].includes(text(r.hzkj_purchase_status)||'')?r.hzkj_purchase_status:null,
    sourceOutboundStatus:['0','1','2'].includes(delivery||'')?delivery:null,
    procurementStatus:'unknown',allocationStatus:'unknown',dispatchStatus:'unknown',shippingStatus:'unknown',dispatchTaskStatus:'unknown',
    fulfillmentProgress:{allocationCreated:null,shopifySync:'unknown',supplierShipment:'unknown',stockReadiness:'unknown',allocationReview:'unknown',outbound:'unknown'},
    procurementProgress:{purchaseOrder:'unknown',supplierPayment:'unknown'},dispatchDocuments:null,allocationDocument:null,shipmentInterceptStatus:null,
    carrier:null,carrierCode:undefined,trackingNumber:null,logisticsInfo:null,logisticsChannels:null,customLogisticsChannelName:text(object(r.hzkj_customer_channel).name),
    shippingCountryCode:country&&/^[A-Z]{2}$/.test(country)?country:null,
    shippingRecipient:{name:[text(r.hzkj_customer_first_name),text(r.hzkj_customer_last_name)].filter(Boolean).join(' ')||null,phone:text(r.hzkj_phone),email:text(r.hzkj_email),state:text(r.hzkj_state),city:text(r.hzkj_city),postalCode:text(r.hzkj_post_code),addressLine1:text(r.hzkj_address1),addressLine2:text(r.hzkj_address2)},
    exception:null,dataQuality:{mode:'collected',readOnly:true,missingFields:[...missing],reasons:['legacy_capture_not_consistent_snapshot','linked_workbench_facts_not_provided']},
  }
  return {source_id:sourceId,order_number:text(r.billno)!,owner_employee_id:owner?.id||null,customer_id:customer?.id||null,warehouse_code:warehouseCode||null,country_code:display.shippingCountryCode,
    bill_type:text(object(r.hzkj_billtype).number),raw_bill_status:bill,raw_order_status:status,raw_payment_status:payment,raw_delivery_status:delivery,
    created_at:createdAt,paid_at:paidAt,consumer_paid_at:consumerPaidAt,product_amount:product,total_amount:total,currency_code:currency,total_quantity:quantity,
    search_text:[sourceId,r.billno,r.hzkj_source_number,customer?.name,shop?.name,...items.flatMap((x:Row)=>[x.sku,x.name])].filter(Boolean).join(' ').toLowerCase(),display,raw:r}
}
