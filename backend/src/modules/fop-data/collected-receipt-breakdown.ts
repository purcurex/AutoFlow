import Decimal from 'decimal.js'
type Row=Record<string,any>
function amount(value:unknown):number|null {
 if(!['number','string'].includes(typeof value)||!/^\d+(?:\.\d+)?$/.test(String(value)))return null
 const n=Number(value)
 return Number.isFinite(n)&&n<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null
}
/** Only the selected order's uniquely linked receipt entry; never allocate a receipt header total. */
export function applyReceiptBreakdown(order:Row,entries:Row[]):Row{
 const unique=new Map<string,Row>();let conflict=false
 for(const e of entries.filter(e=>e.orderId===(order.sourceOrderId??order.id))){const key=e.receiptId+':'+e.entryId;if(unique.has(key)&&JSON.stringify(unique.get(key))!==JSON.stringify(e))conflict=true;unique.set(key,e)}
 const candidates=[...unique.values()],entry=candidates.length===1&&!conflict?candidates[0]:null
 const state=conflict||candidates.length>1?'ambiguous':!entry?'missing':entry.currency!==order.currency||!order.currency?'currency_unconfirmed':'matched'
 const line=state==='matched'?entry!.line:{},fields={productAmount:amount(line.hzkj_amountfield)??order.amountBreakdown?.productAmount??null,shippingFee:amount(line.hzkj_freight)??order.amountBreakdown?.shippingFee??null,taxAmount:amount(line.hzkj_fixed_tax_fee)??order.amountBreakdown?.taxAmount??null}
 const missing=new Set<string>(order.dataQuality?.missingFields??[])
 for(const [key,value]of Object.entries(fields)){if(value===null)missing.add('amountBreakdown.'+key);else missing.delete('amountBreakdown.'+key)}
 const receiptOrderAmount=amount(line.hzkj_samount)
 const total=order.amount??receiptOrderAmount
 if(total!==null)missing.delete('amount')
 return {...order,amount:total,amountBasis:order.amount===null&&receiptOrderAmount!==null?'receipt.entryentity.hzkj_samount':order.amountBasis,amountBreakdown:{...fields,discountAmount:order.amountBreakdown?.discountAmount??null,totalAmount:total},amountBreakdownSource:{state,...(state==='matched'?{receiptId:entry!.receiptId,receiptNumber:entry!.receiptNumber,entryId:entry!.entryId,capturedAt:entry!.capturedAt,receiptOrderAmount,totalMatches:receiptOrderAmount===null||order.amount===null?null:new Decimal(receiptOrderAmount).eq(order.amount)}:{})},dataQuality:{...order.dataQuality,missingFields:[...missing]}}
}
/** Narrow by already-authorized page order numbers, company and batch before returning any receipt data. */
export const receiptBreakdownQuery=`WITH targets AS (
 SELECT order_number, min(source_id) AS source_id FROM hz_fop_collected_orders
 WHERE batch_id=$1 AND raw->'hzkj_org'->>'id'=$2 AND order_number=ANY($3::text[])
 GROUP BY order_number HAVING count(*)=1
)
SELECT o.source_id AS "orderId",r.source_id AS "receiptId",r.document_number AS "receiptNumber",
 l->>'id' AS "entryId",l AS line,r.captured_at AS "capturedAt",
 COALESCE(NULLIF(r.raw->>'hzkj_settlecurrency_number',''),NULLIF(r.raw->'hzkj_settlecurrency'->>'number',''),r.currency_code,
 CASE WHEN r.company_id='100000' THEN 'USD' END) AS currency
FROM hz_fop_collected_analytics_facts r
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.raw->'entryentity')='array' THEN r.raw->'entryentity' ELSE '[]'::jsonb END) l
JOIN targets o ON l->>'hzkj_src_order'=o.order_number
WHERE r.batch_id=$1 AND r.company_id=$2 AND r.entity_type='receipt'
AND r.raw_status='C' AND r.raw->>'hzkj_receive_type'='A'
AND COALESCE(r.raw->>'hzkj_void_status','') IN ('','0')
AND l->>'hzkj_entry_src_type'='A' AND NULLIF(l->>'id','') IS NOT NULL`
