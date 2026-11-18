/** FOP purchase header's 1688 order state is authoritative; amounts do not infer payment. */
export function purchasePayment(raw:Record<string,any>):string {
 return ({'0':'unpaid','1':'paid','2':'cancelled','3':'refunded','4':'partially_refunded'} as Record<string,string>)[String(raw.hzkj_pay_status)]??'unknown'
}
