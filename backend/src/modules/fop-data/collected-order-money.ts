import Decimal from 'decimal.js'
type Row=Record<string,any>
function component(value:unknown):number|null {
 if(!['string','number'].includes(typeof value)||!/^-?\d+(?:\.\d+)?$/.test(String(value)))return null
 const n=Number(value)
 return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null
}
/** Missing or ambiguous package facts cannot be interpreted as zero tax. */
function packageTax(raw:Row):number|null {
 const rows=raw.hzkj_logistics_info
 if(!Array.isArray(rows)||!rows.length)return null
 const ids=new Set<string>(),numbers=new Set<string>()
 let sum=new Decimal(0)
 for(const row of rows){
  if(!row||typeof row!=='object')return null
  for(const [key,set] of [['id',ids],['hzkj_combofield',numbers]] as const){
   const value=row[key]
   if(value!==undefined&&value!==null&&value!==''){
    if(set.has(String(value)))return null
    set.add(String(value))
   }
  }
  const value=component(row.hzkj_package_tax_fee)
  if(value===null)return null
  sum=sum.plus(value)
 }
 return component(sum.toFixed())
}
/** User-confirmed order amount / USD contract. Source payload is never rewritten. */
export function collectedOrderMoney(display:Row,raw:Row|undefined,companyId:string):Row{
 if(!raw)return display
 const capture=display.moneyCapture
 if(capture?.sourceId===raw.id&&capture?.orderNumber===raw.billno&&capture?.companyId===companyId&&['order-detail','order-list'].includes(capture?.operation)){
  const supplement:Row={}
  for(const key of ['hzkj_total_amount','hzkj_order_amount','hzkj_fre_quo_amount','hzkj_logistics_info','hzkj_discount_cost'])if(Object.prototype.hasOwnProperty.call(capture.values??{},key))supplement[key]=capture.values[key]
  raw={...raw,...supplement}
 }
 const value=raw.hzkj_total_amount
 const valid=(typeof value==='string'||typeof value==='number')&&/^-?\d+(\.\d+)?$/.test(String(value))
 const n=valid?Number(value):NaN
 const amount=valid&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null
 const code=raw.hzkj_settlecurrency_number??raw.hzkj_settlecurrency?.number
 const currency=typeof code==='string'&&/^[A-Z]{3}$/.test(code)?code:(!code?'USD':null)
 const missing=new Set<string>(display.dataQuality?.missingFields??[])
 for(const [key,v] of Object.entries({amount,currency})){if(v===null)missing.add(key);else missing.delete(key)}
 const {amountBreakdownSource:_obsoleteReceiptSource,...base}=display
 return {...base,amount,currency,amountBreakdown:{productAmount:component(raw.hzkj_order_amount),shippingFee:component(raw.hzkj_fre_quo_amount),taxAmount:packageTax(raw),discountAmount:component(raw.hzkj_discount_cost),totalAmount:amount},dataQuality:{...display.dataQuality,missingFields:[...missing]},amountBasis:'hzkj_total_amount',currencyBasis:code?'source':'confirmed_usd_2026_11_15'}
}
