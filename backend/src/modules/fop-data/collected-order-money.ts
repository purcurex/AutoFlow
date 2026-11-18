import Decimal from 'decimal.js'
type Row=Record<string,any>
function component(value:unknown):number|null {
 if(!['string','number'].includes(typeof value)||!/^-?\d+(?:\.\d+)?$/.test(String(value)))return null
 const n=Number(value)
 return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null
}
export const fixedOrderTax=(raw:Row):number|null=>component(raw.hzkj_fixed_tax_fee)
/** User-confirmed order amount / USD contract. Source payload is never rewritten. */
export function collectedOrderMoney(display:Row,raw:Row|undefined,companyId:string):Row{
 if(!raw)return display
 const capture=display.moneyCapture
 if(capture?.sourceId===raw.id&&capture?.orderNumber===raw.billno&&capture?.companyId===companyId&&['order-detail','order-list'].includes(capture?.operation)){
  const supplement:Row={}
  for(const key of ['hzkj_total_amount','hzkj_order_amount','hzkj_fre_quo_amount','hzkj_logistics_info','hzkj_discount_cost'])if(Object.prototype.hasOwnProperty.call(capture.values??{},key))supplement[key]=capture.values[key]
  // Current header facts (including explicit null) supersede historical supplements.
  if(!Object.prototype.hasOwnProperty.call(raw,'hzkj_fixed_tax_fee')&&Object.prototype.hasOwnProperty.call(capture.values??{},'hzkj_fixed_tax_fee'))supplement.hzkj_fixed_tax_fee=capture.values.hzkj_fixed_tax_fee
  raw={...raw,...supplement}
 }
 const value=raw.hzkj_total_amount
 const valid=(typeof value==='string'||typeof value==='number')&&/^-?\d+(\.\d+)?$/.test(String(value))
 const n=valid?Number(value):NaN
 const amount=valid&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER&&new Decimal(String(n)).eq(String(value))?n:null
 const code=raw.hzkj_settlecurrency_number??raw.hzkj_settlecurrency?.number
 const currency=typeof code==='string'&&/^[A-Z]{3}$/.test(code)?code:(!code?'USD':null)
 const taxAmount=fixedOrderTax(raw)
 const missing=new Set<string>(display.dataQuality?.missingFields??[])
 for(const [key,v] of Object.entries({amount,currency,taxAmount})){if(v===null)missing.add(key);else missing.delete(key)}
 const {amountBreakdownSource:_obsoleteReceiptSource,...base}=display
 return {...base,amount,currency,amountBreakdown:{productAmount:component(raw.hzkj_order_amount),shippingFee:component(raw.hzkj_fre_quo_amount),taxAmount,discountAmount:component(raw.hzkj_discount_cost),totalAmount:amount},dataQuality:{...display.dataQuality,missingFields:[...missing]},amountBasis:'hzkj_total_amount',currencyBasis:code?'source':'confirmed_usd_2026_11_15'}
}
