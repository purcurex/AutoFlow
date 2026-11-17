type Row=Record<string,any>
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER?v:null
/** Required source identity is strict; absent display facts never become known defaults. */
export function normalizeCollectedStock(input:unknown,context:{tenantId:string}):Row {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_collected_stock')
 const r=input as Row;if(typeof r.id!=='string'||!/^[1-9]\d{0,30}$/.test(r.id)||r.tenantId!==context.tenantId||!text(r.stockNumber))throw Error('invalid_collected_stock_identity')
 const missing=new Set<string>();const pick=(key:string,v:any)=>{if(v===null)missing.add(key);return v}
 const enumValue=(key:string,values:readonly string[])=>pick(key,values.includes(r[key])?r[key]:null)
 const reference=(key:string)=>{const v=r[key];if(v==null){missing.add(key);return null}if(typeof v!=='object'||typeof v.id!=='string'||!v.id.trim())throw Error('invalid_collected_stock_scope');return{id:v.id,name:text(v.name)}}
 const items=Array.isArray(r.items)?r.items.map((i:Row)=>({sku:text(i.sku)??'',name:text(i.name)??'',variant:text(i.variant)??'',imageUrl:text(i.imageUrl),quantity:pick('items.quantity',finite(i.quantity))})):[]
 if(!Array.isArray(r.items))missing.add('items')
 const timestamp=(key:string)=>{const v=text(r[key]);return pick(key,v&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?v:null)}
 const nativeOrder=Object.prototype.hasOwnProperty.call(r,'rawOrderStatus'),nativeBill=Object.prototype.hasOwnProperty.call(r,'rawBillStatus')
 const paymentStatus=nativeOrder?(r.rawOrderStatus==='2'?'paid':r.rawOrderStatus==='1'?'unpaid':'unknown'):enumValue('paymentStatus',['paid','unpaid','unknown'])
 const reviewStatus=nativeBill?(r.rawBillStatus==='C'?'approved':['A','B'].includes(r.rawBillStatus)?'pending':'unknown'):enumValue('reviewStatus',['approved','pending','unknown'])
 const row:Row={...r,items,owner:reference('owner'),department:reference('department'),amount:pick('amount',finite(r.amount)),currency:pick('currency',typeof r.currency==='string'&&/^[A-Z]{3}$/.test(r.currency)?r.currency:null),stockType:enumValue('stockType',['full_payment','deposit']),purchaseStatus:enumValue('purchaseStatus',['unpurchased','partial','in_progress','purchased','shipped','received','unknown']),cancelled:pick('cancelled',typeof r.cancelled==='boolean'?r.cancelled:null),paymentStatus,reviewStatus,warehouseCode:pick('warehouseCode',text(r.warehouseCode)),warehouse:pick('warehouse',text(r.warehouse)),customerId:pick('customerId',text(r.customerId)),customerName:pick('customerName',text(r.customerName)),createdAt:timestamp('createdAt'),paidAt:timestamp('paidAt'),procurementPaidAt:timestamp('procurementPaidAt')}
 row.orderStatus=nativeOrder?({0:'cancelled',1:'unpaid',2:'paid'} as Record<string,string>)[r.rawOrderStatus]??null:r.cancelled===true?'cancelled':['paid','unpaid'].includes(paymentStatus)?paymentStatus:null
 if(nativeOrder){row.cancelled=['0','1','2'].includes(r.rawOrderStatus)?r.rawOrderStatus==='0':null;if(row.cancelled!==null)missing.delete('cancelled')}
 if(row.orderStatus===null)missing.add('orderStatus')
 if(reviewStatus==='unknown'||reviewStatus===null)missing.add('reviewStatus')
 row.dataQuality={mode:'collected',readOnly:true,missingFields:[...missing],reasons:['legacy_capture_not_consistent_snapshot']};return row
}
