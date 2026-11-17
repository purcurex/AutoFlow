import Decimal from 'decimal.js'
type Row=Record<string,any>
const text=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.trim():null
const id=(v:unknown):string|null=>typeof v==='string'&&/^[1-9]\d{0,30}$/.test(v)?v:null
const date=(v:unknown)=>{const s=text(v),z=s&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s)?s.replace(' ','T')+'+08:00':s;return z&&/(Z|[+-]\d\d:\d\d)$/.test(z)&&Number.isFinite(Date.parse(z))?new Date(z).toISOString():null}
const amount=(v:unknown)=>{try{if(v===null||v===undefined||v==='')return null;const d=new Decimal(String(v)),n=d.toNumber();return d.isFinite()&&d.gte(0)&&n<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(d)?n:null}catch{return null}}
/** RMA amount belongs to this case, never the parent fulfillment or refund. */
export function collectedRmaMoney<T extends Row>(display:T,raw:Row){
 const currency=raw?.hzkj_tocurr_number??raw?.hzkj_tocurr?.number
 return {...display,amount:amount(raw?.hzkj_order_amount),currency:currency==null?'USD':typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?currency:null,amountBreakdown:undefined,amountBasis:'rma.hzkj_order_amount'}
}
const types:Record<string,string>={A:'return_refund',B:'refund',C:'reshipment'}
const stages:Record<string,string>={'0':'取消','1':'待处理','2':'处理中','3':'处理完成','4':'已补发','5':'取消发货','6':'已关闭'}
export interface CollectedRmaParent {source_id:string;company_id:string;order_number:string;shop_id:string|null;payer_customer_id:string|null;source_businessowner_id:string|null;owner_employee_id:string|null;display:Row}
/** Native RMA lacks company/payer/owner. Request payer evidence and an exact, same-company local parent are required. */
export function normalizeCollectedRma(raw:Row,context:{companyId:string;payerCustomerId:string;parents:readonly CollectedRmaParent[]}){
 if(!id(raw.id)||!text(raw.number)||!id(context.companyId)||!id(context.payerCustomerId))throw Error('invalid_collected_rma_identity_or_scope')
 const sourceNumber=text(raw.hzkj_srcnumber),shop=id(raw.hzkj_shop_id)
 const candidates=context.parents.filter(p=>p.company_id===context.companyId&&!!sourceNumber&&p.order_number===sourceNumber&&!!shop&&p.shop_id===shop)
 let state='verified';const parent=candidates.length===1?candidates[0]:null
 if(!parent)state=candidates.length?'ambiguous':'unmatched'
 else if(parent.payer_customer_id!==context.payerCustomerId)state='payer_mismatch'
 else if(!parent.source_businessowner_id||parent.source_businessowner_id!==parent.owner_employee_id||parent.display.owner?.id!==parent.source_businessowner_id)state='owner_unverified'
 const verified=state==='verified',rawType=text(raw.hzkj_sales_type),rawStatus=text(raw.hzkj_orderstatus),type=types[rawType??'']??'unknown'
 const refundCurrency=text(raw.hzkj_tocurr_number)
 const item={id:raw.id,orderId:verified?parent!.source_id:null,type,rawType,rawStatus,isOpen:Object.prototype.hasOwnProperty.call(stages,rawStatus??'')?['1','2'].includes(rawStatus!):null,number:text(raw.number),stage:stages[rawStatus??'']??'状态未提供',reason:text(raw.hzkj_resason1)||text(raw.hzkj_resason_name),createdAt:date(raw.createtime),updatedAt:date(raw.modifytime),requestedAmount:null,currency:null,refundAmount:type==='reshipment'?null:amount(raw.hzkj_refund_amount),refundCurrency:type!=='reshipment'&&refundCurrency&&/^[A-Z]{3}$/.test(refundCurrency)?refundCurrency:null}
 const association={state,companyVerified:candidates.some(p=>p.payer_customer_id===context.payerCustomerId),sourceNumber,shopId:shop,payerCustomerId:context.payerCustomerId,candidateCount:candidates.length}
 const fallback={orderNumber:sourceNumber??'',shopifyOrderNumber:text(raw.hzkj_shopify_order)??'',customerName:'',storeName:text(raw.hzkj_shop_name)??'',warehouse:'',items:[],amount:null,currency:null,owner:undefined,salesperson:'',paidAt:null,consumerPaidAt:null}
 const display:Row={...collectedRmaMoney(verified?parent!.display:fallback,raw),id:raw.id,sourceOrderId:verified?parent!.source_id:null,rmaCases:[item],rmaUpdatedAt:item.updatedAt,orderTags:[],refundAmounts:['refund','return_refund'].includes(type)?[{currency:item.refundCurrency,amount:item.refundAmount}]:[],rmaAssociation:association,dataQuality:{mode:'collected',readOnly:true,missingFields:[...(verified?parent!.display.dataQuality?.missingFields??[]:[]),...(!item.refundCurrency?['rma.refundCurrency']:[]),...(type==='unknown'?['rma.type']:[]),...(item.isOpen===null?['rma.status']:[])],reasons:['rma_capture_not_consistent_snapshot',...(verified?[]:['rma_parent_'+state])]}}
 return {id:raw.id as string,ownerEmployeeId:verified?parent!.source_businessowner_id:null,association,display,raw}
}
/** Completeness here covers only the explicitly captured customers, never a company-wide assertion. */
export function validateCollectedRmaPages(pages:unknown):{payerCustomerId:string;raw:Row}[]{
 if(!Array.isArray(pages)||!pages.length)throw Error('rma_pages_required')
 const groups=new Map<string,Row[]>(),seen=new Set<string>(),rows:{payerCustomerId:string;raw:Row}[]=[]
 for(const p of pages){if(!p||!id(p.payerCustomerId)||!Number.isSafeInteger(p.pageNo)||p.pageNo<1||!Number.isSafeInteger(p.pageSize)||p.pageSize<1||p.pageSize>1000||!Number.isSafeInteger(p.totalCount)||p.totalCount<0||typeof p.lastPage!=='boolean'||!Array.isArray(p.rows))throw Error('invalid_rma_page');const group=groups.get(p.payerCustomerId)??[];group.push(p);groups.set(p.payerCustomerId,group)}
 for(const [payerCustomerId,group]of groups){group.sort((a,b)=>a.pageNo-b.pageNo);const total=group[0].totalCount,size=group[0].pageSize;if(group.length!==Math.max(1,Math.ceil(total/size)))throw Error('incomplete_rma_pages');for(let i=0;i<group.length;i++){const p=group[i];if(p.pageNo!==i+1||p.pageSize!==size||p.totalCount!==total||p.rows.length!==Math.min(size,Math.max(0,total-i*size))||p.lastPage!==(i===group.length-1))throw Error('inconsistent_rma_pages');for(const raw of p.rows){if(!raw||!id(raw.id)||seen.has(raw.id))throw Error('duplicate_or_invalid_rma_id');seen.add(raw.id);rows.push({payerCustomerId,raw})}}}
 return rows
}
/** queryOrderDetail uses the company-scoped request; its row is flattened and omits org. The persisted raw parent proves company. */
export function collectedRmaParents(orders:readonly Row[],details:readonly Row[],companyId:string):CollectedRmaParent[]{
 const byId=new Map<string,Row>();for(const detail of details){if(!id(detail.id)||byId.has(detail.id))throw Error('duplicate_or_invalid_rma_source_detail');byId.set(detail.id,detail)}
 return orders.filter(p=>p.raw?.hzkj_org?.id===companyId&&p.raw?.id===p.source_id&&p.raw?.billno===p.order_number).map(p=>{
  const raw=p.raw,detail=byId.get(p.source_id),shop=id(raw.hzkj_shop?.id),owner=id(raw.hzkj_operator?.id)
  const exact=detail&&detail.billno===p.order_number&&id(detail.hzkj_shop_id)===shop&&id(detail.hzkj_operator_id)===owner
  const payer=id(raw.hzkj_payingcustomer?.id)??(exact?id(detail!.hzkj_payingcustomer_id):null)
  return {source_id:p.source_id,company_id:companyId,order_number:p.order_number,shop_id:shop,payer_customer_id:payer,source_businessowner_id:owner&&(!detail||exact)&&p.owner_employee_id===owner?owner:null,owner_employee_id:p.owner_employee_id,display:p.display}
 })
}
/** Runtime loads FOP identity/scope separately from local database and persistent pause settings. */
export function validateCollectedRmaCapture(capture:Row,fop:Record<string,string|undefined>,workbench:Record<string,string|undefined>){
 const config={...fop,...workbench}
 if(config.FOP_QUERIES_PAUSED!=='true'||config.WORKBENCH_AUTOMATIC_CALLS_ENABLED!=='false'||config.WORKBENCH_SYNC_ENABLED!=='false'||!config.DB_DATABASE||/mock/i.test(config.DB_DATABASE))throw Error('persistent_real_pause_required')
 const scope=capture.sourceScope
 if(scope?.entityCode!=='hzkj_after_sale_orders'||scope?.sourceOrderEntityCode!=='hzkj_orders'||scope?.subject?.tenantId!==capture.context?.tenantId||scope?.subject?.userId!==capture.context?.userId||scope?.organizationIds?.length!==1||scope.organizationIds[0]!==capture.companyId||capture.operation!=='queryRma'||capture.complete!==true||capture.coverage!=='partial_customer_scan'||capture.context?.tenantId!==config.FOP_REPLICA_TENANT_ID||capture.context?.userId!==config.FOP_KINGDEE_USER_ID||capture.companyId!==config.FOP_REPLICA_COMPANY_ID||typeof capture.capturedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(capture.capturedAt)||!Number.isFinite(Date.parse(capture.capturedAt))||!Array.isArray(capture.sourceOrders))throw Error('invalid_rma_capture_scope')
 const rows=validateCollectedRmaPages(capture.pages);if(capture.rowCount!==rows.length)throw Error('rma_row_count_mismatch')
 return rows
}
