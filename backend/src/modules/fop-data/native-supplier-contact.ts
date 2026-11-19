import { createHash } from 'node:crypto'
import { safeWangwangUrl } from './supplier-follow-up'
import { purchaseMatchesSourceSku, purchaseSalesReference } from './collected-purchase-association'
import { purchaseLogisticsSupplier } from './purchase-logistics-supplier'
type Row = Record<string, any>
export type SupplierSourceReference={sourceType:'full_payment'|'deposit'|'direct';parent:Row;skuId?:string;sku?:string;consumption?:Row}
export type SupplierRead = (kind: 'purchase'|'inbound'|'receipt', body: unknown) => Promise<any>
const text = (v:unknown):string => typeof v === 'string' ? v.trim() : ''
const exact = (v:unknown):string => { const s=text(v); if(!s || s.length>120 || !/^[\w.-]+$/.test(s))throw Error('Supplier source identity missing');return s }
/** A request-scoped reader. Never infer a return's purchase from shared SKU or order-level candidates. */
export class NativeSupplierContacts {
 private readonly reads = new Map<string, Promise<Row>>()
 constructor(private readonly read:SupplierRead,private readonly companyId:string,private readonly orgNumber:string){}
 private async one(kind:'purchase'|'inbound'|'receipt',expected:{id?:string;number?:string}):Promise<Row>{
  if(!expected.id&&!expected.number)throw Error('Supplier source identity missing')
  const data:Row={org_number:exact(this.orgNumber)}
  if(expected.id)data.id=exact(expected.id)
  if(expected.number)data.billno=exact(expected.number)
  const key=JSON.stringify([kind,data]);const prior=this.reads.get(key);if(prior)return prior
  if(this.reads.size>=20)throw Error('Too many supplier source documents')
  const pending=(async()=>{
   const d=await this.read(kind,{data,pageNo:1,pageSize:10})
   if(d?.pageNo!==1||d.pageSize!==10||d.totalCount!==1||d.lastPage!==true||!Array.isArray(d.rows)||d.rows.length!==1)throw Error('Supplier source document missing or ambiguous')
   const r=d.rows[0],filter=String(d.filter??'')
   // queryPurchase currently exposes the server-applied company filter, not an org_id column.
   const explicitCompany=r.org_id===this.companyId&&r.org_number===this.orgNumber
   const filteredCompany=/^\d+$/.test(this.companyId)&&/^[\w.-]+$/.test(this.orgNumber)&&filter.includes(`org in (${this.companyId})`)&&filter.includes(`org.number = '${this.orgNumber}'`)&&!/\bOR\b/i.test(filter)
   if(!explicitCompany&&!filteredCompany)throw Error('Supplier source company mismatch')
   if(r.org_id!=null&&r.org_id!==this.companyId||r.org_number!=null&&r.org_number!==this.orgNumber)throw Error('Supplier source company mismatch')
   if(typeof r.id!=='string'||!r.id||expected.id&&r.id!==expected.id||expected.number&&r.billno!==expected.number)throw Error('Supplier source identity mismatch')
   return r
  })();this.reads.set(key,pending);return pending
 }
 async purchase(expected:{id?:string;number?:string;platformOrderNumber?:string|null},orderNumber:string):Promise<Row>{
  const r=await this.one('purchase',expected),platform=text(r.hzkj_1688_order_n)
  if(expected.platformOrderNumber&&platform!==expected.platformOrderNumber)throw Error('1688 order changed; refresh the list')
  if(orderNumber&&!(r.hzkj_billentry??[]).some((l:Row)=>l.hzkj_salbillnumber===orderNumber))throw Error('Purchase no longer belongs to this order')
  const supplier=purchaseLogisticsSupplier(r),account=supplier.wangwangAccount
  const validPlatform=/^[1-9]\d{0,19}$/.test(platform)
  const url=validPlatform&&account&&!account.includes('*')?safeWangwangUrl(`aliim:sendmsg?touid=${encodeURIComponent('cnalichn'+account)}`,account):null
  const result={purchaseOrderId:r.id,purchaseOrderNumber:r.billno,platformOrderNumber:platform||null,supplier,lines:[],availability:!account?'missing_account':url?'ready':'chat_unavailable',url}
  return {...result,contactVersion:createHash('sha256').update(JSON.stringify([orderNumber,result])).digest('hex')}
 }
 async purchaseSources(expected:{id?:string;number?:string;platformOrderNumber?:string|null},references:SupplierSourceReference[]):Promise<Row>{
  if(!references.length)throw Error('Supplier source relationship missing')
  const raw=await this.one('purchase',expected)
  if(raw.hzkj_cancelstatus==='B')throw Error('Purchase was cancelled')
  // Every represented source must still be present on the live purchase; merged POs are checked per parent/SKU.
  for(const ref of references)if(!(raw.hzkj_billentry??[]).some((line:Row)=>ref.skuId?purchaseMatchesSourceSku(line,ref.parent,ref.skuId):purchaseSalesReference(line).number===ref.parent.billno))throw Error('Purchase source relationship changed')
  const contact=await this.purchase(expected,'')
  const sourceReferences=[...new Map(references.map(r=>{const value={sourceType:r.sourceType,orderNumber:r.parent.billno,sku:r.sku??''};return [JSON.stringify(value),value]})).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const evidence=references.map(r=>[r.sourceType,r.parent.id,r.parent.billno,r.skuId,r.consumption]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {...contact,sourceReferences,contactVersion:createHash('sha256').update(JSON.stringify([contact.contactVersion,evidence])).digest('hex')}
 }
 async returned(document:Row,orderNumber:string):Promise<Row[]>{
  if(!Array.isArray(document.lines)||!document.lines.length)throw Error('Return source lines missing')
  const contacts=new Map<string,Row>()
  for(const line of document.lines){
   if(line.orderNumber!==orderNumber)throw Error('Return order mismatch')
   const inbound=await this.one('inbound',{id:line.sourceDocumentId,number:line.sourceDocumentNumber})
   const entries=(inbound.billentry??[]).filter((l:Row)=>l.id===line.sourceEntryId)
   if(entries.length!==1||entries[0].hzkj_salbillnumber!==orderNumber)throw Error('Return source entry mismatch')
   const receipt=await this.one('receipt',{number:exact(entries[0].srcbillnumber)})
   const platform=exact(receipt.hzkj_1688_order_n)
   const contact=await this.purchase({number:exact(receipt.hzkj_purchase_order_numbe),platformOrderNumber:platform},orderNumber)
   contacts.set(contact.purchaseOrderId,contact)
  }
  return [...contacts.values()]
 }
}
