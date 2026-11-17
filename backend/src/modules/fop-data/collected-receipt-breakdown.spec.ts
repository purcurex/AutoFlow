import { applyReceiptBreakdown } from './collected-receipt-breakdown'
const order=()=>({id:'o',orderNumber:'TO1',amount:35.64,currency:'USD',amountBreakdown:{productAmount:null,totalAmount:35.64},dataQuality:{missingFields:[]}})
const line=(patch={})=>({orderId:'o',receiptId:'r',receiptNumber:'SK1',entryId:'e',currency:'USD',line:{hzkj_amountfield:28.3,hzkj_freight:7.34,hzkj_fixed_tax_fee:0,hzkj_samount:35.64},...patch})
it('reads the exact receipt entry, retains tax zero and order total without treating net receipts as price',()=>{
 expect(applyReceiptBreakdown(order(),[line()])).toMatchObject({amount:35.64,amountBreakdown:{productAmount:28.3,shippingFee:7.34,taxAmount:0,discountAmount:null,totalAmount:35.64},amountBreakdownSource:{state:'matched',receiptId:'r',entryId:'e'}})
})
it('does not sum duplicate receipts or invent missing receipt components',()=>{
 expect(applyReceiptBreakdown(order(),[]).amountBreakdown.productAmount).toBeNull()
 expect(applyReceiptBreakdown(order(),[line(),line({receiptId:'r2',entryId:'e2'})])).toMatchObject({amountBreakdown:{productAmount:null},amountBreakdownSource:{state:'ambiguous'}})
})
it('deduplicates identical source entries, rejects conflicting duplicates and foreign currencies',()=>{
 expect(applyReceiptBreakdown(order(),[line(),line()]).amountBreakdown.productAmount).toBe(28.3)
 expect(applyReceiptBreakdown(order(),[line(),line({line:{hzkj_amountfield:50}})]).amountBreakdown.productAmount).toBeNull()
 expect(applyReceiptBreakdown(order(),[line({currency:'EUR'})]).amountBreakdown.productAmount).toBeNull()
})
it('keeps unrelated, missing and invalid fields unknown and exposes a mismatched source total',()=>{
 expect(applyReceiptBreakdown(order(),[line({orderId:'other'})]).amountBreakdown.productAmount).toBeNull()
 expect(applyReceiptBreakdown(order(),[line({line:{hzkj_amountfield:'bad',hzkj_samount:40}})])).toMatchObject({amount:35.64,amountBreakdown:{productAmount:null,shippingFee:null,taxAmount:null},amountBreakdownSource:{state:'matched',receiptOrderAmount:40,totalMatches:false}})
})

it('uses receipt entry order total when the source order total was not captured',()=>{expect(applyReceiptBreakdown({...order(),amount:null},[line()])).toMatchObject({amount:35.64,amountBreakdown:{totalAmount:35.64},amountBasis:'receipt.entryentity.hzkj_samount'})})

it('retains platform-order prices when no receipt exists, including zero',()=>{
 expect(applyReceiptBreakdown({...order(),amount:null,amountBreakdown:{productAmount:10.9,shippingFee:0,taxAmount:null}},[])).toMatchObject({amount:null,amountBreakdown:{productAmount:10.9,shippingFee:0,taxAmount:null}})
})
