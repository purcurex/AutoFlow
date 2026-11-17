import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
type Row = Record<string, any>
export type ChainInput = { kind: string; raw: Row; capturedAt: string; display?: Row }
export type ChainScope = { connectionId: string; companyId: string; sourceCompanyId: string; datasetId: string }
export const chainKinds: Record<string, { entity: string; table: string; entries: string[] }> = {
 fulfillment:{entity:'hzkj_orders',table:'hz_fop_fulfillment_orders',entries:['hzkj_orders_billentry']},
 stock:{entity:'hzkj_stock_order_new',table:'hz_fop_stock_orders',entries:['hzkj_orders_billentry']},
 purchase_application:{entity:'hzkj_purapplybill',table:'hz_fop_purchase_requisitions',entries:['entryentity']},
 purchase:{entity:'hzkj_purorderbill',table:'hz_fop_purchase_orders',entries:['hzkj_billentry','entryentity']},
 allocation:{entity:'hzkj_alloc_bill',table:'hz_fop_allocations',entries:['hzkj_alloc_entry']},
 dispatch:{entity:'hzkj_deliver_bill',table:'hz_fop_dispatches',entries:[]},
 delivery_notice:{entity:'hzkj_deliver_order',table:'hz_fop_delivery_notices',entries:['entryentity']},
 outbound:{entity:'im_saloutbill',table:'hz_fop_outbound_bills',entries:['billentry']},
 receipt_notice:{entity:'hzkj_receiptnotice',table:'hz_fop_receipt_notices',entries:['entryentity']},
 receipt:{entity:'hzkj_receive_bill',table:'hz_fop_receipts',entries:['entryentity']},
}
export const chainId=(...parts:string[])=>{const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
export const chainText=(v:unknown):string|null=>typeof v==='string'&&v.trim()?v.trim():typeof v==='number'&&Number.isSafeInteger(v)?String(v):null
const reference=(v:unknown)=>{const s=chainText(v);return s==='0'?null:s}
export const chainDecimal=(v:unknown,precision=28):string|null=>{try{if(v===null||v===undefined||v==='')return null;const d=new Decimal(String(v));return d.isFinite()&&d.decimalPlaces()<=8&&d.abs().lt(new Decimal(10).pow(precision-8))?d.toFixed():null}catch{return null}}
export const chainTime=(v:unknown)=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?v:null
export function buildCollectedBusinessChain(scope:ChainScope,inputs:ChainInput[],receiptLinks:Record<string,string>={}) {
 const documents:Row[]=[],lines:Row[]=[],relations:Row[]=[],issues:Row[]=[];const seenLines=new Set<string>()
 const docs=new Map<string,Row>(),numbers=new Map<string,Row[]>(),lineIds=new Map<string,Row[]>(),docLines=new Map<string,Row[]>(),roots=new Map<string,Set<string>>()
 const issue=(d:Row,reason:string,line?:Row)=>issues.push({documentId:d.id,sourceId:d.sourceId,kind:d.kind,entryId:line?.sourceEntryId??null,reason})
 for(const input of inputs){const cfg=chainKinds[input.kind];if(!cfg)continue;const r=input.raw,sourceId=chainText(r.id);if(!sourceId)throw Error('source_id_required')
  const org=chainText(r.organizationId??r.org_id);if(org&&org!==scope.sourceCompanyId)throw Error('cross_company_source')
  const key=input.kind+':'+sourceId;if(docs.has(key))throw Error('duplicate_source_document')
  const d={id:chainId(scope.datasetId,cfg.entity,sourceId),kind:input.kind,entity:cfg.entity,sourceId,number:chainText(r.billno),raw:r,display:input.display,capturedAt:input.capturedAt,sourceVersion:null}
  documents.push(d);docs.set(key,d);const nk=input.kind+':'+d.number;numbers.set(nk,[...(numbers.get(nk)??[]),d]);docLines.set(d.id,[])
  for(const entry of cfg.entries){const values=r[entry];if(values!==undefined&&!Array.isArray(values)){issue(d,'invalid_entry_array');continue}
   for(const raw of values??[]){const sid=chainText(raw.id);if(!sid){issue(d,'missing_entry_id');continue}const id=chainId(d.id,entry,sid);if(seenLines.has(id))throw Error('duplicate_source_entry');seenLines.add(id)
    const line={id,documentId:d.id,entryEntity:entry,sourceEntryId:sid,sequence:Number.isSafeInteger(Number(raw.seq))&&raw.seq!==undefined&&raw.seq!==null?Number(raw.seq):null,raw,quantity:chainDecimal(raw.hzkj_qty??raw.qty??raw.hzkj_applyqty,24),amount:chainDecimal(raw.hzkj_real_receive_amt??raw.hzkj_amount??raw.amount),currency:chainText(raw.currency_code),sku:chainText(raw.hzkj_local_sku?.number??raw.hzkj_local_sku_number??raw.hzkj_material?.number),name:chainText(raw.hzkj_local_sku?.name??raw.hzkj_local_sku_name??raw.hzkj_material?.name)}
    lines.push(line);docLines.get(d.id)!.push(line);const lk=input.kind+':'+sid;lineIds.set(lk,[...(lineIds.get(lk)??[]),line])
   }
  }
  if(input.kind==='fulfillment'||input.kind==='stock'){roots.set(d.id,new Set([d.id]));for(const l of docLines.get(d.id)!)roots.set(l.id,new Set([d.id]))}
 }
 const byUuid=new Map(documents.map(d=>[d.id,d]))
 const find=(kind:string,id:unknown,no:unknown):Row|undefined=>{const sid=reference(id),number=chainText(no);if(sid){const d=docs.get(kind+':'+sid);return d&&(!number||d.number===number)?d:undefined}const found=number?numbers.get(kind+':'+number):[];return found?.length===1?found[0]:undefined}
 const sourceLine=(d:Row,id:unknown,seq:unknown)=>{const sid=reference(id),s=reference(seq);const found=(docLines.get(d.id)??[]).filter(l=>sid?l.sourceEntryId===sid:s!==null&&String(l.sequence)===s);return found.length===1?found[0]:undefined}
 function link(from:Row,to:Row,type:string,fl:Row|undefined,tl:Row|undefined,basis:string,quantity:string|null=null,amount:string|null=null){
  const rootIds=roots.get(fl?.id??from.id);if(!rootIds?.size){issue(to,'source_lineage_unresolved',tl);return}
  const id=chainId(scope.datasetId,from.id,fl?.id??'',to.id,tl?.id??'',type)
  const currency=chainText(tl?.raw.currency_code??to.raw.currency_code)
  const safeCurrency=currency&&/^[A-Z]{3}$/.test(currency)?currency:null
  for(const rootId of rootIds){relations.push({id,rootId,rootSourceId:byUuid.get(rootId)!.sourceId,fromId:from.id,toId:to.id,fromLineId:fl?.id??null,toLineId:tl?.id??null,fromEntryId:fl?.sourceEntryId??null,toEntryId:tl?.sourceEntryId??null,type,basis,quantity,amount,currency:safeCurrency});for(const key of [to.id,...(tl?[tl.id]:[])]){if(!roots.has(key))roots.set(key,new Set());roots.get(key)!.add(rootId)}}
 }
 const run=(kind:string,fn:(d:Row)=>void)=>documents.filter(d=>d.kind===kind).forEach(fn)
 for(const kind of ['purchase_application','purchase'])run(kind,d=>{for(const l of docLines.get(d.id)??[]){if(kind==='purchase'&&l.entryEntity!=='hzkj_billentry')continue;const r=l.raw
  const sourceEntity=chainText(r.hzkj_srcbillentity)
  const application=sourceEntity===chainKinds.purchase_application.entity
  const sourceKind=application?'purchase_application':sourceEntity===chainKinds.stock.entity?'stock':'fulfillment'
  if(sourceEntity&&!['hzkj_orders',chainKinds.stock.entity,chainKinds.purchase_application.entity].includes(sourceEntity)){issue(d,'unsupported_source_entity',l);continue}
  const p=find(sourceKind,application?reference(r.hzkj_srcbillid):reference(r.hzkj_salbillid)??reference(r.hzkj_srcbillid),application?r.hzkj_srcbillnumber:r.hzkj_salbillnumber||r.hzkj_srcbillnumber)
  const pl=p&&sourceLine(p,application?reference(r.hzkj_srcbillentryid):reference(r.hzkj_salbillentryid)??reference(r.hzkj_srcbillentryid),application?reference(r.hzkj_srcbillentryseq):reference(r.hzkj_salbillentryseq)??reference(r.hzkj_srcbillentryseq))
  if(!p||!pl){issue(d,'source_order_or_line_unresolved',l);continue}link(p,d,'demand_purchase',pl,l,'source_order_and_entry',l.quantity)
 }})
 run('allocation',d=>{const p=find('fulfillment',d.raw.hzkj_order_id,d.raw.hzkj_order_no);if(p)link(p,d,'allocation',undefined,undefined,'source_order_id');else issue(d,'source_order_unresolved')})
 run('dispatch',d=>{const p=find('fulfillment',null,d.raw.hzkj_order_no),customer=chainText(d.raw.hzkj_customer_id??d.raw.hzkj_customer?.id);if(p&&(!customer||customer===chainText(p.raw.hzkj_customer_id??p.raw.hzkj_customer?.id)))link(p,d,'dispatch',undefined,undefined,'unique_order_number_and_customer');else issue(d,'source_order_unresolved')})
 run('delivery_notice',d=>{const p=find('dispatch',null,d.raw.hzkj_deliver_billno);if(p)link(p,d,'delivery_notice',undefined,undefined,'unique_dispatch_number');else issue(d,'source_dispatch_unresolved')})
 run('outbound',d=>{for(const l of docLines.get(d.id)??[]){const p=find('fulfillment',null,l.raw.hzkj_entry_billno);if(p)link(p,d,'outbound',undefined,l,'explicit_order_number',l.quantity);else issue(d,'source_order_unresolved',l)}})
 run('receipt_notice',d=>{for(const l of docLines.get(d.id)??[]){const found=lineIds.get('purchase:'+receiptLinks[l.sourceEntryId]);const pl=found?.length===1?found[0]:undefined,p=pl&&byUuid.get(pl.documentId);if(p)link(p,d,'purchase_receipt',pl,l,'source_receipt_purchase_entry',l.quantity);else issue(d,'source_purchase_line_unresolved',l)}})
 run('receipt',d=>{const entries=docLines.get(d.id)??[];if(entries.length){for(const l of entries){const type=chainText(l.raw.hzkj_entry_src_type);if(!['A','C'].includes(type??'')){if(type!=='D')issue(d,'unsupported_receipt_source_type',l);continue}const p=find(type==='A'?'fulfillment':'stock',null,l.raw.hzkj_src_order);if(p)link(p,d,'receipt',undefined,l,'typed_receipt_source_number',null,chainDecimal(l.raw.hzkj_real_receive_amt));else issue(d,'receipt_source_unresolved',l)}}else{const type=chainText(d.raw.hzkj_src_type);if(type==='D')return;const p=['A','C'].includes(type??'')?find(type==='A'?'fulfillment':'stock',null,d.raw.hzkj_src_bill):undefined;if(p)link(p,d,'receipt',undefined,undefined,'typed_receipt_header_source',null,chainDecimal(d.raw.hzkj_rec_amount));else issue(d,'receipt_source_unresolved')}})
 return {documents,lines,relations,issues}
}
