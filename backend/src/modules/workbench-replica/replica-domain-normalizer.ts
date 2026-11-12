import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { validateChangeGroup, type ReplicaChangeGroup, type ReplicaDatasetScope, type ReplicaRow } from './replica-change-contract'
import { matchesQueue, type Queue } from '../fop-data/workbench-queue-rules'
import { getProcurementStage } from '../fop-data/procurement-stage'
import type { FopOrder } from '../fop-data/fop-data.types'

/** Proposed service-feed domain contract. This is NOT evidence that a FOP endpoint is deployed.
 * No local SQL table, column, UUID, readiness, membership or projection revision crosses the wire.
 * All numeric source identities, versions and business decimal values remain strings.
 */
export const REPLICA_DOMAIN_VERSION = 'fop-replica-domain/1' as const
export const REPLICA_ENTITY_FIELDS = {
  "hzkj_orders": {
    "table": "hz_fop_fulfillment_orders",
    "fields": {
      "customChannelId": "custom_channel_id",
      "customChannelName": "custom_channel_name",
      "customerId": "customer_id",
      "payingCustomerId": "paying_customer_id",
      "receivingCustomerId": "receiving_customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "storeId": "store_id",
      "warehouseId": "warehouse_id",
      "rawOrderStatus": "raw_order_status",
      "rawPaymentStatus": "raw_payment_status",
      "customerPaidAt": "customer_paid_at",
      "settlementCurrency": "settlement_currency",
      "rawPurchaseStatus": "raw_purchase_status",
      "shopifyOrderNumber": "shopify_order_number",
      "shopifyOrderId": "shopify_order_id",
      "consumerPaidAt": "consumer_paid_at",
      "productAmount": "product_amount",
      "freightAmount": "freight_amount",
      "taxAmount": "tax_amount",
      "discountAmount": "discount_amount",
      "totalAmount": "total_amount",
      "rawStockUsage": "raw_stock_usage",
      "rawDeliveryStatus": "raw_delivery_status",
      "outboundAt": "outbound_at",
      "rawRefundStatus": "raw_refund_status",
      "rawAddressCheck": "raw_address_check",
      "recipientName": "recipient_name",
      "recipientPhone": "recipient_phone",
      "recipientEmail": "recipient_email",
      "countryCode": "country_code",
      "stateName": "state_name",
      "cityName": "city_name",
      "postalCode": "postal_code",
      "addressLine1": "address_line1",
      "addressLine2": "address_line2"
    }
  },
  "hzkj_stock_order_new": {
    "table": "hz_fop_stock_orders",
    "fields": {
      "procurementPaidAt": "procurement_paid_at",
      "customerId": "customer_id",
      "payingCustomerId": "paying_customer_id",
      "receivingCustomerId": "receiving_customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "storeId": "store_id",
      "rawOrderStatus": "raw_order_status",
      "rawPaymentStatus": "raw_payment_status",
      "customerPaidAt": "customer_paid_at",
      "settlementCurrency": "settlement_currency",
      "rawPurchaseStatus": "raw_purchase_status",
      "warehouseId": "warehouse_id",
      "stockType": "stock_type",
      "businessCreatedAt": "business_created_at",
      "totalAmount": "total_amount",
      "receivableAmount": "receivable_amount",
      "receivedAmount": "received_amount",
      "depositAmount": "deposit_amount",
      "rawRefundStatus": "raw_refund_status"
    }
  },
  "hzkj_purapplybill": {
    "table": "hz_fop_purchase_requisitions",
    "fields": {
      "requestingOrgId": "requesting_org_id",
      "businessAt": "business_at",
      "rawProcurementStatus": "raw_procurement_status",
      "rawCloseStatus": "raw_close_status",
      "rawCancelStatus": "raw_cancel_status"
    }
  },
  "hzkj_purorderbill": {
    "table": "hz_fop_purchase_orders",
    "fields": {
      "paidAt": "paid_at",
      "supplierId": "supplier_id",
      "buyerId": "buyer_id",
      "purchasingAccountId": "purchasing_account_id",
      "purchaseType": "purchase_type",
      "platformCode": "platform_code",
      "totalAmount": "total_amount",
      "settlementCurrency": "settlement_currency",
      "paidAmount": "paid_amount",
      "unpaidAmount": "unpaid_amount",
      "rawTradeStatus": "raw_trade_status",
      "rawPlatformStatus": "raw_platform_status",
      "rawCancelStatus": "raw_cancel_status",
      "businessAt": "business_at"
    }
  },
  "hzkj_receiptnotice": {
    "table": "hz_fop_receipt_notices",
    "fields": {
      "supplierId": "supplier_id",
      "warehouseId": "warehouse_id",
      "businessAt": "business_at",
      "supplierShippedAt": "supplier_shipped_at",
      "trackingNumber": "tracking_number",
      "rawWmsStatus": "raw_wms_status",
      "rawShippingStatus": "raw_shipping_status"
    }
  },
  "im_purinbill": {
    "table": "hz_fop_inbound_bills",
    "fields": {
      "warehouseId": "warehouse_id",
      "supplierId": "supplier_id",
      "businessAt": "business_at",
      "rawCancelStatus": "raw_cancel_status"
    }
  },
  "hzkj_alloc_bill": {
    "table": "hz_fop_allocations",
    "fields": {
      "sourceOrderId": "source_order_id",
      "sourceOrderNumber": "source_order_number",
      "packageNumber": "package_number",
      "warehouseId": "warehouse_id",
      "customerId": "customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "rawAllocationStatus": "raw_allocation_status",
      "rawOperationStatus": "raw_operation_status",
      "readyAt": "ready_at",
      "idempotencyKey": "idempotency_key"
    }
  },
  "hzkj_deliver_bill": {
    "table": "hz_fop_dispatches",
    "fields": {
      "customerId": "customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "warehouseId": "warehouse_id",
      "providerId": "provider_id",
      "actualChannelId": "actual_channel_id",
      "sourcePackage": "source_package",
      "rawFulfillmentStatus": "raw_fulfillment_status",
      "rawDeliveryStatus": "raw_delivery_status",
      "rawShopifySyncStatus": "raw_shopify_sync_status",
      "shopifySyncedAt": "shopify_synced_at",
      "deliveryNoticePushedAt": "delivery_notice_pushed_at"
    }
  },
  "im_saloutbill": {
    "table": "hz_fop_outbound_bills",
    "fields": {
      "warehouseId": "warehouse_id",
      "customerId": "customer_id",
      "businessAt": "business_at",
      "rawCancelStatus": "raw_cancel_status",
      "movementKind": "movement_kind"
    }
  },
  "hzkj_receive_bill": {
    "table": "hz_fop_receipts",
    "fields": {
      "payingCustomerId": "paying_customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "receiptType": "receipt_type",
      "rawReceiveStatus": "raw_receive_status",
      "rawArrivalStatus": "raw_arrival_status",
      "receivedAt": "received_at",
      "receivedAmount": "received_amount",
      "orderAmount": "order_amount",
      "currencyCode": "currency_code",
      "externalTransactionId": "external_transaction_id"
    }
  },
  "hzkj_pay_cost_bill": {
    "table": "hz_fop_payments",
    "fields": {
      "purchaseSourceId": "purchase_source_id",
      "purchaseNumber": "purchase_number",
      "platformOrderNumber": "platform_order_number",
      "amount": "amount",
      "dueAmount": "due_amount",
      "refundAmount": "refund_amount",
      "currencyCode": "currency_code",
      "rawPaymentStatus": "raw_payment_status",
      "paidAt": "paid_at",
      "confirmedAt": "confirmed_at"
    }
  },
  "hzkj_adjust_bill": {
    "table": "hz_fop_receipt_adjustments",
    "fields": {
      "customerId": "customer_id",
      "ownerEmployeeId": "owner_employee_id",
      "currencyCode": "currency_code",
      "adjustAmount": "adjust_amount",
      "feeAmount": "fee_amount",
      "reason": "reason"
    }
  },
  "hzkj_after_sale_orders": {
    "table": "hz_fop_rma_orders",
    "fields": {
      "sourceDocumentNumber": "source_document_number",
      "afterSaleType": "after_sale_type",
      "rawFlowStatus": "raw_flow_status",
      "isOpen": "is_open",
      "reason": "reason",
      "requestedAmount": "requested_amount",
      "requestedCurrency": "requested_currency",
      "refundAmount": "refund_amount",
      "refundCurrency": "refund_currency",
      "customerId": "customer_id",
      "storeId": "store_id"
    }
  },
  "hzkj_deliver_order": {
    "table": "hz_fop_delivery_notices",
    "fields": {
      "warehouseId": "warehouse_id",
      "customerId": "customer_id",
      "rawOrderStatus": "raw_order_status",
      "rawWmsStatus": "raw_wms_status",
      "logisticsBillNumber": "logistics_bill_number",
      "wmsCreatedAt": "wms_created_at",
      "businessAt": "business_at"
    }
  }
} as const
export type ReplicaDomainEntity = keyof typeof REPLICA_ENTITY_FIELDS
export interface ReplicaSourceRef { entityCode: ReplicaDomainEntity; sourceId: string }
export interface ReplicaLineRef extends ReplicaSourceRef { entryEntity: string; sourceEntryId: string }
export interface ReplicaDomainDependency extends ReplicaSourceRef { sourceVersion: string; relationRevision: string }
export interface ReplicaDomainEntry {
  entryEntity: string; sourceEntryId: string; sequence?: number; rowType?: string; skuSourceId?: string|null; skuMasterId?: string|null
  skuCode?: string|null; productName?: string|null; variant?: string|null; imageUrl?: string|null; quantity?: string|null
  unitCode?: string|null; unitPrice?: string|null; lineAmount?: string|null; currencyCode?: string|null; rawStatus?: string|null
  inboundQuantity?: string|null
  orderDetails?: Record<string, string|null>; procurementDetails?: Record<string,string|null>
  allocationDetails?: Record<string,string|null>; inventoryDetails?: Record<string,string|null>; financialDetails?: Record<string,string|null>; returnDetails?: Record<string,string|null>
}
export interface ReplicaDomainRelation {
  sourceRelationId: string; relationType: string; from: ReplicaSourceRef | ReplicaLineRef; to: ReplicaSourceRef | ReplicaLineRef
  allocatedQuantity?: string|null; allocatedAmount?: string|null; currencyCode?: string|null
}
export interface ReplicaDomainDocument extends ReplicaSourceRef {
  eventId: string; sourceVersion: string; operation: 'upsert'|'delete'; documentNumber: string
  linesComplete: true; relationsComplete: true
  sourceFields?: { rawBillStatus?: string|null; createdAt?: string|null; modifiedAt?: string|null; auditedAt?: string|null; relationRevision?: string }
  header?: Record<string,string|boolean|null>; entries: ReplicaDomainEntry[]; relations: ReplicaDomainRelation[]
  affectedOrders?: ReplicaSourceRef[]; workbench?: Record<string,unknown>
  packages?: Record<string,unknown>[]; trackingNumbers?: Record<string,unknown>[]; platformOrders?: Record<string,unknown>[]
}
export interface ReplicaDomainGroup {
 schemaVersion: typeof REPLICA_DOMAIN_VERSION; groupKey:string; afterCursor:string|null; endCursor:string; committedAt:string; expectedCount:number
 documents:ReplicaDomainDocument[]; orderProjections?: {order:ReplicaDomainDocument; dependencies:ReplicaDomainDependency[]}[]
}
const isRecord = (v:unknown):v is Record<string,any> => !!v && typeof v==='object' && !Array.isArray(v)
function object(v:unknown, allowed:readonly string[], path:string):Record<string,any> {
 if(!isRecord(v) || Object.keys(v).some(k=>!allowed.includes(k))) throw new Error(`Invalid domain ${path} field`)
 return v
}
function text(v:unknown,path:string,max=2000):string { if(typeof v!=='string'||!v.length||v.trim()!==v||v.length>max)throw new Error(`Invalid domain ${path}`);return v }
function version(v:unknown,path:string,max=30):string { const s=text(v,path,max);if(!/^\d+$/.test(s))throw new Error(`Invalid domain ${path}`);return s }
function timestamp(v:unknown,path:string):string { const s=text(v,path,100);if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw new Error(`Invalid domain ${path}`);return s }
function decimal(v:unknown,path:string):string { const s=text(v,path,40);if(!/^-?\d{1,20}(?:\.\d{1,8})?$/.test(s))throw new Error(`Invalid domain decimal ${path}`);return s }
function list(v:unknown,path:string):any[] {if(!Array.isArray(v)||v.length>100000)throw new Error(`Incomplete domain ${path}`);return v}
function unique(values:string[],path:string){if(new Set(values).size!==values.length)throw new Error(`Duplicate domain ${path}`)}
function stable(scope:ReplicaDatasetScope,...parts:string[]):string {const h=createHash('sha256').update(JSON.stringify(['fop-replica/1',scope.connectionId,scope.companyId,scope.datasetId,...parts])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export function sourceEntityIdentity(scope:ReplicaDatasetScope,entityCode:string,sourceId:string):string {text(entityCode,'entityCode',128);text(sourceId,'sourceId',128);return stable(scope,'document',entityCode,sourceId)}
export function sourceLineIdentity(scope:ReplicaDatasetScope,ref:ReplicaLineRef):string {return stable(scope,'line',ref.entityCode,ref.sourceId,ref.entryEntity,ref.sourceEntryId)}
function ref(value:unknown):ReplicaSourceRef|ReplicaLineRef {
 const r=object(value,['entityCode','sourceId','entryEntity','sourceEntryId'],'source reference')
 if(!Object.prototype.hasOwnProperty.call(REPLICA_ENTITY_FIELDS,text(r.entityCode,'entityCode',128)))throw new Error('Unsupported domain entity')
 text(r.sourceId,'sourceId',128)
 if(r.entryEntity!==undefined||r.sourceEntryId!==undefined){text(r.entryEntity,'entryEntity',128);text(r.sourceEntryId,'sourceEntryId',128)}
 return r as ReplicaSourceRef|ReplicaLineRef
}
const camel=(s:string)=>s.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase())
const snake=(s:string)=>s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())
const numericField=(key:string)=>/(?:Amount|Quantity|Price)$/.test(key)||['amount','quantity','baseQuantity','grossAmount'].includes(key)
function fields(input:unknown,mapping:Readonly<Record<string,string>>,path:string):Record<string,unknown>{
 const v=object(input,Object.keys(mapping),path),out:Record<string,unknown>={}
 for(const [key,column]of Object.entries(mapping)){
  const value=v[key]
  if(value==null){out[column]=null;continue}
  out[column]=key==='isOpen'?(()=>{if(typeof value!=='boolean')throw new Error(`Invalid domain ${path}.${key}`);return value})()
   :numericField(key)?decimal(value,`${path}.${key}`):/(?:At)$/.test(key)?timestamp(value,`${path}.${key}`):text(value,`${path}.${key}`,['reason','productName','variant','imageUrl'].includes(key)?10000:2000)
 }
 return out
}
const row=(table:string,values:Record<string,unknown>):ReplicaRow=>({table,values})
const orderEntities=['hzkj_orders','hzkj_stock_order_new']
const entryKeys=['entryEntity','sourceEntryId','sequence','rowType','skuSourceId','skuMasterId','skuCode','productName','variant','imageUrl','quantity','unitCode','unitPrice','lineAmount','currencyCode','rawStatus','inboundQuantity','orderDetails','procurementDetails','allocationDetails','inventoryDetails','financialDetails','returnDetails']
const detailMaps:Record<string,{table:string;fields:string[]}>={
 orderDetails:{table:'hz_fop_order_line_details',fields:['source_quantity','stock_consumed_quantity','purchased_quantity','inbound_quantity','discount_amount','tax_amount','gross_amount','raw_purchase_status','shopify_line_id']},
 procurementDetails:{table:'hz_fop_procurement_line_details',fields:['sales_order_number','supplier_id','ordered_quantity','supplier_shipped_quantity','received_quantity','inbound_quantity','cancelled_quantity','raw_close_status','raw_platform_status']},
 allocationDetails:{table:'hz_fop_allocation_line_details',fields:['source_order_entry_id','required_quantity','newly_reserved_quantity','allocated_quantity','short_quantity','customer_reserved_quantity','common_reserved_quantity','protected_quantity']},
 inventoryDetails:{table:'hz_fop_inventory_line_details',fields:['warehouse_id','stock_owner_id','lot_number','base_quantity','base_unit_code','direction','raw_line_status']},
 financialDetails:{table:'hz_fop_financial_line_details',fields:['source_document_type','source_document_number','order_amount','received_amount','refund_amount','fee_amount','product_amount','freight_amount','tax_amount','adjust_amount','currency_code']},
 returnDetails:{table:'hz_fop_return_line_details',fields:['source_order_entry_id','purchase_entry_id','requested_quantity','returned_quantity','requested_amount','refunded_amount','currency_code']},
}
function normalizeDocument(scope:ReplicaDatasetScope,value:unknown){
 const d=object(value,['eventId','entityCode','sourceId','sourceVersion','operation','documentNumber','linesComplete','relationsComplete','sourceFields','header','entries','relations','affectedOrders','workbench','packages','trackingNumbers','platformOrders'],'document') as unknown as ReplicaDomainDocument
 ref({entityCode:d.entityCode,sourceId:d.sourceId});version(d.sourceVersion,'sourceVersion');text(d.eventId,'eventId',128);text(d.documentNumber,'documentNumber',160)
 if(!['upsert','delete'].includes(d.operation)||d.linesComplete!==true||d.relationsComplete!==true)throw new Error('Incomplete domain document snapshot')
 const entries=list(d.entries,'entries'),relations=list(d.relations,'relations'),id=sourceEntityIdentity(scope,d.entityCode,d.sourceId),rows:ReplicaRow[]=[]
 if(d.sourceFields){object(d.sourceFields,['rawBillStatus','createdAt','modifiedAt','auditedAt','relationRevision'],'sourceFields');if(d.sourceFields.relationRevision!==undefined)version(d.sourceFields.relationRevision,'relationRevision',18)}
 unique(entries.map(e=>JSON.stringify([e.entryEntity,e.sourceEntryId])),'entries')
 if(d.operation==='delete'){
  if(entries.length||relations.length||d.header!==undefined||d.workbench!==undefined||[d.packages,d.trackingNumbers,d.platformOrders].some(x=>x?.length))throw new Error('Deleted domain snapshot cannot contain facts')
 }else{
  for(const [entity,key]of [['hzkj_orders','packages'],['hzkj_stock_order_new','packages'],['hzkj_deliver_bill','trackingNumbers'],['hzkj_purorderbill','platformOrders']] as const)if(d.entityCode===entity&&!Array.isArray(d[key]))throw new Error(`Entity ${entity} requires complete ${key}`)
  const specification=REPLICA_ENTITY_FIELDS[d.entityCode]
  const header=fields(d.header,specification.fields,'header')
  for(const column of ['stock_type','purchase_type','after_sale_type'])if(column in header&&header[column]===null)header[column]='unknown'
  rows.push(row(specification.table,{document_id:id,entity_code:d.entityCode,...header}))
  for(const entry of entries){
   object(entry,entryKeys,'entry');text(entry.entryEntity,'entryEntity',128);text(entry.sourceEntryId,'sourceEntryId',128)
   if(entry.sequence!==undefined&&(!Number.isSafeInteger(entry.sequence)||entry.sequence<0))throw new Error('Invalid domain entry sequence')
   const lineId=sourceLineIdentity(scope,{...d,entryEntity:entry.entryEntity,sourceEntryId:entry.sourceEntryId})
   const mapped=fields(Object.fromEntries(Object.entries(entry).filter(([k])=>!['entryEntity','sourceEntryId','sequence','inboundQuantity',...Object.keys(detailMaps)].includes(k))),Object.fromEntries(entryKeys.filter(k=>!['entryEntity','sourceEntryId','sequence','inboundQuantity',...Object.keys(detailMaps)].includes(k)).map(k=>[k,snake(k)])),'entry')
   rows.push(row('hz_fop_source_lines',{id:lineId,document_id:id,entry_entity:entry.entryEntity,source_entry_id:entry.sourceEntryId,sequence:entry.sequence??null,...mapped,source_version:d.sourceVersion,removed_at:null}))
   for(const [key,detail]of Object.entries(detailMaps))if(entry[key]!==undefined)rows.push(row(detail.table,{line_id:lineId,...fields(entry[key],Object.fromEntries(detail.fields.map(f=>[camel(f),f])),key)}))
  }
  unique(relations.map(r=>r.sourceRelationId),'relations')
  for(const relation of relations){
   object(relation,['sourceRelationId','relationType','from','to','allocatedQuantity','allocatedAmount','currencyCode'],'relation');text(relation.sourceRelationId,'sourceRelationId',128)
   if(!['demand_purchase','purchase_receipt','inbound','outbound','allocation','dispatch','delivery_notice','receipt','payment','rma','purchase_return','adjustment'].includes(relation.relationType))throw new Error('Invalid domain relation type')
   const from=ref(relation.from),to=ref(relation.to),fromLine='sourceEntryId'in from?sourceLineIdentity(scope,from):null,toLine='sourceEntryId'in to?sourceLineIdentity(scope,to):null
   rows.push(row('hz_fop_document_relations',{id:stable(scope,'relation',d.entityCode,d.sourceId,relation.sourceRelationId),holder_document_id:id,from_document_id:sourceEntityIdentity(scope,from.entityCode,from.sourceId),to_document_id:sourceEntityIdentity(scope,to.entityCode,to.sourceId),from_line_id:fromLine,to_line_id:toLine,relation_type:relation.relationType,source_relation_id:relation.sourceRelationId,allocated_quantity:relation.allocatedQuantity==null?null:decimal(relation.allocatedQuantity,'allocatedQuantity'),allocated_amount:relation.allocatedAmount==null?null:decimal(relation.allocatedAmount,'allocatedAmount'),currency_code:relation.currencyCode==null?null:text(relation.currencyCode,'relation currencyCode',3),source_version:d.sourceVersion,resolution_state:'resolved',relation_grain:fromLine?(toLine?'line_line':'line_document'):(toLine?'document_line':'document'),removed_at:null}))
  }
  normalizeCollections(scope,d,id,rows)
 }
 const affectedOrderIds=(d.affectedOrders??[]).map(r=>{const source=ref(r);if(!orderEntities.includes(source.entityCode))throw new Error('Invalid affected order');return sourceEntityIdentity(scope,source.entityCode,source.sourceId)})
 for(const relation of relations)for(const endpoint of [relation.from,relation.to])if(orderEntities.includes(endpoint.entityCode)){const affected=sourceEntityIdentity(scope,endpoint.entityCode,endpoint.sourceId);if(!affectedOrderIds.includes(affected))affectedOrderIds.push(affected)}
 for(const tracking of d.trackingNumbers??[])if(isRecord(tracking.package)){const source=ref(tracking.package.order);const affected=sourceEntityIdentity(scope,source.entityCode,source.sourceId);if(!affectedOrderIds.includes(affected))affectedOrderIds.push(affected)}
 if(orderEntities.includes(d.entityCode)&&!affectedOrderIds.includes(id))affectedOrderIds.push(id)
 return {document:d,event:{eventId:d.eventId,entityCode:d.entityCode,sourceId:d.sourceId,sourceVersion:d.sourceVersion,operation:d.operation,localDocumentId:id,documentNumber:d.documentNumber,linesComplete:true as const,rows,affectedOrderIds,sourceFields:d.sourceFields}}
}

function normalizeCollections(scope:ReplicaDatasetScope,d:ReplicaDomainDocument,id:string,rows:ReplicaRow[]){
 const packageId=(value:unknown)=>{const p=object(value,['order','sourcePackageKey'],'package reference'),order=ref(p.order);if(!orderEntities.includes(order.entityCode))throw new Error('Invalid package order');text(p.sourcePackageKey,'sourcePackageKey',128);return {id:stable(scope,'package',order.entityCode,order.sourceId,p.sourcePackageKey),orderId:sourceEntityIdentity(scope,order.entityCode,order.sourceId)}}
 if(d.packages!==undefined){
  if(!orderEntities.includes(d.entityCode))throw new Error('Packages belong to an order snapshot')
  unique(list(d.packages,'packages').map(p=>p.sourcePackageKey as string),'packages')
  for(const p of d.packages){
   object(p,['sourcePackageKey','packageNumber','warehouseId','providerId','channelId','expectedActive','trackingNumber','lines'],'package');text(p.sourcePackageKey,'sourcePackageKey',128)
   if(p.expectedActive!==null&&p.expectedActive!==undefined&&typeof p.expectedActive!=='boolean')throw new Error('Invalid package expectedActive')
   for(const key of ['packageNumber','warehouseId','providerId','channelId','trackingNumber'])if(p[key]!=null)text(p[key],key,200)
   const pid=stable(scope,'package',d.entityCode,d.sourceId,p.sourcePackageKey as string)
   rows.push(row('hz_fop_order_packages',{id:pid,order_document_id:id,source_package_key:p.sourcePackageKey,package_number:p.packageNumber??null,warehouse_id:p.warehouseId??null,provider_id:p.providerId??null,channel_id:p.channelId??null,expected_active:p.expectedActive??null,tracking_number:p.trackingNumber??null,source_version:d.sourceVersion,removed_at:null}))
   const lines=list(p.lines,'package lines');unique(lines.map(l=>JSON.stringify(l.line)),'package lines')
   for(const l of lines){object(l,['line','quantity'],'package line');const reference=ref(l.line);if(!('sourceEntryId'in reference)||reference.entityCode!==d.entityCode||reference.sourceId!==d.sourceId)throw new Error('Invalid package line owner');const lineId=sourceLineIdentity(scope,reference)
    rows.push(row('hz_fop_package_lines',{id:stable(scope,'package-line',pid,lineId),order_document_id:id,package_id:pid,order_line_id:lineId,quantity:decimal(l.quantity,'package quantity'),source_version:d.sourceVersion,removed_at:null}))
   }
  }
 }
 if(d.trackingNumbers!==undefined){
  if(d.entityCode!=='hzkj_deliver_bill')throw new Error('Tracking numbers require dispatch source')
  unique(list(d.trackingNumbers,'trackingNumbers').map(t=>t.sourceTrackingId as string),'tracking numbers')
  for(const t of d.trackingNumbers){
   object(t,['sourceTrackingId','trackingType','number','providerId','shopifySelected','package'],'tracking number');text(t.sourceTrackingId,'sourceTrackingId',128);text(t.number,'tracking number',200)
   if(!['full','first_mile','last_mile','unknown'].includes(t.trackingType as string)||t.shopifySelected!=null&&typeof t.shopifySelected!=='boolean')throw new Error('Invalid domain tracking facts')
   if(t.providerId!=null)text(t.providerId,'tracking providerId',128)
   const p=t.package==null?null:packageId(t.package)
   rows.push(row('hz_fop_tracking_numbers',{id:stable(scope,'tracking',d.entityCode,d.sourceId,t.sourceTrackingId as string),dispatch_document_id:id,package_id:p?.id??null,tracking_type:t.trackingType,number:t.number,provider_id:t.providerId??null,shopify_selected:t.shopifySelected??null,source_version:d.sourceVersion,removed_at:null}))
   if(p&&!rows.some(r=>r.table==='hz_fop_document_packages'&&r.values.document_id===id&&r.values.package_id===p.id))rows.push(row('hz_fop_document_packages',{id:stable(scope,'document-package',id,p.id),document_id:id,order_document_id:p.orderId,package_id:p.id,relation_role:'dispatch',source_link_id:t.sourceTrackingId,source_version:d.sourceVersion,removed_at:null}))
  }
 }
 if(d.platformOrders!==undefined){
  if(d.entityCode!=='hzkj_purorderbill')throw new Error('Platform orders require purchase source')
  unique(list(d.platformOrders,'platformOrders').map(p=>p.sourcePlatformOrderId as string),'platform orders')
  for(const p of d.platformOrders){
   object(p,['sourcePlatformOrderId','platformCode','purchasingAccountId','externalOrderId','externalSuborderId','rawStatus','paidAt','shippedAt','paidAmount','currencyCode'],'platform order');text(p.sourcePlatformOrderId,'sourcePlatformOrderId',128)
   const map=Object.fromEntries(['platform_code','purchasing_account_id','external_order_id','external_suborder_id','raw_status','paid_at','shipped_at','paid_amount','currency_code'].map(f=>[camel(f),f]))
   rows.push(row('hz_fop_platform_orders',{id:stable(scope,'platform-order',d.entityCode,d.sourceId,p.sourcePlatformOrderId as string),purchase_document_id:id,...fields(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='sourcePlatformOrderId')),map,'platform order'),removed_at:null}))
  }
 }
}
const stateOptions:Record<string,string[]>={
 customerPaymentState:['unpaid','paid','refunded','unknown'],purchaseApplicationState:['not_created','partial','created','not_required','unknown'],purchaseCoverageState:['not_ordered','partial','ordered','cancelled','not_required','unknown'],platformOrderState:['not_pushed','partial','pushed','not_required','unknown'],supplierPaymentState:['unpaid','partial','paid','refunded','not_required','unknown'],supplierShipmentState:['pending','partial','shipped','not_required','unknown'],stockReadinessState:['incomplete','ready','unknown'],allocationReviewState:['pending','approved','unknown'],shopifySyncState:['pending','synced','not_required','unknown'],dispatchTaskState:['dispatch_missing','dispatch_draft','dispatch_submitted','dispatch_approved','dispatch_synced','unknown'],outboundState:['pending','completed','unknown'],shipmentState:['pending','shipped','unknown'],
}
const workbenchKeys=[...Object.keys(stateOptions),'ownerEmployeeIds','ownershipVerifiedAt','ownershipVersion','customerName','warehouseName','storeName','currentCustomerOwnerId','cancelled','allocationCreated','interceptStatus','stockLifecycle','recipientSnapshot','carrierName','procurementCompletedAt','allocationApprovedAt','dispatchApprovedAt','outboundCompletedAt','procurementDemands','purchaseAllocations','relatedDocuments']
function workbench(input:unknown):Record<string,any>{
 const w=object(input??{},workbenchKeys,'workbench')
 for(const [k,opts] of Object.entries(stateOptions))if(w[k]!=null&&!opts.includes(w[k]))throw new Error(`Invalid domain ${k}`)
 for(const k of ['cancelled','allocationCreated'])if(w[k]!=null&&typeof w[k]!=='boolean')throw new Error(`Invalid domain ${k}`)
 for(const k of ['ownershipVerifiedAt','procurementCompletedAt','allocationApprovedAt','dispatchApprovedAt','outboundCompletedAt'])if(w[k]!=null)timestamp(w[k],k)
 if(w.ownerEmployeeIds!==undefined){list(w.ownerEmployeeIds,'ownerEmployeeIds').forEach(id=>text(id,'ownerEmployeeId',128));unique(w.ownerEmployeeIds,'owners')}
 if(w.ownershipVersion!=null)text(w.ownershipVersion,'ownershipVersion',160)
 for(const key of ['customerName','warehouseName','storeName','currentCustomerOwnerId','stockLifecycle','carrierName'])if(w[key]!=null)text(w[key],key)
 if(w.recipientSnapshot!=null){const recipient=object(w.recipientSnapshot,['name','phone','email','countryCode','state','city','postalCode','addressLine1','addressLine2'],'recipient');for(const [key,value]of Object.entries(recipient))if(value!=null)text(value,`recipient.${key}`)}
 if(w.interceptStatus!=null&&!['intercepted','released'].includes(w.interceptStatus))throw new Error('Invalid domain interceptStatus')
 return w
}
const exactDecimal=Decimal.clone({precision:50})
function receiptProjection(scope:ReplicaDatasetScope,d:ReplicaDomainDocument){
 const id=sourceEntityIdentity(scope,d.entityCode,d.sourceId)
 if(d.operation==='delete')return {documentId:id,deleted:true,rows:[]}
 const w=workbench(d.workbench)
 if(!w.ownerEmployeeIds?.length||!w.ownershipVerifiedAt||!w.ownershipVersion)throw new Error('Receipt notice current ownership facts missing')
 if(!d.entries.length)throw new Error('Receipt notice entries missing')
 let quantity=new exactDecimal(0),inbound=new exactDecimal(0)
 const lines=d.entries.map(e=>{
  const q=decimal(e.quantity,'receipt quantity'),received=decimal(e.inboundQuantity,'receipt inboundQuantity')
  if(new exactDecimal(q).lte(0)||new exactDecimal(received).lt(0)||new exactDecimal(received).gt(q))throw new Error('Invalid receipt inboundQuantity')
  quantity=quantity.plus(q);inbound=inbound.plus(received)
  return {id:sourceLineIdentity(scope,{...d,entryEntity:e.entryEntity,sourceEntryId:e.sourceEntryId}),sku:e.skuCode??null,name:e.productName??null,variant:e.variant??null,imageUrl:e.imageUrl??null,quantity:q,inboundQuantity:received}
 })
 return {documentId:id,deleted:false,rows:[row('hz_fop_workbench_receipt_notices',{document_id:id,source_version:d.sourceVersion,owner_employee_ids:w.ownerEmployeeIds,ownership_verified_at:w.ownershipVerifiedAt,shipment_state:w.shipmentState??'unknown',carrier_name:w.carrierName??null,quantity:quantity.toFixed(),inbound_quantity:inbound.toFixed(),lines})]}
}
const queues=['unpaid','review','stock','rma','exceptions','sales_completed','dispatch','dispatch_completed','procurement','procurement_shipping','stock_procurement','procurement_completed','allocation','allocation_review','allocation_completed','shipping','warehouse_completed','purchase_returns']
function orderProjection(scope:ReplicaDatasetScope,d:ReplicaDomainDocument,dependencies:ReplicaDomainDependency[]){
 const id=sourceEntityIdentity(scope,d.entityCode,d.sourceId)
 if(!orderEntities.includes(d.entityCode))throw new Error('Order projection requires order domain snapshot')
 if(d.operation==='delete')return {orderDocumentId:id,deleted:true,rows:[]}
 const h=d.header!,w=workbench(d.workbench),isStock=d.entityCode==='hzkj_stock_order_new'
 const states=Object.fromEntries(Object.keys(stateOptions).filter(k=>k!=='shipmentState').map(k=>[snake(k),w[k]??'unknown']))
 const review=d.sourceFields?.rawBillStatus==='C'?'approved':['A','B'].includes(d.sourceFields?.rawBillStatus??'')?'pending':'unknown'
 // Outbound is a native HEADER fact. A partial header is actionable; it is not a completed outbound.
 if(!isStock)states.outbound_state=['0','1'].includes(h.rawDeliveryStatus as string)?'pending':h.rawDeliveryStatus==='2'?'completed':'unknown'
 const purchase={purchaseApplication:states.purchase_application_state,purchaseOrder:states.purchase_coverage_state,alibabaOrder:states.platform_order_state,supplierPayment:states.supplier_payment_state}
 const stage=getProcurementStage(purchase as any,states.supplier_shipment_state as any)
 let quantity=new exactDecimal(0),quantitiesKnown=true
 for(const entry of d.entries){if(entry.quantity==null)quantitiesKnown=false;else quantity=quantity.plus(decimal(entry.quantity,'quantity'))}
 const sourceOwner=h.ownerEmployeeId??null
 if(w.ownerEmployeeIds?.length===1&&sourceOwner!=null&&w.ownerEmployeeIds[0]!==sourceOwner)throw new Error('Order ownership facts conflict')
 const requiredStates=isStock?['customer_payment_state','purchase_coverage_state','platform_order_state','supplier_payment_state','supplier_shipment_state']:Object.keys(states)
 const missing=[...Object.entries(states).filter(([k,v])=>requiredStates.includes(k)&&v==='unknown').map(([k])=>k),...(!quantitiesKnown||!d.entries.length?['entry_quantities']:[]),...(d.entries.some(e=>!e.skuCode)?['entry_sku']:[]),...(!h.totalAmount?['total_amount']:[]),...(!h.settlementCurrency?['settlement_currency']:[]),...(!sourceOwner||!w.ownerEmployeeIds?.includes(sourceOwner)||!w.ownershipVersion||!w.ownershipVerifiedAt?['current_ownership']:[]),...(w.cancelled==null?['cancelled']:[]),...(review==='unknown'?['review']:[]),...(!isStock&&w.allocationCreated==null?['allocation_created']:[]),...(isStock&&!['full_payment','deposit'].includes(h.stockType as string)?['stock_type']:[]),...(isStock&&!h.businessCreatedAt?['business_created_at']:[])]
 if(w.purchaseAllocations?.some((a:Record<string,any>)=>a.purchaseSourceVersion==null||a.purchaseRelationRevision==null))missing.push('purchase_dependency_versions')
 const ready=missing.length===0
 const relatedDocuments:ReplicaDomainDependency[]=[]
 if(w.relatedDocuments!==undefined)for(const dep of list(w.relatedDocuments,'relatedDocuments')){object(dep,['entityCode','sourceId','sourceVersion','relationRevision'],'related document');ref({entityCode:dep.entityCode,sourceId:dep.sourceId});version(dep.sourceVersion,'related sourceVersion');version(dep.relationRevision,'related relationRevision',18);relatedDocuments.push(dep)}
 const ownDependency:ReplicaDomainDependency={entityCode:d.entityCode,sourceId:d.sourceId,sourceVersion:d.sourceVersion,relationRevision:d.sourceFields?.relationRevision??'0'}
 const deps=[ownDependency,...[...dependencies,...relatedDocuments].filter(dep=>dep.entityCode!==d.entityCode||dep.sourceId!==d.sourceId)]
 for(let i=deps.length-1;i>0;i--){const first=deps.findIndex(dep=>dep.entityCode===deps[i].entityCode&&dep.sourceId===deps[i].sourceId);if(first<i){if(deps[first].sourceVersion!==deps[i].sourceVersion||deps[first].relationRevision!==deps[i].relationRevision)throw new Error('Conflicting dependency versions');deps.splice(i,1)}}
 for(const dep of deps){object(dep,['entityCode','sourceId','sourceVersion','relationRevision'],'dependency');ref({entityCode:dep.entityCode,sourceId:dep.sourceId});version(dep.sourceVersion,'dependency sourceVersion');version(dep.relationRevision,'dependency relationRevision',18)}
 const procurementRows=procurementProjections(scope,d,w,deps)
 const rows:ReplicaRow[]=[row('hz_fop_workbench_orders',{
 document_id:id,order_kind:isStock?'stock':'fulfillment',order_number:d.documentNumber,shopify_order_number:h.shopifyOrderNumber??null,customer_id:h.customerId??null,customer_name:w.customerName??null,current_customer_owner_id:w.currentCustomerOwnerId??null,owner_employee_id:sourceOwner,warehouse_id:h.warehouseId??null,warehouse_name:w.warehouseName??null,store_name:w.storeName??null,country_code:h.countryCode??null,
 customer_paid_at:h.customerPaidAt??null,consumer_paid_at:h.customerPaidAt??null,business_created_at:isStock?h.businessCreatedAt??null:d.sourceFields?.createdAt??null,total_amount:h.totalAmount??null,product_amount:h.productAmount??null,freight_amount:h.freightAmount??null,tax_amount:h.taxAmount??null,discount_amount:h.discountAmount??null,currency_code:h.settlementCurrency??null,item_count:d.entries.length,total_quantity:quantitiesKnown?quantity.toFixed():null,
 ...states,order_review_state:review,procurement_stage:stage,recipient_snapshot:w.recipientSnapshot??null,stock_type:h.stockType??null,stock_lifecycle:w.stockLifecycle??null,intercept_status:w.interceptStatus??null,cancelled:w.cancelled??null,allocation_created:w.allocationCreated??null,ownership_verified_at:w.ownershipVerifiedAt??null,ownership_version:w.ownershipVersion??null,readiness:ready?'ready':'incomplete',stage_evidence:{missingFields:missing},dependency_vector:Object.fromEntries(deps.map(dep=>[sourceEntityIdentity(scope,dep.entityCode,dep.sourceId),dep.sourceVersion])),mapping_version:1,rule_version:1,
 })]
 for(const entry of d.entries){if(!entry.skuCode)continue;const lineId=sourceLineIdentity(scope,{...d,entryEntity:entry.entryEntity,sourceEntryId:entry.sourceEntryId});rows.push(row('hz_fop_workbench_order_lines',{id:stable(scope,'display-line',lineId),order_document_id:id,source_line_id:lineId,sku_code:entry.skuCode??null,product_name:entry.productName??null,variant:entry.variant??null,image_url:entry.imageUrl??null,quantity:entry.quantity??null,display_role:'product',sequence:entry.sequence??null}))}
 const order={cancelled:w.cancelled,paymentStatus:states.customer_payment_state,reviewStatus:review,sourcePurchaseStatus:h.rawPurchaseStatus??null,procurementProgress:purchase,fulfillmentProgress:{allocationCreated:w.allocationCreated,shopifySync:states.shopify_sync_state,supplierShipment:states.supplier_shipment_state,stockReadiness:states.stock_readiness_state,allocationReview:states.allocation_review_state,outbound:h.rawDeliveryStatus==='1'?'partial':states.outbound_state}} as unknown as FopOrder
 for(const queue of queues){
  let member=false,known=ready
  if(isStock){member=queue==='stock'||queue==='stock_procurement'&&['0','1','2'].includes(h.rawPurchaseStatus as string);if(!['stock','stock_procurement'].includes(queue))known=true}
  else if(queue==='sales_completed'){known=review!=='unknown';member=review==='approved'}
  else if(queue==='dispatch_completed')member=states.dispatch_task_state==='dispatch_synced'
  else if(queue==='procurement_completed')member=['3','4'].includes(h.rawPurchaseStatus as string)&&states.purchase_coverage_state!=='not_required'
  else if(queue==='allocation_completed')member=states.allocation_review_state==='approved'
  else if(queue==='warehouse_completed')member=h.rawDeliveryStatus==='2'
  else if(['stock','stock_procurement'].includes(queue))known=true
  else if(queue==='rma'){known=w.relatedDocuments!==undefined;member=relatedDocuments.some(dep=>dep.entityCode==='hzkj_after_sale_orders')}
  else if(queue==='purchase_returns'){known=false}
  else if(queue==='exceptions'){known=false}
  else member=matchesQueue(order,queue as Queue)&&(queue!=='shipping'||w.interceptStatus!=='intercepted')
  const phase=queue==='procurement_completed'?w.procurementCompletedAt:queue==='allocation_completed'?w.allocationApprovedAt:queue==='warehouse_completed'?w.outboundCompletedAt:queue==='dispatch_completed'?w.dispatchApprovedAt:null
  rows.push(row('hz_fop_workbench_memberships',{id:stable(scope,'membership',id,queue),order_document_id:id,queue_code:queue,classification_state:known?(member?'member':'non_member'):'unknown',phase_completed_at:phase??null,unknown_reason_code:known?null:'domain_facts_not_provided',reason_codes:known?[]:['domain_facts_not_provided'],rule_version:1}))
 }
 rows.push(...procurementRows)
 for(const dep of deps){const sid=sourceEntityIdentity(scope,dep.entityCode,dep.sourceId);rows.push(row('hz_fop_projection_dependencies',{id:stable(scope,'dependency',id,sid),order_document_id:id,source_document_id:sid,source_version:dep.sourceVersion,relation_revision:dep.relationRevision}))}
 return {orderDocumentId:id,deleted:false,rows}
}

/** Converts the authenticated service feed into INTERNAL rows; unrecognized facts fail closed. */
export function normalizeReplicaGroup(scope:ReplicaDatasetScope,input:unknown):ReplicaChangeGroup {
 for(const [k,v]of Object.entries(scope))if(!['connectionId','companyId','datasetId'].includes(k)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw new Error('Invalid domain scope')
 if(!scope.connectionId||!scope.companyId||!scope.datasetId)throw new Error('Invalid domain scope')
 const g=object(input,['schemaVersion','groupKey','afterCursor','endCursor','committedAt','expectedCount','documents','orderProjections'],'group') as unknown as ReplicaDomainGroup
 if(!Array.isArray(g.documents)||!Number.isInteger(g.expectedCount)||g.expectedCount<1||g.expectedCount>1000||g.documents.length!==g.expectedCount)throw new Error('Invalid commit manifest')
 if(g.schemaVersion!==REPLICA_DOMAIN_VERSION)throw new Error('Unsupported domain schema version')
 const documents=list(g.documents,'documents').map(d=>normalizeDocument(scope,d))
 const projections:ReplicaChangeGroup['projections']=[],receiptNotices:NonNullable<ReplicaChangeGroup['receiptNotices']>=[]
 for(const {document:d}of documents){
  if(orderEntities.includes(d.entityCode))projections.push(orderProjection(scope,d,[]))
  if(d.entityCode==='hzkj_receiptnotice')receiptNotices.push(receiptProjection(scope,d))
 }
 for(const item of g.orderProjections??[]){
  object(item,['order','dependencies'],'order projection');const normalized=normalizeDocument(scope,item.order)
  const existing=documents.find(d=>d.event.localDocumentId===normalized.event.localDocumentId)
  if(existing)throw new Error('Order projection duplicated by commit member')
  projections.push(orderProjection(scope,normalized.document,list(item.dependencies,'dependencies')))
 }
 // A changed order can depend on other commit members as well; include exact versions locally.
 for(const projection of projections){if(projection.deleted)continue
  const own=documents.find(d=>d.event.localDocumentId===projection.orderDocumentId)
  if(!own)continue
  const related=documents.filter(d=>d.event.localDocumentId!==projection.orderDocumentId&&d.event.affectedOrderIds.includes(projection.orderDocumentId))
  for(const {event}of related){const sid=event.localDocumentId;projection.rows.push(row('hz_fop_projection_dependencies',{id:stable(scope,'dependency',projection.orderDocumentId,sid),order_document_id:projection.orderDocumentId,source_document_id:sid,source_version:event.sourceVersion,relation_revision:event.sourceFields?.relationRevision??'0'}))}
 }
 return validateChangeGroup({groupKey:g.groupKey,afterCursor:g.afterCursor,endCursor:g.endCursor,committedAt:g.committedAt,expectedCount:g.expectedCount,events:documents.map(d=>d.event),projections,receiptNotices})
}

/** Quantities come from explicit domain facts. No equal-share or unknown-as-zero allocation. */
function procurementProjections(scope:ReplicaDatasetScope,d:ReplicaDomainDocument,w:Record<string,any>,dependencies:ReplicaDomainDependency[]):ReplicaRow[]{
 const rows:ReplicaRow[]=[],orderId=sourceEntityIdentity(scope,d.entityCode,d.sourceId)
 const line=(value:unknown)=>{const l=ref(value);if(!('sourceEntryId'in l)||l.entityCode!==d.entityCode||l.sourceId!==d.sourceId||!d.entries.some(e=>e.entryEntity===l.entryEntity&&e.sourceEntryId===l.sourceEntryId))throw new Error('Invalid procurement order line');return sourceLineIdentity(scope,l)}
 const quantities=(v:Record<string,any>,names:string[])=>Object.fromEntries(names.map(k=>[snake(k),v[k]==null?null:decimal(v[k],k)]))
 for(const demand of w.procurementDemands===undefined?[]:list(w.procurementDemands,'procurementDemands')){
  const keys=['effectiveOrderQuantity','stockCoveredQuantity','requiredQuantity','allocatedQuantity','unassignedQuantity'];object(demand,['line',...keys,'unitCode'],'procurement demand')
  const lid=line(demand.line),known=keys.every(k=>demand[k]!=null),v=quantities(demand,keys)
  if(known&&keys.some(k=>new exactDecimal(demand[k]).lt(0)))throw new Error('Negative procurement demand')
  if(known&&(!new exactDecimal(demand.effectiveOrderQuantity).minus(demand.stockCoveredQuantity).equals(demand.requiredQuantity)||!new exactDecimal(demand.requiredQuantity).minus(demand.allocatedQuantity).equals(demand.unassignedQuantity)))throw new Error('Conflicting procurement quantities')
  rows.push(row('hz_fop_workbench_procurement_demands',{id:stable(scope,'procurement-demand',lid),order_document_id:orderId,order_line_id:lid,...v,unit_code:demand.unitCode??null,calculation_state:known?'known':'unknown',reason_code:known?null:'domain_quantities_not_provided'}))
 }
 unique(rows.map(r=>r.values.id as string),'procurement demands')
 const allocationIds:string[]=[]
 for(const allocation of w.purchaseAllocations===undefined?[]:list(w.purchaseAllocations,'purchaseAllocations')){
  const keys=['allocatedRequirementQuantity','purchasedQuantity','supplierShippedQuantity','inboundQuantity','allocatedAmount','cancelledQuantity','returnedQuantity','remainingSupplyQuantity'];object(allocation,['sourceAllocationId','line','purchaseLine','purchaseSourceVersion','purchaseRelationRevision',...keys,'currencyCode'],'purchase allocation')
  text(allocation.sourceAllocationId,'sourceAllocationId',128);const lid=line(allocation.line),purchase=ref(allocation.purchaseLine)
  if(purchase.entityCode!=='hzkj_purorderbill'||!('sourceEntryId'in purchase))throw new Error('Invalid purchase line')
  const known=keys.filter(k=>k!=='allocatedAmount').every(k=>allocation[k]!=null),v=quantities(allocation,keys)
  const pid=stable(scope,'purchase-allocation',orderId,allocation.sourceAllocationId);allocationIds.push(pid)
  rows.push(row('hz_fop_workbench_purchase_allocations',{id:pid,order_document_id:orderId,order_line_id:lid,purchase_document_id:sourceEntityIdentity(scope,purchase.entityCode,purchase.sourceId),purchase_line_id:sourceLineIdentity(scope,purchase),...v,currency_code:allocation.currencyCode??null,allocation_state:known?'known':'unknown'}))
  if(allocation.purchaseSourceVersion!==undefined){version(allocation.purchaseSourceVersion,'purchaseSourceVersion');version(allocation.purchaseRelationRevision,'purchaseRelationRevision',18)
   const existing=dependencies.find(dep=>dep.entityCode===purchase.entityCode&&dep.sourceId===purchase.sourceId)
   if(existing&&(existing.sourceVersion!==allocation.purchaseSourceVersion||existing.relationRevision!==allocation.purchaseRelationRevision))throw new Error('Conflicting purchase dependency versions')
   if(!existing)dependencies.push({entityCode:purchase.entityCode,sourceId:purchase.sourceId,sourceVersion:allocation.purchaseSourceVersion,relationRevision:allocation.purchaseRelationRevision})
  }
 }
 unique(allocationIds,'purchase allocations')
 return rows
}
