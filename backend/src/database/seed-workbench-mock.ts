import { populateMockPurchaseEntries } from './mock-purchase-entries'
import { populateMockReceiptNotices } from './mock-receipt-notices'
import { populateMockLogistics } from './mock-logistics'
import { createHash } from 'node:crypto'
import { DataSource, EntityManager } from 'typeorm'
import { WORKBENCH_TABLE_COLUMNS } from './workbench-schema'
import { assertMockDatabase, MOCK_CREDENTIAL } from '../modules/workbench-replica/workbench-mock'
import { isStageCompleted } from '../modules/fop-data/completed-orders'
import { matchesQueue } from '../modules/fop-data/workbench-queue-rules'
import { getProcurementStage } from '../modules/fop-data/procurement-stage'
import { FopOrder } from '../modules/fop-data/fop-data.types'

const uuid = (key: string) => { const hex = createHash('sha256').update(`hz-schema-mock-v1:${key}`).digest('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}` }
const DAY = 86_400_000
const QUEUES = ['unpaid','review','exceptions','dispatch','procurement','procurement_shipping','allocation','allocation_review','shipping','sales_completed','dispatch_completed','procurement_completed','allocation_completed','warehouse_completed','rma','purchase_returns']
const image = (color: string, shape: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="16" fill="#eef4f8"/><g fill="${color}">${shape}</g></svg>`)}`
const PRODUCTS = [
  {sku:'HZ-BAG-001',name:'Everyday commuter backpack',variant:'Slate blue / 20L',price:48.9,image:image('#627fa8','<rect x="28" y="22" width="40" height="56" rx="12"/><path d="M38 25V14h20v11" fill="none" stroke="#627fa8" stroke-width="5"/>')},
  {sku:'HZ-LAMP-002',name:'Rechargeable desk lamp',variant:'Warm ivory / USB-C',price:32.5,image:image('#d3b588','<path d="M22 49l15-29h22l15 29z"/><path d="M48 49v27M29 77h38" fill="none" stroke="#7d8da1" stroke-width="5"/>')},
]
async function insert(m: EntityManager, table: string, values: Record<string, unknown>): Promise<void> {
  const keys=Object.keys(values)
  if(!WORKBENCH_TABLE_COLUMNS[table] || keys.some(key=>!WORKBENCH_TABLE_COLUMNS[table].includes(key))) throw new Error(`Unknown fixture column in ${table}`)
  await m.query(`INSERT INTO "${table}"(${keys.map(key=>`"${key}"`).join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(key=>values[key] !== null && typeof values[key]==='object' ? JSON.stringify(values[key]) : values[key]))
}

/** Explicitly resettable synthetic data in the SAME physical schema as Scheme A. No FOP network access. */
export async function seedWorkbenchMock(db: DataSource, now = new Date()): Promise<{ fulfillment: number; stock: number }> {
  assertMockDatabase(db)
  return db.transaction(async m=>{
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['schema-mock-write'])
    const existing=await m.query('SELECT id FROM hz_fop_connections')
    // Reset only this disposable database. Accounts/organization are never truncated.
    if(existing.length) await m.query(`TRUNCATE ${Object.keys(WORKBENCH_TABLE_COLUMNS).map(table=>`"${table}"`).join(',')} CASCADE`)
    const [admin]=await m.query("SELECT id,organization_workspace_owner_id FROM users WHERE lower(email)='admin@hzdrop.com' AND role='admin'")
    if(!admin)throw new Error('Local administrator is required before mock seeding')
    const owner=admin.organization_workspace_owner_id??admin.id
    const employees=await m.query(`SELECT e.*,u.business_role,u.workbench_roles FROM organization_employees e JOIN users u ON u.id=e.account_id WHERE e.owner_user_id=$1 AND e.archived_at IS NULL AND NOT u.account_disabled AND lower(e.email)<>'ruth@hzdrop.com' ORDER BY lower(e.email),e.id`,[owner])
    const connection=uuid('connection'),company=uuid('company'),dataset=uuid('dataset'),stamp=now.toISOString()
    await insert(m,'hz_fop_connections',{id:connection,workspace_owner_id:owner,name:'本地模拟业务',environment:'test',tenant_id:'local-mock',base_url:'https://mock.invalid',credential_ref:MOCK_CREDENTIAL,status:'active',capabilities:{source:'mock',schemaBacked:true}})
    await insert(m,'hz_fop_companies',{id:company,connection_id:connection,source_company_id:'100000',company_number:'mock',name:'华智云服 · 模拟',enabled:true,verified_at:stamp,expires_at:new Date(now.getTime()+3600000).toISOString()})
    const scope={connection_id:connection,company_id:company,dataset_id:dataset}
    await insert(m,'hz_fop_datasets',{id:dataset,connection_id:connection,company_id:company,state:'active',validated_at:stamp,activated_at:stamp,applied_watermarks:{_local:{projectionRevision:'1'},mock:{generatedAt:stamp}}})
    await m.query('UPDATE hz_fop_companies SET active_dataset_id=$1 WHERE id=$2',[dataset,company])
    for(const resource of ['orders','stock_orders','purchases','rma','purchase_returns','stock_inventory','allocation_inventory','contacts'])await insert(m,'hz_fop_resource_grants',{id:uuid(resource),connection_id:connection,company_id:company,resource_type:resource,target_key:'*',decision:'allow',verified_at:stamp,source_as_of:stamp,expires_at:new Date(now.getTime()+3600000).toISOString(),evidence:{source:'mock'}})
    const reference=async(resource:string,id:string,code:string,name:string)=>insert(m,'hz_fop_reference_items',{id:uuid(`ref:${resource}:${id}`),connection_id:connection,company_id:company,resource_type:resource,source_id:id,code,name})
    await reference('warehouse','mock-HZ','HZ','杭州仓');await reference('warehouse','mock-SZ','SZ','深圳仓')
    await reference('supplier','mock-supplier','MOCK-S1','深圳智选供应商')
    for(const [i,e]of employees.entries())await insert(m,'hz_fop_employee_bindings',{id:uuid(`binding:${e.account_id}`),connection_id:connection,local_account_id:e.account_id,person_record_id:String(880000000000000000n+BigInt(i)),employee_master_id:String(890000000000000000n+BigInt(i)),employee_number:`MOCK-${String(i+1).padStart(4,'0')}`,username:e.email.split('@')[0],display_name:e.name,state:'directory_verified',enabled:true,directory_verified_at:stamp,evidence:{source:'mock',localEmployeeId:e.id}})
    const sellers=employees.filter((e:Record<string,any>)=>['salesperson','department_manager'].includes(e.business_role))
    if(!sellers.length)throw new Error('Sales employees are required for role isolation tests')
    let fulfillment=0,stock=0
    const at=(days:number)=>new Date(now.getTime()-days*DAY).toISOString()
    const doc=async(key:string,entity:string,number:string,source:string,status='C')=>{const id=uuid(key);await insert(m,'hz_fop_source_documents',{id,...scope,entity_code:entity,source_id:source,document_number:number,source_version:'1',raw_bill_status:status,source_created_at:at(4),source_modified_at:stamp,source_audited_at:status==='C'?at(1):null,validation_state:'verified',payload:{source:'mock',scenario:key}});return id}
    const line=async(id:string,index:number,quantity=2)=>{const p=PRODUCTS[index],lid=uuid(`${id}:line:${index}`);await insert(m,'hz_fop_source_lines',{id:lid,...scope,document_id:id,entry_entity:'entry',source_entry_id:`${index+1}`,sequence:index+1,sku_code:p.sku,product_name:p.name,variant:p.variant,image_url:p.image,quantity,unit_price:p.price,line_amount:p.price*quantity,currency_code:'USD',source_version:'1'});return lid}
    const members=async(id:string,active:Set<string>,completedAt=at(1))=>{for(const q of QUEUES)await insert(m,'hz_fop_workbench_memberships',{id:uuid(`${id}:${q}`),...scope,order_document_id:id,queue_code:q,classification_state:active.has(q)?'member':'non_member',phase_completed_at:q.endsWith('_completed')&&active.has(q)?completedAt:null,projection_revision:1,rule_version:1,published_at:stamp})}
    for(const seller of sellers){
      const ei=employees.indexOf(seller),employee=String(890000000000000000n+BigInt(ei)),customer=`mock-customer-${ei}`,warehouse=ei%2?'SZ':'HZ'
      for(let s=0;s<14;s++){
        const source=String(790000000000000000n+BigInt(ei*100+s)),number=`TO${now.toISOString().slice(0,10).replace(/-/g,'')}${String(ei*100+s).padStart(5,'0')}`
        const id=await doc(`order:${ei}:${s}`,'hzkj_orders',number,source,s<2?'B':'C'),paid=s!==0,age=(s===8?2:[1,3,14,45,100][s%5])+ei%3/4
        const purchase={purchaseApplication:'created',purchaseOrder:s<=2?'not_ordered':'ordered',alibabaOrder:s<=3?'not_pushed':'pushed',supplierPayment:s<=2?'not_required':s===3||s===13?'unpaid':s===10?'refunded':'paid'}
        const progress={allocationCreated:s>=5,shopifySync:s===8||s===12?'synced':'pending',supplierShipment:s===4?'partial':s===11||s<4?'pending':'shipped',stockReadiness:s>=6?'ready':'incomplete',allocationReview:s>=7?'approved':'pending',outbound:s===8||s===12?'completed':'pending'}
        const exception=s===9?{type:'procurement_exception',reason:'质量问题，已申请退货',hours:12}:s===10?{type:'allocation_exception',reason:'等待缺货商品到仓',hours:30}:null
        const cancelled=s===12
        const normalized={cancelled,paymentStatus:paid?'paid':'unpaid',reviewStatus:s<2?'pending':'approved',procurementProgress:purchase,fulfillmentProgress:progress,exception} as unknown as FopOrder
        const active=new Set(QUEUES.filter(q=>!q.endsWith('_completed')&&!['rma','purchase_returns'].includes(q)&&matchesQueue(normalized,q as any)))
        for(const [queue,code]of Object.entries({review:'sales_completed',dispatch:'dispatch_completed',procurement:'procurement_completed',allocation_review:'allocation_completed',shipping:'warehouse_completed'}))if(isStageCompleted(normalized,queue))active.add(code)
        if(s===9){active.add('rma');active.add('purchase_returns')}
        const base={...scope,document_id:id,order_kind:'fulfillment',order_number:number,owner_employee_id:employee,customer_id:customer,customer_name:['Olivia Martin','Noah Williams','Emma Thompson'][ei%3],store_name:['Northstar Living','Urban Trail'][ei%2],warehouse_id:`mock-${warehouse}`,warehouse_name:warehouse==='HZ'?'杭州仓':'深圳仓',shopify_order_number:`#${String(510000+ei*100+s)}`,country_code:['US','GB','DE','AU'][(s+ei)%4],recipient_snapshot:{name:'Oliver Bennett',phone:'+1 202 555 0123',email:'recipient@example.com',countryCode:['US','GB','DE','AU'][(s+ei)%4],state:'California',city:'Los Angeles',postalCode:'90001',addressLine1:'24 Market Street',addressLine2:'Apartment 2'},business_created_at:at(age+1),customer_paid_at:paid?at(age):null,product_amount:162.8,freight_amount:8,tax_amount:2.2,discount_amount:3,total_amount:170,currency_code:'USD',total_quantity:4,item_count:2,customer_payment_state:paid?'paid':'unpaid',order_review_state:s<2?'pending':'approved',purchase_application_state:purchase.purchaseApplication,purchase_coverage_state:purchase.purchaseOrder,platform_order_state:purchase.alibabaOrder,supplier_payment_state:purchase.supplierPayment,supplier_shipment_state:progress.supplierShipment,stock_readiness_state:progress.stockReadiness,allocation_review_state:progress.allocationReview,outbound_state:progress.outbound,shopify_sync_state:progress.shopifySync,allocation_created:progress.allocationCreated,dispatch_task_state:s%3===0?'dispatch_submitted':'dispatch_approved',intercept_status:s===9?'intercepted':s===7?'released':null,cancelled,procurement_stage:getProcurementStage(purchase as any,progress.supplierShipment as any),readiness:'ready',projection_revision:1,rule_version:1,published_at:stamp,ownership_verified_at:stamp,ownership_version:'mock-1'}
        await insert(m,'hz_fop_fulfillment_orders',{document_id:id,company_id:company,dataset_id:dataset,entity_code:'hzkj_orders',customer_id:customer,owner_employee_id:employee,warehouse_id:`mock-${warehouse}`,custom_channel_id:'mock-custom-standard',custom_channel_name:'Standard Shipping',raw_purchase_status:purchase.purchaseOrder==='not_ordered'?'0':purchase.supplierPayment==='refunded'||purchase.supplierPayment==='unpaid'?'2':progress.supplierShipment==='partial'?'1':progress.stockReadiness==='ready'?'3':progress.supplierShipment==='shipped'?'4':'2',raw_delivery_status:progress.outbound==='completed'?'2':'0',raw_order_status:cancelled?'cancelled':'paid',raw_payment_status:paid?'paid':'unpaid',customer_paid_at:base.customer_paid_at,settlement_currency:'USD',shopify_order_number:base.shopify_order_number,product_amount:162.8,freight_amount:8,tax_amount:2.2,discount_amount:3,total_amount:170})
        await insert(m,'hz_fop_workbench_orders',base)
        const lines=[]
        for(let p=0;p<2;p++){const lid=await line(id,p);lines.push(lid);await insert(m,'hz_fop_workbench_order_lines',{id:uuid(`display:${lid}`),...scope,order_document_id:id,source_line_id:lid,sku_code:PRODUCTS[p].sku,product_name:PRODUCTS[p].name,variant:PRODUCTS[p].variant,image_url:PRODUCTS[p].image,quantity:2,sequence:p+1,projection_revision:1})}
        await members(id,active)
        if(s>=5){
          const allocation=await doc(`allocation:${ei}:${s}`,'hzkj_alloc_bill',`PH202611${String(ei*100+s).padStart(5,'0')}`,`mock-allocation-${ei}-${s}`,progress.allocationReview==='approved'?'C':'B')
          await insert(m,'hz_fop_allocations',{document_id:allocation,company_id:company,dataset_id:dataset,source_order_id:source,source_order_number:number,warehouse_id:`mock-${warehouse}`,customer_id:customer,owner_employee_id:employee,raw_allocation_status:progress.stockReadiness})
          await insert(m,'hz_fop_document_relations',{id:uuid(`allocation-rel:${id}`),...scope,from_document_id:id,to_document_id:allocation,relation_type:'allocation',holder_document_id:allocation,relation_grain:'document',resolution_state:'resolved'})
          const dispatch=await doc(`dispatch:${ei}:${s}`,'hzkj_deliver_bill',`FY202611${String(ei*100+s).padStart(5,'0')}`,`mock-dispatch-${ei}-${s}`)
          await insert(m,'hz_fop_dispatches',{document_id:dispatch,company_id:company,dataset_id:dataset,customer_id:customer,owner_employee_id:employee,warehouse_id:`mock-${warehouse}`,raw_delivery_status:progress.shopifySync==='synced'?'FULFILLED':'TRACKING_OBTAINED',raw_shopify_sync_status:progress.shopifySync,shopify_synced_at:progress.shopifySync==='synced'?at(1):null})
          await insert(m,'hz_fop_document_relations',{id:uuid(`dispatch-rel:${id}`),...scope,from_document_id:id,to_document_id:dispatch,relation_type:'dispatch',holder_document_id:dispatch,relation_grain:'document',resolution_state:'resolved'})
        }
        if(exception)await insert(m,'hz_fop_exception_marks',{id:uuid(`exception:${id}`),...scope,order_document_id:id,source_mark_key:'mock-exception',type:exception.type,reason:exception.reason,active:true,occurred_at:at(1),source_version:'1'})
        if(active.has('procurement')||active.has('procurement_shipping')||active.has('procurement_completed'))for(const [p,lid]of lines.entries()){
          const unassigned=s<=2?2:0
          await insert(m,'hz_fop_workbench_procurement_demands',{id:uuid(`demand:${lid}`),...scope,order_document_id:id,order_line_id:lid,effective_order_quantity:2,stock_covered_quantity:0,required_quantity:2,allocated_quantity:2-unassigned,unassigned_quantity:unassigned,calculation_state:'known',projection_revision:1})
          if(!unassigned){
            const pk=`purchase:${s}:${p}`,pid=uuid(pk),psource=`mock-purchase-${s}-${p}`
            if(!(await m.query('SELECT id FROM hz_fop_source_documents WHERE id=$1',[pid])).length){await doc(pk,'hzkj_purorderbill',`CG202611${String(s*10+p).padStart(8,'0')}`,psource);await insert(m,'hz_fop_purchase_orders',{document_id:pid,company_id:company,dataset_id:dataset,entity_code:'hzkj_purorderbill',supplier_id:'mock-supplier',purchase_type:'online',platform_code:'1688',raw_trade_status:purchase.supplierPayment,raw_platform_status:s===3?'pending':'placed',paid_at:purchase.supplierPayment==='paid'?at(s===4?8:1):null,settlement_currency:'CNY',total_amount:300,paid_amount:purchase.supplierPayment==='paid'?300:0});if(s!==3)await insert(m,'hz_fop_platform_orders',{id:uuid(`platform:${pk}`),...scope,purchase_document_id:pid,platform_code:'1688',external_order_id:`512783391617602${String(s*10+p).padStart(4,'0')}`,paid_at:purchase.supplierPayment==='paid'?at(s===4?8:1):null,raw_status:s===3?'pending':'paid'});await line(pid,p)}
            await insert(m,'hz_fop_workbench_purchase_allocations',{id:uuid(`purchase-allocation:${lid}`),...scope,order_document_id:id,order_line_id:lid,purchase_document_id:pid,purchase_line_id:uuid(`${pid}:line:${p}`),allocated_requirement_quantity:2,supplier_shipped_quantity:progress.supplierShipment==='shipped'?2:s===4?1:0,cancelled_quantity:0,returned_quantity:0,allocation_state:'known',projection_revision:1})
          }
        }
        if(s===9){
          const rma=await doc(`rma:${ei}`,'hzkj_after_sale_orders',`RMA202611${String(ei).padStart(5,'0')}`,`mock-rma-${ei}`)
          await insert(m,'hz_fop_rma_orders',{document_id:rma,company_id:company,dataset_id:dataset,entity_code:'hzkj_after_sale_orders',after_sale_type:['refund','return_refund','reshipment'][ei%3],raw_flow_status:'processing',is_open:true,reason:'商品损坏，客户申请售后',requested_amount:42.5,requested_currency:'USD',refund_amount:ei%3===2?0:20,refund_currency:'USD'})
          await insert(m,'hz_fop_document_relations',{id:uuid(`rma-rel:${id}`),...scope,from_document_id:id,to_document_id:rma,relation_type:'rma',holder_document_id:rma,relation_grain:'document',resolution_state:'resolved'})
          const pur=await doc(`return-purchase:${ei}`,'hzkj_purorderbill',`CG20261109${String(ei).padStart(6,'0')}`,`mock-return-purchase-${ei}`)
          await insert(m,'hz_fop_purchase_orders',{document_id:pur,company_id:company,dataset_id:dataset,supplier_id:'mock-supplier',purchase_type:'online',platform_code:'1688'})
          const ret=await doc(`return:${ei}`,'hzkj_purrefundapplybill',`TH202611${String(ei).padStart(5,'0')}`,`mock-return-${ei}`),retline=await line(ret,0)
          await insert(m,'hz_fop_purchase_returns',{document_id:ret,company_id:company,dataset_id:dataset,supplier_id:'mock-supplier',purchase_source_id:`mock-return-purchase-${ei}`,return_kind:'physical_return',raw_physical_status:['pending_outbound','in_transit','received','completed'][ei%4],reason:'商品质量问题'})
          await insert(m,'hz_fop_return_line_details',{line_id:retline,company_id:company,dataset_id:dataset,requested_quantity:2,returned_quantity:ei%4===0?0:2})
          await insert(m,'hz_fop_document_relations',{id:uuid(`return-rel:${id}`),...scope,from_document_id:id,from_line_id:lines[0],to_document_id:ret,to_line_id:retline,relation_type:'purchase_return',holder_document_id:ret,relation_grain:'line_line',resolution_state:'resolved'})
        }
        fulfillment++
      }
      for(let s=0;s<6;s++){
        const id=await doc(`stock:${ei}:${s}`,'hzkj_stock_order_new',`BH202611${String(ei*10+s).padStart(5,'0')}`,`mock-stock-${ei}-${s}`,s%3===0?'B':'C'),status=['unpaid','pending_procurement','received'][s%3]
        await insert(m,'hz_fop_stock_orders',{document_id:id,company_id:company,dataset_id:dataset,customer_id:customer,owner_employee_id:employee,stock_type:s<3?'full_payment':'deposit',raw_payment_status:s%3===0?'unpaid':'paid',warehouse_id:`mock-${warehouse}`,business_created_at:at([1,14,45][s%3]),customer_paid_at:s%3===0?null:at([1,14,45][s%3]),total_amount:1628,settlement_currency:'USD'})
        await insert(m,'hz_fop_workbench_orders',{document_id:id,...scope,order_kind:'stock',order_number:`BH202611${String(ei*10+s).padStart(5,'0')}`,customer_id:customer,customer_name:['Olivia Martin','Noah Williams','Emma Thompson'][ei%3],owner_employee_id:employee,warehouse_id:`mock-${warehouse}`,warehouse_name:warehouse==='HZ'?'杭州仓':'深圳仓',stock_type:s<3?'full_payment':'deposit',stock_lifecycle:status,business_created_at:at([1,14,45][s%3]),customer_paid_at:s%3===0?null:at([1,14,45][s%3]),customer_payment_state:s%3===0?'unpaid':'paid',order_review_state:s%3===0?'pending':'approved',purchase_coverage_state:s%3===2?'ordered':'not_ordered',supplier_shipment_state:s%3===2?'shipped':'pending',procurement_stage:s%3===1?'supplier_pending':'purchase_order_pending',supplier_payment_state:s%3===1?'paid':'not_required',currency_code:'USD',total_amount:1628,total_quantity:40,item_count:2,projection_revision:1,rule_version:1,readiness:'ready',published_at:stamp,ownership_verified_at:stamp,ownership_version:'mock-1'})
        for(let p=0;p<2;p++){const lid=await line(id,p,20);await insert(m,'hz_fop_workbench_order_lines',{id:uuid(`display:${lid}`),...scope,order_document_id:id,source_line_id:lid,sku_code:PRODUCTS[p].sku,product_name:PRODUCTS[p].name,variant:PRODUCTS[p].variant,image_url:PRODUCTS[p].image,quantity:20,sequence:p+1,projection_revision:1})}
        for(const q of ['stock','stock_procurement'])await insert(m,'hz_fop_workbench_memberships',{id:uuid(`${id}:${q}`),...scope,order_document_id:id,queue_code:q,classification_state:q==='stock'||s%3===1?'member':'non_member',projection_revision:1,rule_version:1,published_at:stamp})
        stock++
      }
    }
    await populateMockPurchaseEntries(m)
    await populateMockLogistics(m)
    await populateMockReceiptNotices(m)
    return {fulfillment,stock}
  })
}
