import {purchasePayment} from './purchase-payment'
import {projectPurchaseOrderRows,purchaseGroupFacts} from './collected-purchase-association'
it.each([['0','unpaid'],['1','paid'],['2','cancelled'],['3','refunded'],['4','partially_refunded']])('trusts state %s', (value,expected)=>expect(purchasePayment({hzkj_pay_status:value})).toBe(expected))
it('links all referenced orders with source numbers and preserves header money without allocation',()=>{
 const raw={hzkj_pay_status:'1',hzkj_actual_amount:'12.50',hzkj_actual_free:'2',hzkj_billentry:[{id:'a',hzkj_srcbillnumber:'TO1',hzkj_salbillnumber:''},{id:'b',hzkj_srcbillnumber:'TO2'}]}
 const result=projectPurchaseOrderRows(raw,n=>({id:n,billno:n}));expect(result.rows.map(r=>r.orderId)).toEqual(['TO1','TO2']);expect(purchaseGroupFacts(raw,result.rows,0).purchase).toMatchObject({payment:'paid',actualPaidAmount:12.5,actualPaidFreight:2})
})
